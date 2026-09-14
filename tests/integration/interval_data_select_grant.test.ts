import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migration 028 authenticated interval read grant', () => {
  const sql = readFileSync(resolve(
    process.cwd(),
    'supabase/migrations/20260914000028_authenticated_interval_data_select.sql'
  ), 'utf8').replace(/\s+/g, ' ').toUpperCase();

  it('grants only SELECT on interval_data_96 to authenticated', () => {
    expect(sql).toContain('GRANT SELECT ON TABLE PUBLIC.INTERVAL_DATA_96 TO AUTHENTICATED;');
    expect(sql).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO AUTHENTICATED/);
  });

  it('does not grant interval data access to anon', () => {
    expect(sql).not.toMatch(/GRANT[^;]*PUBLIC\.INTERVAL_DATA_96[^;]*TO ANON/);
  });
});
