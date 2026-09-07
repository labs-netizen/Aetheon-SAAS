/**
 * Private Storage Architecture & Tenant Bucket Partitioning
 * Enforces path isolation: tenants/{orgId}/{siteId}/{filename}
 * Prevents cross-tenant file leakage and directory traversal.
 */

export const STORAGE_BUCKETS = {
  METER_UPLOADS: 'tenant-uploads',
  BILLS: 'tenant-bills',
  REPORTS: 'tenant-reports',
  REGULATORY_DOCS: 'regulatory-documents',
  COMPLIANCE_EVIDENCE: 'compliance-evidence',
} as const;

export type StorageBucketType = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/**
 * Sanitize filename to prevent directory traversal and illegal characters
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '');
}

/**
 * Build canonical isolated tenant storage path
 */
export function buildTenantStoragePath(
  orgId: string,
  siteId: string,
  filename: string
): string {
  if (!orgId || !siteId || !filename) {
    throw new Error('orgId, siteId, and filename are strictly required for storage path construction');
  }
  const cleanOrg = orgId.replace(/[^a-zA-Z0-9-]/g, '');
  const cleanSite = siteId.replace(/[^a-zA-Z0-9-]/g, '');
  const cleanFile = sanitizeFilename(filename);

  return `tenants/${cleanOrg}/${cleanSite}/${cleanFile}`;
}

/**
 * Validate that an authenticated tenant user is permitted to access a target path
 */
export function validateTenantStorageAccess(
  targetPath: string,
  userOrgId: string
): { allowed: boolean; reason?: string } {
  if (!targetPath || !userOrgId) {
    return { allowed: false, reason: 'Missing path or user organisation context' };
  }

  // Prevent path traversal
  if (targetPath.includes('..') || targetPath.includes('//')) {
    return { allowed: false, reason: 'PATH_TRAVERSAL_DETECTED: Illegal path characters' };
  }

  const expectedPrefix = `tenants/${userOrgId}/`;
  if (!targetPath.startsWith(expectedPrefix)) {
    return {
      allowed: false,
      reason: 'CROSS_TENANT_ACCESS_DENIED: Path does not belong to user organisation',
    };
  }

  return { allowed: true };
}
