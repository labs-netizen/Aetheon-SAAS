import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migration 029 market-price authority', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260915000029_authoritative_iex_dam_prices.sql'), 'utf8');
  const normalized = sql.replace(/\s+/g, ' ').toUpperCase();

  it('pins SECURITY DEFINER resolution and restricts RPC execution to service_role', () => {
    expect(normalized).toContain('SECURITY DEFINER SET SEARCH_PATH = PG_CATALOG, PUBLIC, PG_TEMP');
    expect(normalized).toContain('REVOKE ALL ON FUNCTION PUBLIC.COMMIT_IEX_DAM_MARKET_PRICES');
    expect(normalized).toContain('FROM PUBLIC, ANON, AUTHENTICATED');
    expect(normalized).toContain('TO SERVICE_ROLE');
  });

  it('enables RLS and grants no raw access to browser roles', () => {
    expect(normalized).toContain('ALTER TABLE PUBLIC.MARKET_PRICE_IMPORTS ENABLE ROW LEVEL SECURITY');
    expect(normalized).toContain('ALTER TABLE PUBLIC.MARKET_PRICE_BLOCKS ENABLE ROW LEVEL SECURITY');
    expect(normalized).toContain('REVOKE ALL ON PUBLIC.MARKET_PRICE_IMPORTS, PUBLIC.MARKET_PRICE_BLOCKS FROM PUBLIC, ANON, AUTHENTICATED, SERVICE_ROLE');
    expect(normalized).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)[^;]*TO\s+(ANON|AUTHENTICATED)/);
  });

  it('enforces official IEX DAM provenance, checksum uniqueness, and 96-block dates', () => {
    expect(normalized).toContain("CHECK (EXCHANGE = 'IEX')");
    expect(normalized).toContain("CHECK (MARKET_PRODUCT = 'DAM')");
    expect(normalized).toContain('SOURCE_FILE_HASH CHAR(64) NOT NULL UNIQUE');
    expect(normalized).toContain('COUNT(*) <> 96 OR COUNT(DISTINCT BLOCK_INDEX) <> 96');
    expect(normalized).toContain("'OFFICIAL_SOURCE_CONFIRMED'");
  });
});
