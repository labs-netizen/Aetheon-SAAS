import {describe,expect,it} from 'vitest';
import fs from 'node:fs';

describe('IEX DAM batch importer UI contract',()=>{
  it('exposes XLSX-only multiple selection, explicit confirmation, queue evidence and batch controls',()=>{const source=fs.readFileSync('src/features/market-prices/IexDamBatchImporter.tsx','utf8');
    expect(source).toContain('type="file" multiple accept=".xlsx');expect(source).toContain('iex-official-confirmation');
    expect(source).toContain('VALIDATE ALL');expect(source).toContain('CONFIRM & IMPORT VALID FILES');expect(source).toContain('CANCEL ANALYSIS');
    expect(source).toContain('delivery_dates');expect(source).toContain('checksum_sha256');expect(source).toContain('mcp_average_rs_per_mwh');});
  it('keeps the existing privileged single-file API and authorization boundary unchanged',()=>{const route=fs.readFileSync('src/app/api/admin/market-prices/route.ts','utf8');
    expect(route).toContain('authorizeMarketDataAdmin(req)');expect(route).toContain("rpc('commit_iex_dam_market_prices'");expect(route).toContain("error.message.includes('DUPLICATE_MARKET_PRICE_FILE')");});
});
