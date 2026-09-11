import { describe, expect, it } from 'vitest';
import { prepareCsvImport } from '@/features/ingestion/normalizer';

const rowsForDay = (
  date: string,
  row: (block: number, time: string) => string,
  header: string,
  delimiter = ','
) => {
  const rows = [header];
  for (let block = 1; block <= 96; block++) {
    const minute = (block - 1) * 15;
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    rows.push(row(block, time));
  }
  return rows.join('\n').replaceAll(',', delimiter);
};

describe('schema-flexible CSV ingestion adapter', () => {
  it('keeps the canonical format working', () => {
    const csv = rowsForDay('2026-01-13', (b) => `2026-01-13,${b},100`, 'operating_date,block_index,load_kw');
    const result = prepareCsvImport(csv, 'canonical');
    expect(result.normalizationErrors).toHaveLength(0);
    expect(result.validation?.validBlocks).toBe(96);
  });

  it('accepts reordered columns and ignores arbitrary extras', () => {
    const csv = rowsForDay('2026-01-13', (b) => `note,250,${b},2026-01-13,x`, 'comment,load_kw,block,reading_date,unused');
    const result = prepareCsvImport(csv, 'reordered');
    expect(result.validation?.validBlocks).toBe(96);
    expect(result.validation?.parsedData[0].load_kw).toBe(250);
  });

  it('accepts Date, Time, Load_kW and derives blocks', () => {
    const csv = rowsForDay('2026-01-13', (_b, time) => `2026-01-13,${time},500`, 'Date, Time, Load_kW');
    const result = prepareCsvImport(csv, 'date-time');
    expect(result.detection.requiresConfirmation).toBe(false);
    expect(result.validation?.validBlocks).toBe(96);
  });

  it('detects a semicolon delimiter', () => {
    const csv = rowsForDay('2026-01-13', (_b, time) => `2026-01-13,${time},500`, 'Date,Time,Load_kW', ';');
    const result = prepareCsvImport(csv, 'semicolon');
    expect(result.detection.delimiter).toBe(';');
    expect(result.validation?.validBlocks).toBe(96);
  });

  it('preserves blank optional canonical measurements as null', () => {
    const csv = rowsForDay('2026-01-13', (b) => `2026-01-13,${b},500,,,`, 'operating_date,block_index,load_kw,solar_generation_kw,actual_drawal_kw,scheduled_drawal_kw');
    const result = prepareCsvImport(csv, 'optional-null');
    expect(result.validation?.parsedData[0]).toMatchObject({
      solar_generation_kw: null,
      actual_drawal_kw: null,
      scheduled_drawal_kw: null,
    });
  });

  it('requires a unit confirmation for Timestamp, Demand then accepts the confirmed unit', () => {
    const csv = rowsForDay('2026-01-13', (_b, time) => `2026-01-13T${time}:00+05:30,500`, 'Timestamp,Demand');
    expect(prepareCsvImport(csv, 'timestamp-demand').detection.requiresConfirmation).toBe(true);
    const confirmed = prepareCsvImport(csv, 'timestamp-demand-confirmed', { measurementUnit: 'kW' }, true);
    expect(confirmed.validation?.validBlocks).toBe(96);
  });

  it('detects a supported unit from a constant unit column', () => {
    const csv = rowsForDay('2026-01-13', (b) => `2026-01-13,${b},0.5,MW`, 'Date,Block,Demand,Unit');
    const result = prepareCsvImport(csv, 'unit-column', {}, true);
    expect(result.detection.detectedMeasurementUnit).toBe('MW');
    expect(result.validation?.parsedData[0].load_kw).toBe(500);
  });

  it('accepts ReadingDate, Block, MW and normalizes MW to kW', () => {
    const csv = rowsForDay('2026-01-13', (b) => `13/01/2026,${b},1.25`, 'ReadingDate,Block,MW');
    const result = prepareCsvImport(csv, 'mw');
    expect(result.validation?.parsedData[0].load_kw).toBe(1250);
    expect(result.validation?.validBlocks).toBe(96);
  });

  it('trims BOM and whitespace-padded headers and values', () => {
    const csv = `\uFEFF${rowsForDay('2026-01-13', (b) => ` 2026-01-13 , ${b} , 100 `, ' operating_date , block_index , load_kw ')}`;
    expect(prepareCsvImport(csv, 'whitespace').validation?.validBlocks).toBe(96);
  });

  it('accepts ISO timestamps and derives 15-minute blocks', () => {
    const csv = rowsForDay('2026-01-13', (_b, time) => `2026-01-13T${time}:00+05:30,100`, 'Timestamp,Load_kW');
    const result = prepareCsvImport(csv, 'iso');
    expect(result.validation?.parsedData[95].block_index).toBe(96);
  });

  it('accepts an unambiguous DD/MM/YYYY date', () => {
    const csv = rowsForDay('2026-01-13', (b) => `13/01/2026,${b},100`, 'Date,Block,Load_kW');
    expect(prepareCsvImport(csv, 'dmy').validation?.validBlocks).toBe(96);
  });

  it('requires confirmation for ambiguous 03/04/2026', () => {
    const csv = rowsForDay('2026-01-13', (b) => `03/04/2026,${b},100`, 'Date,Block,Load_kW');
    const result = prepareCsvImport(csv, 'ambiguous');
    expect(result.detection.warnings.join(' ')).toContain('AMBIGUOUS_DATE_FORMAT');
    expect(result.validation).toBeNull();
  });

  it('does not silently treat kWh as kW', () => {
    const csv = rowsForDay('2026-01-13', (b) => `2026-01-13,${b},25`, 'Date,Block,Energy_kWh');
    const result = prepareCsvImport(csv, 'energy');
    expect(result.detection.warnings.join(' ')).toContain('ENERGY_VS_POWER_AMBIGUITY');
    expect(result.validation).toBeNull();
  });

  it('requires confirmation when multiple load columns are equally plausible', () => {
    const csv = rowsForDay('2026-01-13', (b) => `2026-01-13,${b},100,101`, 'Date,Block,Load_kW,Demand_kW');
    const result = prepareCsvImport(csv, 'multiple');
    expect(result.detection.warnings.join(' ')).toContain('MULTIPLE_PLAUSIBLE_LOAD_KW_COLUMNS');
    expect(result.validation).toBeNull();
  });

  it('structurally validates a 426-day flexible file', () => {
    const lines = ['Date,Time,Load_kW,Ignored'];
    const start = Date.UTC(2024, 0, 13);
    for (let day = 0; day < 426; day++) {
      const date = new Date(start + day * 86400000).toISOString().slice(0, 10);
      for (let block = 1; block <= 96; block++) {
        const minute = (block - 1) * 15;
        lines.push(`${date},${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')},100,x`);
      }
    }
    const result = prepareCsvImport(lines.join('\n'), '426-flexible');
    expect(result.validation).toMatchObject({ totalRows: 40896, validDays: 426, validBlocks: 40896 });
  });

  it('fails safely for malformed dates, duplicate intervals, incomplete days, and parser errors', () => {
    const invalidDate = prepareCsvImport('Date,Block,Load_kW\n31/02/2026,1,100', 'bad-date', { dateFormat: 'DD/MM/YYYY' }, true);
    expect(invalidDate.normalizationErrors[0].reason).toContain('INVALID_CALENDAR_DATE');

    const duplicate = rowsForDay('2026-01-13', (b) => `2026-01-13,${b === 96 ? 95 : b},100`, 'Date,Block,Load_kW');
    expect(prepareCsvImport(duplicate, 'duplicate').validation?.errors.some((error) => error.reason.includes('DUPLICATE_BLOCK'))).toBe(true);

    const incomplete = rowsForDay('2026-01-13', (b) => `2026-01-13,${b},100`, 'Date,Block,Load_kW').split('\n').slice(0, 96).join('\n');
    expect(prepareCsvImport(incomplete, 'incomplete').validation?.errors.some((error) => error.reason.includes('INVALID_DAY_BLOCK_COUNT'))).toBe(true);

    const malformed = prepareCsvImport('Date,Block,Load_kW\n"2026-01-13,1,100', 'parser');
    expect(malformed.normalizationErrors.some((error) => error.reason.includes('CSV_PARSE_ERROR'))).toBe(true);
  });
});
