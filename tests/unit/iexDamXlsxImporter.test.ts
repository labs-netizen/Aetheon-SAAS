import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import readXlsxFile from 'read-excel-file/node';
import { parseOfficialIexDamXlsx, parseOfficialIexDamCsv, parseOfficialIexDamSheetRows } from '@/features/market-prices/iexDamImporter';

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'tests/fixtures/market-prices', name));

describe('real-structure IEX Market Snapshot XLSX', () => {
  it('detects Sheet1, decorated MCP header, DD-MM-YYYY, all 96 blocks and last 24:00', async () => {
    const result = await parseOfficialIexDamXlsx(fixture('iex-dam-market-snapshot.xlsx'));
    expect(result).toMatchObject({ valid: true, source_format: 'XLSX', detected_sheet: 'Sheet1', total_rows: 96,
      total_days: 1, delivery_dates: ['2026-09-15'], summary_rows_ignored: 5 });
    expect(result.rows.at(-1)).toMatchObject({ block_index: 96, time_start: '23:45', time_end: '24:00', mcp_rs_per_mwh: 4095 });
    expect(result.preview).toMatchObject({ blocks: 96, mcp_min_rs_per_mwh: 4000, mcp_max_rs_per_mwh: 4095 });
  });

  it('rejects missing, duplicate, malformed MCP, and random workbooks', async () => {
    expect((await parseOfficialIexDamXlsx(fixture('iex-dam-missing-block.xlsx'))).errors.map((error) => error.code)).toContain('INCOMPLETE_96_BLOCK_DAY');
    expect((await parseOfficialIexDamXlsx(fixture('iex-dam-duplicate-block.xlsx'))).errors.map((error) => error.code)).toContain('DUPLICATE_TIME_BLOCK');
    expect((await parseOfficialIexDamXlsx(fixture('iex-dam-malformed-mcp.xlsx'))).errors.map((error) => error.code)).toContain('INVALID_MCP');
    expect(await parseOfficialIexDamXlsx(fixture('random.xlsx'))).toMatchObject({ valid: false, errors: [{ code: 'INVALID_IEX_DAM_SCHEMA' }] });
  });

  it('keeps canonical CSV compatible', () => {
    const csv = ['Date,Time Block,MCP (Rs/MWh) *', ...Array.from({ length: 96 }, (_, block) => {
      const start = `${String(Math.floor(block / 4)).padStart(2, '0')}:${String((block % 4) * 15).padStart(2, '0')}`;
      const endBlock = block + 1;
      const end = endBlock === 96 ? '24:00' : `${String(Math.floor(endBlock / 4)).padStart(2, '0')}:${String((endBlock % 4) * 15).padStart(2, '0')}`;
      return `15-09-2026,${start} - ${end},${4000 + block}`;
    })].join('\n');
    expect(parseOfficialIexDamCsv(csv)).toMatchObject({ valid: true, source_format: 'CSV', total_rows: 96, delivery_dates: ['2026-09-15'] });
  });

  it('ignores the five real-style numeric/header footer rows after a complete 96-block section', async () => {
    const [sheet] = await readXlsxFile<number>(fixture('iex-dam-market-snapshot.xlsx'));
    const rows = sheet.data.map((row) => [...row]);
    rows[101] = ['Date', null, 'Purchase Bid', 1234, 2345, 3456, 4567, 5678];
    rows[102] = ['15-09-2026', null, 1056047.03, 1200, 1300, 1400, 1500, 1600];
    rows[103] = ['15-09-2026', null, 77861.40, 100, 200, 300, 400, 500];
    rows[104] = ['15-09-2026', null, 17702.40, 100, 200, 300, 400, 500];
    rows[105] = ['15-09-2026', null, 44001.96, 100, 200, 300, 400, 500];
    const result = parseOfficialIexDamSheetRows(rows, sheet.sheet);
    expect(result).toMatchObject({ valid: true, total_rows: 96, total_days: 1, summary_rows_ignored: 5,
      delivery_dates: ['2026-09-15'], errors: [] });
    expect(result.preview?.blocks).toBe(96);
  });

  it('rejects a malformed internal block, an extra duplicate, and an extra dated market row', async () => {
    const [sheet] = await readXlsxFile<number>(fixture('iex-dam-market-snapshot.xlsx'));
    const malformed = sheet.data.map((row) => [...row]);
    malformed[54][7] = 'invalid MCP'; // block 50 remains inside the authoritative section
    expect(parseOfficialIexDamSheetRows(malformed, sheet.sheet).errors.map((error) => error.code)).toContain('INVALID_MCP');
    const duplicate = sheet.data.map((row) => [...row]);
    duplicate.push(['15-09-2026', null, '00:00 - 00:15', null, null, null, null, 4000]);
    expect(parseOfficialIexDamSheetRows(duplicate, sheet.sheet).errors.map((error) => error.code)).toContain('DUPLICATE_TIME_BLOCK');
    const extra = sheet.data.map((row) => [...row]);
    extra.push(['15-09-2026', null, '23:45 - 24:00', null, null, null, null, 4000]);
    expect(parseOfficialIexDamSheetRows(extra, sheet.sheet).errors.map((error) => error.code)).toContain('DUPLICATE_TIME_BLOCK');
  });

  it('ignores arbitrary footer text after block 96 and still rejects a missing block', async () => {
    const [sheet] = await readXlsxFile<number>(fixture('iex-dam-market-snapshot.xlsx'));
    const rows = sheet.data.map((row) => [...row]);
    rows.push(['Some unrelated footer', null, 'aggregate bid', 1, 2, 3, 4, 5]);
    expect(parseOfficialIexDamSheetRows(rows, sheet.sheet)).toMatchObject({ valid: true, summary_rows_ignored: 6 });
    expect((await parseOfficialIexDamXlsx(fixture('iex-dam-missing-block.xlsx'))).errors.map((error) => error.code)).toContain('INCOMPLETE_96_BLOCK_DAY');
  });
});
