import Papa from 'papaparse';
import { getBlockTimes } from '@/lib/dates/blocks96';
import readXlsxFile, { type Row as XlsxRow } from 'read-excel-file/node';

export type IexDateFormat = 'AUTO' | 'DD/MM/YYYY' | 'DD-MM-YYYY';

export interface IexDamPriceRow {
  delivery_date: string;
  block_index: number;
  time_start: string;
  time_end: string;
  mcp_rs_per_mwh: number;
}

export interface IexDamParseResult {
  valid: boolean;
  rows: IexDamPriceRow[];
  total_rows: number;
  total_days: number;
  errors: Array<{ row?: number; delivery_date?: string; code: string; message: string }>;
  source_format?: 'CSV' | 'XLSX';
  detected_sheet?: string | null;
  delivery_dates?: string[];
  summary_rows_ignored?: number;
  preview?: { blocks: number; mcp_min_rs_per_mwh: number; mcp_max_rs_per_mwh: number; mcp_average_rs_per_mwh: number } | null;
}

const normalizedHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

function canonicalDate(rawValue: unknown, format: IexDateFormat): string | null {
  if (rawValue instanceof Date) return Number.isFinite(rawValue.getTime()) ? rawValue.toISOString().slice(0, 10) : null;
  const raw = String(rawValue ?? '').trim();
  let year: number;
  let month: number;
  let day: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = /^(\d{2})([/-])(\d{2})\2(\d{4})$/.exec(raw);
    if (!match) return null;
    if (format === 'AUTO' && match[2] === '/' && Number(match[1]) <= 12 && Number(match[3]) <= 12) return null;
    if (format === 'DD/MM/YYYY' && match[2] !== '/') return null;
    if (format === 'DD-MM-YYYY' && match[2] !== '-') return null;
    day = Number(match[1]); month = Number(match[3]); year = Number(match[4]);
  }
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.getUTCFullYear() !== year! || date.getUTCMonth() + 1 !== month! || date.getUTCDate() !== day!) return null;
  return `${year!.toString().padStart(4, '0')}-${month!.toString().padStart(2, '0')}-${day!.toString().padStart(2, '0')}`;
}

function blockFromValue(rawValue: unknown): number | null {
  const raw = String(rawValue ?? '').trim().replace(/[–—]/g, '-');
  if (/^\d{1,2}$/.test(raw)) {
    const block = Number(raw);
    return block >= 1 && block <= 96 ? block : null;
  }
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes < 0 || minutes >= 1440 || minutes % 15 !== 0) return null;
  const block = minutes / 15 + 1;
  const expected = getBlockTimes(block);
  return expected.startTime === `${match[1].padStart(2, '0')}:${match[2]}` &&
    expected.endTime === `${match[3].padStart(2, '0')}:${match[4]}` ? block : null;
}

type MarketSourceRow = { date: unknown; timeBlock: unknown; mcp: unknown; rowNumber: number };

function validateMarketRows(sourceRows: MarketSourceRow[], format: IexDateFormat): IexDamParseResult {
  const rows: IexDamPriceRow[] = [];
  const errors: IexDamParseResult['errors'] = [];
  for (const source of sourceRows) {
    const deliveryDate = canonicalDate(source.date, format);
    const blockIndex = blockFromValue(source.timeBlock);
    const rawMcp = source.mcp;
    const mcp = typeof rawMcp === 'number' ? rawMcp :
      typeof rawMcp === 'string' && /^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawMcp.replace(/,/g, '').trim())
        ? Number(rawMcp.replace(/,/g, '').trim()) : Number.NaN;
    if (!deliveryDate) errors.push({ row: source.rowNumber, code: 'INVALID_OR_AMBIGUOUS_DATE', message: `Invalid or ambiguous delivery date '${source.date}'.` });
    if (blockIndex === null) errors.push({ row: source.rowNumber, delivery_date: deliveryDate || undefined, code: 'INVALID_TIME_BLOCK', message: `Invalid 15-minute Time Block '${source.timeBlock}'.` });
    if (!Number.isFinite(mcp) || mcp < 0) errors.push({ row: source.rowNumber, delivery_date: deliveryDate || undefined, code: 'INVALID_MCP', message: 'MCP must be a non-negative numeric Rs/MWh value.' });
    if (deliveryDate && blockIndex !== null && Number.isFinite(mcp) && mcp >= 0) {
      const times = getBlockTimes(blockIndex);
      rows.push({ delivery_date: deliveryDate, block_index: blockIndex, time_start: times.startTime, time_end: times.endTime, mcp_rs_per_mwh: mcp });
    }
  }
  const byDate = new Map<string, IexDamPriceRow[]>();
  for (const row of rows) byDate.set(row.delivery_date, [...(byDate.get(row.delivery_date) || []), row]);
  for (const [date, dayRows] of byDate) {
    const blocks = new Set(dayRows.map((row) => row.block_index));
    if (dayRows.length !== 96 || blocks.size !== 96 || sourceRows.filter((row) => canonicalDate(row.date, format) === date).length !== 96) {
      errors.push({ delivery_date: date, code: blocks.size < dayRows.length ? 'DUPLICATE_TIME_BLOCK' : 'INCOMPLETE_96_BLOCK_DAY', message: `${date} has ${blocks.size} unique blocks; exactly 96 valid rows are required.` });
    }
  }
  const mcps = rows.map((row) => row.mcp_rs_per_mwh);
  return { valid: errors.length === 0 && byDate.size > 0, rows, total_rows: sourceRows.length, total_days: byDate.size, errors,
    delivery_dates: [...byDate.keys()].sort(), preview: mcps.length ? { blocks: rows.length, mcp_min_rs_per_mwh: Math.min(...mcps),
      mcp_max_rs_per_mwh: Math.max(...mcps), mcp_average_rs_per_mwh: mcps.reduce((sum, value) => sum + value, 0) / mcps.length } : null };
}

export function parseOfficialIexDamCsv(csv: string, dateFormat: IexDateFormat = 'AUTO'): IexDamParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', transformHeader: (header) => header.trim(), transform: (value) => value.trim(),
  });
  const errors: IexDamParseResult['errors'] = parsed.errors.map((error) => ({
    row: typeof error.row === 'number' ? error.row + 2 : undefined,
    code: 'CSV_PARSE_ERROR', message: error.message,
  }));
  const fields = parsed.meta.fields || [];
  const find = (...names: string[]) => fields.find((field) => names.includes(normalizedHeader(field)));
  const dateColumn = find('date');
  const blockColumn = find('timeblock');
  const mcpColumn = find('mcprsmwh', 'mcprspermwh');
  if (!dateColumn || !blockColumn || !mcpColumn) {
    errors.push({ code: 'INVALID_IEX_DAM_SCHEMA', message: 'Official IEX DAM columns Date, Time Block, and MCP (Rs/MWh) are required.' });
    return { valid: false, rows: [], total_rows: parsed.data.length, total_days: 0, errors };
  }

  const validated = validateMarketRows(parsed.data.map((source, index) => ({ date: source[dateColumn],
    timeBlock: source[blockColumn], mcp: source[mcpColumn], rowNumber: index + 2 })), dateFormat);
  return { ...validated, source_format: 'CSV', errors: [...errors, ...validated.errors], valid: errors.length === 0 && validated.valid };
}

const requiredHeaderIndex = (cells: XlsxRow) => {
  const headers = cells.map((cell) => normalizedHeader(String(cell ?? '')));
  const indices = [headers.indexOf('date'), headers.indexOf('timeblock'), headers.findIndex((header) => header === 'mcprsmwh' || header === 'mcprspermwh')];
  return indices.every((index) => index >= 0) ? indices : null;
};

export async function parseOfficialIexDamXlsx(bytes: Buffer, dateFormat: IexDateFormat = 'AUTO'): Promise<IexDamParseResult> {
  let sheets: Awaited<ReturnType<typeof readXlsxFile<number>>>;
  try { sheets = await readXlsxFile<number>(bytes); }
  catch (error) { return { valid: false, rows: [], total_rows: 0, total_days: 0, errors: [{ code: 'INVALID_XLSX_WORKBOOK', message: error instanceof Error ? error.message : String(error) }], source_format: 'XLSX' }; }
  const candidates = sheets.flatMap((sheet) => sheet.data.map((cells, index) => ({ sheet, headerRow: index, indices: requiredHeaderIndex(cells) }))
    .filter((candidate) => candidate.indices !== null));
  if (candidates.length !== 1) return { valid: false, rows: [], total_rows: 0, total_days: 0,
    errors: [{ code: candidates.length ? 'AMBIGUOUS_IEX_DAM_SHEET' : 'INVALID_IEX_DAM_SCHEMA', message: 'Exactly one sheet with official Date, Time Block and MCP (Rs/MWh) headers is required.' }], source_format: 'XLSX' };
  const { sheet, headerRow, indices } = candidates[0];
  const [dateIndex, blockIndex, mcpIndex] = indices!;
  const marketRows: MarketSourceRow[] = [];
  let ignored = 0;
  let inSummary = false;
  for (let index = headerRow + 1; index < sheet.data.length; index++) {
    const cells = sheet.data[index];
    const date = cells[dateIndex];
    const block = cells[blockIndex];
    const mcp = cells[mcpIndex];
    if (cells.every((cell) => cell === null || String(cell).trim() === '')) { ignored++; continue; }
    const summary = /^(total|maximum|max|minimum|min|average|avg|notes?|summary)\b/i.test(String(date ?? '').trim());
    if (summary) { inSummary = true; ignored++; continue; }
    if (inSummary) { ignored++; continue; }
    if (date === null && block === null && mcp === null) { ignored++; continue; }
    marketRows.push({ date, timeBlock: block, mcp, rowNumber: index + 1 });
  }
  const validated = validateMarketRows(marketRows, dateFormat);
  return { ...validated, source_format: 'XLSX', detected_sheet: sheet.sheet, summary_rows_ignored: ignored };
}
