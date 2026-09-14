import { describe, expect, it } from 'vitest';
import { parseOfficialIexDamCsv } from '@/features/market-prices/iexDamImporter';
import { getBlockTimes } from '@/lib/dates/blocks96';

const csvFor = (dates: string[], mutate?: (rows: string[]) => void) => {
  const rows = dates.flatMap((date) => Array.from({ length: 96 }, (_, index) => {
    const times = getBlockTimes(index + 1);
    return `${date},${times.startTime}-${times.endTime},${3500 + index}`;
  }));
  mutate?.(rows);
  return ['Date,Time Block,MCP (Rs/MWh)', ...rows].join('\n');
};

describe('official IEX DAM export adapter', () => {
  it('accepts complete single-day and multi-day official schemas', () => {
    expect(parseOfficialIexDamCsv(csvFor(['2026-09-16']))).toMatchObject({ valid: true, total_rows: 96, total_days: 1 });
    expect(parseOfficialIexDamCsv(csvFor(['2026-09-16', '2026-09-17']))).toMatchObject({ valid: true, total_rows: 192, total_days: 2 });
  });

  it('rejects incomplete, duplicate, negative-price, and arbitrary uploads', () => {
    expect(parseOfficialIexDamCsv(csvFor(['2026-09-16'], (rows) => rows.pop())).errors.map((error) => error.code)).toContain('INCOMPLETE_96_BLOCK_DAY');
    expect(parseOfficialIexDamCsv(csvFor(['2026-09-16'], (rows) => { rows[95] = rows[0]; })).errors.map((error) => error.code)).toContain('DUPLICATE_TIME_BLOCK');
    expect(parseOfficialIexDamCsv(csvFor(['2026-09-16'], (rows) => { rows[0] = '2026-09-16,00:00-00:15,-1'; })).errors.map((error) => error.code)).toContain('INVALID_MCP');
    expect(parseOfficialIexDamCsv('site_id,load_kw\na,100')).toMatchObject({ valid: false, total_days: 0 });
  });

  it('requires explicit interpretation of ambiguous official DMY dates', () => {
    const csv = csvFor(['03/04/2026']);
    expect(parseOfficialIexDamCsv(csv).errors.map((error) => error.code)).toContain('INVALID_OR_AMBIGUOUS_DATE');
    expect(parseOfficialIexDamCsv(csv, 'DD/MM/YYYY')).toMatchObject({ valid: true, total_days: 1 });
  });
});
