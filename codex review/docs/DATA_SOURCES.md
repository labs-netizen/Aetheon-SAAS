# Aetheon Energy Intelligence Platform - Data Sources Architecture (DATA_SOURCES.md)

## 1. Gateway Ingestion Hierarchy

The platform defines a clean hierarchy of 5 data acquisition channels:

1. **API / Vendor Integration**: Direct pull or push via authenticated HTTP endpoints (e.g. smart meter MDM, EMS cloud).
2. **Secure SFTP**: Automated batch pickup of daily 15-minute AMR/AMI exports from plant data loggers.
3. **Structured CSV/XLSX Upload**: Portal-side self-service file upload for energy managers and plant engineers.
4. **Designated Inbound Mailbox**: Automated parser for scheduled DISCOM email attachments or meter reports.
5. **Monthly Utility Bill Upload**: PDF/XLSX parser for utility bill cross-reconciliation.

---

## 2. Ingestion Provider Abstraction

All data ingestion implementations inherit from the canonical `IDataSourceProvider` interface:

```typescript
export interface IngestionPayload {
  sourceId: string;
  siteId: string;
  filename: string;
  buffer: Buffer;
  mimeType: string;
  uploadedBy: string;
}

export interface IngestionValidationResult {
  checksum: string;
  isDuplicate: boolean;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  errors: Array<{
    rowNumber: number;
    column?: string;
    value?: unknown;
    reason: string;
  }>;
  parsedBlocks?: CanonicalBlockReading[];
}

export interface IDataSourceProvider {
  readonly providerType: 'CSV_UPLOAD' | 'SFTP' | 'API' | 'MAILBOX' | 'BILL_UPLOAD';
  validate(payload: IngestionPayload): Promise<IngestionValidationResult>;
  process(payload: IngestionPayload): Promise<{ runId: string; status: string }>;
}
```

---

## 3. CSV/XLSX Canonical Format Specification

### Header Specification
```csv
operating_date,block_index,start_time,end_time,load_kw,solar_generation_kw,actual_drawal_kw,scheduled_drawal_kw
2026-09-01,1,00:00,00:15,1240.5,0.0,1240.5,1200.0
2026-09-01,2,00:15,00:30,1215.0,0.0,1215.0,1200.0
...
2026-09-01,96,23:45,24:00,1180.2,0.0,1180.2,1200.0
```

### Validation Rules
1. **Operating Date**: ISO-8601 `YYYY-MM-DD`. Must be a valid calendar date.
2. **Block Index**: Integer strictly in the range `1` to `96`.
3. **Completeness**: A valid full day profile requires exactly 96 blocks. Missing blocks are flagged as `DATA_GAP`.
4. **Numeric Bounds**:
   - `load_kw` >= 0
   - `solar_generation_kw` >= 0 (and strictly 0 during nighttime blocks: blocks 1–24 and blocks 76–96)
   - `actual_drawal_kw` >= 0
5. **Idempotency**: A SHA-256 hash is computed over file content before processing. If an identical file has already been accepted for the same site, ingestion is rejected with a `DUPLICATE_FILE` error.
