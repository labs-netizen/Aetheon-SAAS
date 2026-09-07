/**
 * Data Gateway - Provider Abstractions & Contracts
 * Implements architectural contracts for CSV/XLSX, Meter API, SFTP, Mailbox, and Bill Upload.
 * Adheres to zero-raw-secrets policy: secrets are stored via vaulted secret references.
 */

export type DataSourceType = 'CSV_UPLOAD' | 'API' | 'SFTP' | 'MAILBOX' | 'BILL_UPLOAD';

export type ConnectionStatus = 'CONFIGURED' | 'TESTING' | 'CONNECTED' | 'FAILED' | 'DISCONNECTED';

export interface SecretReference {
  vaultKeyId: string;
  provider: 'AWS_SECRETS_MANAGER' | 'HASHICORP_VAULT' | 'SUPABASE_VAULT' | 'ENV_FALLBACK';
  keyAlias: string;
  createdAt: string;
  expiresAt?: string;
}

export interface IngestionResult {
  success: boolean;
  ingestionRunId: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  checksum: string;
  errors: Array<{ rowNumber?: number; column?: string; reason: string }>;
}

export interface DataSourceProvider<TConfig = Record<string, unknown>> {
  readonly type: DataSourceType;
  readonly name: string;
  validateConfig(config: unknown): { valid: boolean; errors?: string[] };
  testConnection(config: TConfig, secretRef?: SecretReference): Promise<{
    success: boolean;
    latencyMs?: number;
    error?: string;
  }>;
  ingest(config: TConfig, secretRef?: SecretReference, payload?: unknown): Promise<IngestionResult>;
}

// 1. CSV / XLSX Ingestion Provider (Concrete Implementation)
export interface CsvXlsxConfig {
  allowedExtensions: ('.csv' | '.xlsx')[];
  maxFileSizeBytes: number;
  dateFormat: string;
  enforce96Blocks: boolean;
}

export class CsvXlsxProvider implements DataSourceProvider<CsvXlsxConfig> {
  readonly type: DataSourceType = 'CSV_UPLOAD';
  readonly name = 'Structured CSV / XLSX Ingestion Gateway';

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['Configuration must be a non-null object'] };
    }
    return { valid: true };
  }

  async testConnection(): Promise<{ success: boolean; latencyMs: number }> {
    return { success: true, latencyMs: 1 };
  }

  async ingest(
    _config: CsvXlsxConfig,
    _secretRef?: SecretReference,
    payload?: { fileContent: string; siteId: string; filename: string }
  ): Promise<IngestionResult> {
    if (!payload || !payload.fileContent) {
      return {
        success: false,
        ingestionRunId: '',
        totalRows: 0,
        acceptedRows: 0,
        rejectedRows: 1,
        checksum: '',
        errors: [{ reason: 'MISSING_PAYLOAD: fileContent is required for CSV ingestion' }],
      };
    }
    const { parseAndValidateCsv } = await import('./csvParser');
    const result = parseAndValidateCsv(payload.fileContent, payload.siteId);
    return {
      success: result.errors.length === 0,
      ingestionRunId: payload.filename,
      totalRows: result.totalRows,
      acceptedRows: result.acceptedRows,
      rejectedRows: result.rejectedRows,
      checksum: result.checksum,
      errors: result.errors,
    };
  }
}

// 2. Automated Smart Meter / EMS REST API Provider (Scaffolded Contract)
export interface ApiProviderConfig {
  endpointUrl: string;
  authMethod: 'BEARER_TOKEN' | 'BASIC' | 'API_KEY' | 'OAUTH2_M2M';
  pollingIntervalMinutes: number;
  timeoutSeconds: number;
}

export class ApiProvider implements DataSourceProvider<ApiProviderConfig> {
  readonly type: DataSourceType = 'API';
  readonly name = 'Smart Meter / EMS Direct API Gateway';

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    const c = config as Partial<ApiProviderConfig>;
    const errors: string[] = [];
    if (!c?.endpointUrl || !/^https:\/\//.test(c.endpointUrl)) {
      errors.push('endpointUrl must be a secure HTTPS URL');
    }
    if (!c?.pollingIntervalMinutes || c.pollingIntervalMinutes < 5) {
      errors.push('pollingIntervalMinutes must be at least 5 minutes');
    }
    return { valid: errors.length === 0, errors };
  }

  async testConnection(config: ApiProviderConfig, secretRef?: SecretReference): Promise<{ success: boolean; error?: string }> {
    if (!secretRef?.vaultKeyId) {
      return { success: false, error: 'NO_SECRET_REFERENCE: API credentials must be stored in vault' };
    }
    return { success: false, error: 'NOT_CONNECTED: Production meter endpoint pending authorization' };
  }

  async ingest(): Promise<IngestionResult> {
    throw new Error('Automated API polling requires production scheduler configuration');
  }
}

// 3. Secure SFTP Push/Pull Provider (Scaffolded Contract)
export interface SftpProviderConfig {
  host: string;
  port: number;
  username: string;
  remoteDirectory: string;
  filePattern: string;
}

export class SftpProvider implements DataSourceProvider<SftpProviderConfig> {
  readonly type: DataSourceType = 'SFTP';
  readonly name = 'Automated SFTP Meter Directory Ingestion';

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    const c = config as Partial<SftpProviderConfig>;
    const errors: string[] = [];
    if (!c?.host) errors.push('host is required');
    if (!c?.port || c.port <= 0) errors.push('valid port is required');
    return { valid: errors.length === 0, errors };
  }

  async testConnection(_config: SftpProviderConfig, secretRef?: SecretReference): Promise<{ success: boolean; error?: string }> {
    if (!secretRef) {
      return { success: false, error: 'MISSING_SSH_KEY: Private key secret reference required' };
    }
    return { success: false, error: 'SFTP_PENDING: Endpoint handshake awaiting network whitelist' };
  }

  async ingest(): Promise<IngestionResult> {
    throw new Error('SFTP worker listener not running in offline mode');
  }
}

// 4. Inbound Designated Mailbox Provider (Scaffolded Contract)
export interface MailboxProviderConfig {
  inboundAddress: string;
  allowedSenderDomains: string[];
  templateIdentifier: string;
}

export class MailboxProvider implements DataSourceProvider<MailboxProviderConfig> {
  readonly type: DataSourceType = 'MAILBOX';
  readonly name = 'Designated Report Mailbox Ingestion';

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    const c = config as Partial<MailboxProviderConfig>;
    const errors: string[] = [];
    if (!c?.inboundAddress?.includes('@')) errors.push('inboundAddress must be a valid email');
    return { valid: errors.length === 0, errors };
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }

  async ingest(): Promise<IngestionResult> {
    throw new Error('Mailbox webhook listener available in production environment only');
  }
}

// 5. Manual Monthly Electricity Bill Ingestion Provider (Scaffolded Contract)
export interface BillUploadConfig {
  ocrExtractionEngine: 'TESSERACT_OCR' | 'AWS_TEXTRACT' | 'MANUAL_VERIFY';
  supportedDiscoms: string[];
}

export class BillUploadProvider implements DataSourceProvider<BillUploadConfig> {
  readonly type: DataSourceType = 'BILL_UPLOAD';
  readonly name = 'Manual Monthly DISCOM Bill OCR Ingestion';

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    const c = config as Partial<BillUploadConfig>;
    if (!c?.supportedDiscoms?.length) {
      return { valid: false, errors: ['supportedDiscoms list is required'] };
    }
    return { valid: true };
  }

  async testConnection(): Promise<{ success: boolean }> {
    return { success: true };
  }

  async ingest(): Promise<IngestionResult> {
    throw new Error('Bill OCR pipeline requires document parser deployment');
  }
}

// Registry map of available providers
export const DATA_SOURCE_PROVIDERS: Record<DataSourceType, DataSourceProvider<any>> = {
  CSV_UPLOAD: new CsvXlsxProvider(),
  API: new ApiProvider(),
  SFTP: new SftpProvider(),
  MAILBOX: new MailboxProvider(),
  BILL_UPLOAD: new BillUploadProvider(),
};
