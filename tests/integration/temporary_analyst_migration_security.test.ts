import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migration 030 temporary analyst security', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260915000030_temporary_internal_analyst_access.sql'), 'utf8').replace(/\s+/g, ' ').toUpperCase();

  it('keeps grants separate from tenant memberships and bounded to 90 days', () => {
    expect(sql).toContain('CREATE TABLE PUBLIC.INTERNAL_ACCESS_GRANTS');
    expect(sql).toContain("CHECK (ROLE = 'AETHEON_ANALYST')");
    expect(sql).toContain("EXPIRES_AT <= VALID_FROM + INTERVAL '90 DAYS'");
    expect(sql).not.toMatch(/UPDATE PUBLIC\.MEMBERSHIPS|INSERT INTO PUBLIC\.MEMBERSHIPS/);
    expect(sql).not.toMatch(/IS_PLATFORM_ADMIN\s*=/);
  });

  it('restricts grant and revoke RPCs to backend callers with pinned search paths', () => {
    expect(sql.match(/SET SEARCH_PATH = PG_CATALOG, PUBLIC, PG_TEMP/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain('PERFORM PUBLIC.ASSERT_BACKEND_CALLER()');
    expect(sql).toContain('REVOKE ALL ON FUNCTION PUBLIC.GRANT_TEMPORARY_AETHEON_ANALYST');
    expect(sql).toContain('REVOKE ALL ON FUNCTION PUBLIC.REVOKE_TEMPORARY_AETHEON_ANALYST');
    expect(sql).toContain('TO SERVICE_ROLE');
  });

  it('audits grant and revocation with reasons', () => {
    expect(sql).toContain('TEMPORARY_AETHEON_ANALYST_GRANTED');
    expect(sql).toContain('TEMPORARY_AETHEON_ANALYST_REVOKED');
    expect(sql).toContain('ANALYST_GRANT_REASON_REQUIRED');
    expect(sql).toContain('ANALYST_REVOCATION_REASON_REQUIRED');
  });
});
