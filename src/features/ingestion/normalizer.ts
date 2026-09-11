import Papa from 'papaparse';
import { isValidCalendarDate, parseAndValidateCsv, type ParseResult, type RowError } from './csvParser';
import { detectCsvSchema, parseFlexibleCsv } from './schemaDetector';
import type { CsvDateFormat, CsvSchemaMapping, MeasurementUnit, SchemaDetectionResult } from './mappingTypes';

export interface NormalizedPreviewRow {
  operating_date: string;
  block_index: number;
  load_kw: number;
  solar_generation_kw?: string;
  actual_drawal_kw?: string;
  scheduled_drawal_kw?: string;
}

export interface PreparedCsvImport {
  detection: SchemaDetectionResult;
  mapping: CsvSchemaMapping;
  canonicalCsv: string;
  sampleRows: NormalizedPreviewRow[];
  normalizationErrors: RowError[];
  validation: ParseResult | null;
}

function calendarDate(year: number, month: number, day: number): string | null {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidCalendarDate(value) ? value : null;
}

function istParts(date: Date): { date: string; minuteOfDay: number } | null {
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const year = get('year'); const month = get('month'); const day = get('day');
  const hour = get('hour'); const minute = get('minute'); const second = get('second');
  const dateValue = calendarDate(year, month, day);
  return dateValue && second === 0 ? { date: dateValue, minuteOfDay: hour * 60 + minute } : null;
}

function parseDate(value: string, format?: CsvDateFormat): { date: string; minuteOfDay?: number } | null {
  const trimmed = value.trim();
  if (format === 'ISO-8601') {
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (!match) return null;
    if (match[7]) return istParts(new Date(trimmed.replace(' ', 'T')));
    const date = calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
    const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6] || 0);
    return date && hour <= 23 && minute <= 59 && second === 0 ? { date, minuteOfDay: hour * 60 + minute } : null;
  }
  if (format === 'YYYY-MM-DD') {
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = match ? calendarDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
    return date ? { date } : null;
  }
  if (format === 'DD/MM/YYYY' || format === 'DD-MM-YYYY') {
    const separator = format === 'DD/MM/YYYY' ? '/' : '-';
    const match = trimmed.match(new RegExp(`^(\\d{2})\\${separator}(\\d{2})\\${separator}(\\d{4})$`));
    const date = match ? calendarDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
    return date ? { date } : null;
  }
  return null;
}

function parseTime(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]); const minute = Number(match[2]); const second = Number(match[3] || 0);
  return hour <= 23 && minute <= 59 && second === 0 ? hour * 60 + minute : null;
}

function normalizeUnit(value: string | undefined): MeasurementUnit | undefined {
  const unit = value?.trim().toLowerCase();
  return ({ kw: 'kW', mw: 'MW', kva: 'kVA', mva: 'MVA', kwh: 'kWh', mwh: 'MWh' } as Record<string, MeasurementUnit>)[unit || ''];
}

function toKw(value: number, unit: MeasurementUnit, confirmEnergyToPower?: boolean): number | null {
  if (unit === 'kW') return value;
  if (unit === 'MW') return value * 1000;
  if (unit === 'kWh') return confirmEnergyToPower ? value * 4 : null;
  if (unit === 'MWh') return confirmEnergyToPower ? value * 4000 : null;
  return null;
}

export function prepareCsvImport(
  content: string,
  siteId: string,
  overrides: CsvSchemaMapping = {},
  mappingConfirmed = false
): PreparedCsvImport {
  const detection = detectCsvSchema(content, overrides);
  const mapping = detection.mapping;
  const parsed = parseFlexibleCsv(content);
  const errors: RowError[] = parsed.parserErrors.map((reason) => ({ rowNumber: 0, reason }));
  const normalized: NormalizedPreviewRow[] = [];
  const canonicalColumn = (name: string) => parsed.columns.find((column) => column.trim().toLowerCase() === name);
  const solarColumn = canonicalColumn('solar_generation_kw');
  const actualColumn = canonicalColumn('actual_drawal_kw');
  const scheduledColumn = canonicalColumn('scheduled_drawal_kw');

  if (detection.requiresConfirmation && !mappingConfirmed) {
    errors.push({ rowNumber: 0, reason: `MAPPING_CONFIRMATION_REQUIRED: ${detection.warnings.join(' ')}` });
  }
  if (!mapping.measurementColumn || (!mapping.timestampColumn && !mapping.dateColumn) || (!mapping.blockColumn && !mapping.timestampColumn && !mapping.timeColumn)) {
    errors.push({ rowNumber: 0, reason: 'INCOMPLETE_SCHEMA_MAPPING: date/timestamp, interval/time, and measurement mappings are required.' });
  }

  if (errors.length === 0) parsed.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const dateValue = mapping.timestampColumn
      ? parseDate(row[mapping.timestampColumn] || '', mapping.dateFormat)
      : parseDate(row[mapping.dateColumn || ''] || '', mapping.dateFormat);
    if (!dateValue) {
      errors.push({ rowNumber, column: mapping.timestampColumn || mapping.dateColumn, reason: 'INVALID_CALENDAR_DATE: value does not match the confirmed date format or is impossible.' });
      return;
    }
    const timeMinutes = dateValue.minuteOfDay ?? (mapping.timeColumn ? parseTime(row[mapping.timeColumn] || '') : null);
    let block: number;
    if (mapping.blockColumn) {
      const rawBlock = row[mapping.blockColumn] || '';
      if (!/^\d+$/.test(rawBlock)) {
        errors.push({ rowNumber, column: mapping.blockColumn, value: rawBlock, reason: 'INVALID_INTERVAL: block must be an integer from 1 to 96.' }); return;
      }
      block = Number(rawBlock);
      if (timeMinutes !== null && timeMinutes !== undefined && (timeMinutes % 15 !== 0 || block !== Math.floor(timeMinutes / 15) + 1)) {
        errors.push({ rowNumber, column: mapping.blockColumn, reason: 'INTERVAL_MISMATCH: block does not match the 15-minute timestamp/time.' }); return;
      }
    } else {
      if (timeMinutes === null || timeMinutes === undefined || timeMinutes % 15 !== 0) {
        errors.push({ rowNumber, column: mapping.timestampColumn || mapping.timeColumn, reason: 'INVALID_INTERVAL: timestamp/time must fall on an exact 15-minute boundary.' }); return;
      }
      block = Math.floor(timeMinutes / 15) + 1;
    }
    const rawMeasurement = row[mapping.measurementColumn || ''] || '';
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawMeasurement)) {
      errors.push({ rowNumber, column: mapping.measurementColumn, value: rawMeasurement, reason: 'INVALID_NUMERIC_VALUE: measurement must be a non-negative number.' }); return;
    }
    const unit = mapping.unitColumn ? normalizeUnit(row[mapping.unitColumn]) : mapping.measurementUnit;
    if (!unit) {
      errors.push({ rowNumber, column: mapping.unitColumn || mapping.measurementColumn, reason: 'UNSUPPORTED_UNIT: expected kW, MW, kVA, MVA, kWh, or MWh.' }); return;
    }
    if ((unit === 'kWh' || unit === 'MWh') && !mapping.confirmEnergyToPower) {
      errors.push({ rowNumber, column: mapping.measurementColumn, reason: 'ENERGY_TO_POWER_CONFIRMATION_REQUIRED: energy is not silently treated as demand.' }); return;
    }
    const loadKw = toKw(Number(rawMeasurement), unit, mapping.confirmEnergyToPower);
    if (loadKw === null) {
      errors.push({ rowNumber, column: mapping.measurementColumn, reason: 'APPARENT_POWER_CONVERSION_UNSUPPORTED: kVA/MVA cannot be converted to kW without authoritative power factor data.' }); return;
    }
    normalized.push({
      operating_date: dateValue.date,
      block_index: block,
      load_kw: loadKw,
      ...(solarColumn ? { solar_generation_kw: row[solarColumn] || '' } : {}),
      ...(actualColumn ? { actual_drawal_kw: row[actualColumn] || '' } : {}),
      ...(scheduledColumn ? { scheduled_drawal_kw: row[scheduledColumn] || '' } : {}),
    });
  });

  const columns = ['operating_date', 'block_index', 'load_kw'];
  if (solarColumn) columns.push('solar_generation_kw');
  if (actualColumn) columns.push('actual_drawal_kw');
  if (scheduledColumn) columns.push('scheduled_drawal_kw');
  const canonicalCsv = normalized.length ? Papa.unparse(normalized, { columns }) : '';
  const validation = errors.length === 0
    ? parseAndValidateCsv(canonicalCsv, siteId, { checksumSource: content, recordChecksum: false })
    : null;
  return { detection, mapping, canonicalCsv, sampleRows: normalized.slice(0, 5), normalizationErrors: errors, validation };
}
