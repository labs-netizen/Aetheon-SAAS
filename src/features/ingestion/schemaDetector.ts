import Papa from 'papaparse';
import type {
  CsvDateFormat,
  CsvSchemaMapping,
  DetectedMapping,
  MeasurementUnit,
  SchemaDetectionResult,
  SemanticField,
} from './mappingTypes';

export interface FlexibleCsvParse {
  rows: Record<string, string>[];
  columns: string[];
  delimiter: string;
  parserErrors: string[];
}

const normaliseHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function parseFlexibleCsv(content: string): FlexibleCsvParse {
  const result = Papa.parse<Record<string, string>>(content.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
    transform: (value) => value.trim(),
  });
  return {
    rows: result.data,
    columns: result.meta.fields || [],
    delimiter: result.meta.delimiter,
    parserErrors: result.errors.map((error) => `CSV_PARSE_ERROR${typeof error.row === 'number' ? ` row ${error.row + 2}` : ''}: ${error.message}`),
  };
}

function headerScore(header: string, field: SemanticField): number {
  const h = normaliseHeader(header);
  const exact: Record<SemanticField, string[]> = {
    operating_date: ['operating_date', 'operatingdate', 'reading_date', 'readingdate', 'date'],
    timestamp: ['timestamp', 'datetime', 'date_time', 'reading_datetime', 'reading_timestamp'],
    time: ['reading_time', 'readingtime', 'time'],
    block_index: ['block_index', 'block', 'interval', 'interval_number', 'slot'],
    load_kw: ['load_kw', 'demand_kw', 'power_kw', 'kw', 'load_mw', 'demand_mw', 'power_mw', 'mw', 'load', 'demand', 'power', 'kva', 'mva'],
    energy: ['energy', 'consumption', 'kwh', 'mwh', 'energy_kwh', 'energy_mwh'],
    unit: ['unit', 'units', 'measurement_unit'],
  };
  if (exact[field].includes(h)) return ['load', 'demand', 'power', 'energy', 'consumption'].includes(h) ? 80 : 100;
  if (field === 'load_kw' && /(^|_)(load|demand|power)(_|$)/.test(h) && !/(kwh|mwh|energy|consumption)/.test(h)) return 75;
  if (field === 'energy' && /(kwh|mwh|energy|consumption)/.test(h)) return 90;
  return 0;
}

function unitFromHeader(header: string): MeasurementUnit | undefined {
  const h = normaliseHeader(header);
  if (/(^|_)mwh($|_)/.test(h) || h === 'mwh') return 'MWh';
  if (/(^|_)kwh($|_)/.test(h) || h === 'kwh') return 'kWh';
  if (/(^|_)mva($|_)/.test(h) || h === 'mva') return 'MVA';
  if (/(^|_)kva($|_)/.test(h) || h === 'kva') return 'kVA';
  if (/(^|_)mw($|_)/.test(h) || h === 'mw') return 'MW';
  if (/(^|_)kw($|_)/.test(h) || h === 'kw') return 'kW';
  return undefined;
}

function unitFromValues(values: string[]): MeasurementUnit | undefined {
  const aliases: Record<string, MeasurementUnit> = {
    kw: 'kW', mw: 'MW', kva: 'kVA', mva: 'MVA', kwh: 'kWh', mwh: 'MWh',
  };
  const units = new Set(values.filter(Boolean).map((value) => aliases[value.trim().toLowerCase()]).filter(Boolean));
  return units.size === 1 ? [...units][0] : undefined;
}

function detectDateFormat(values: string[]): { format?: CsvDateFormat; ambiguous: boolean; invalid: boolean } {
  const nonempty = values.filter(Boolean).slice(0, 200);
  if (nonempty.length === 0) return { ambiguous: false, invalid: true };
  if (nonempty.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return { format: 'YYYY-MM-DD', ambiguous: false, invalid: false };
  if (nonempty.every((v) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(v))) return { format: 'ISO-8601', ambiguous: false, invalid: false };
  for (const separator of ['/', '-'] as const) {
    const matches = nonempty.map((v) => v.match(new RegExp(`^(\\d{2})\\${separator}(\\d{2})\\${separator}(\\d{4})$`)));
    if (matches.every(Boolean)) {
      const parts = matches as RegExpMatchArray[];
      if (parts.some((m) => Number(m[2]) > 12)) return { ambiguous: false, invalid: true };
      if (parts.some((m) => Number(m[1]) > 12)) return { format: separator === '/' ? 'DD/MM/YYYY' : 'DD-MM-YYYY', ambiguous: false, invalid: false };
      return { ambiguous: true, invalid: false };
    }
  }
  return { ambiguous: false, invalid: true };
}

function pick(columns: string[], field: SemanticField, warnings: string[], mappings: DetectedMapping[]): string | undefined {
  const candidates = columns.map((sourceColumn) => ({ sourceColumn, score: headerScore(sourceColumn, field) })).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  if (!candidates.length) return undefined;
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    warnings.push(`MULTIPLE_PLAUSIBLE_${field.toUpperCase()}_COLUMNS: ${candidates.filter((c) => c.score === candidates[0].score).map((c) => c.sourceColumn).join(', ')}`);
  }
  const winner = candidates[0];
  const confidence = winner.score >= 90 ? 'high' : winner.score >= 70 ? 'medium' : 'low';
  mappings.push({ sourceColumn: winner.sourceColumn, targetField: field, confidence, reason: `${field.replace('_', ' ')} header match` });
  return winner.sourceColumn;
}

export function detectCsvSchema(content: string, overrides: CsvSchemaMapping = {}): SchemaDetectionResult {
  const parsed = parseFlexibleCsv(content);
  const warnings: string[] = [];
  const proposedMappings: DetectedMapping[] = [];
  const timestampColumn = overrides.timestampColumn || pick(parsed.columns, 'timestamp', warnings, proposedMappings);
  const dateColumn = overrides.dateColumn || (!timestampColumn ? pick(parsed.columns, 'operating_date', warnings, proposedMappings) : undefined);
  const timeColumn = overrides.timeColumn || (!timestampColumn ? pick(parsed.columns, 'time', warnings, proposedMappings) : undefined);
  const blockColumn = overrides.blockColumn || pick(parsed.columns, 'block_index', warnings, proposedMappings);
  const powerColumn = pick(parsed.columns, 'load_kw', warnings, proposedMappings);
  const energyColumn = pick(parsed.columns, 'energy', warnings, proposedMappings);
  const measurementColumn = overrides.measurementColumn || powerColumn || energyColumn;
  const unitColumn = overrides.unitColumn || pick(parsed.columns, 'unit', warnings, proposedMappings);
  const dateSource = timestampColumn || dateColumn;
  const dateDetection = dateSource ? detectDateFormat(parsed.rows.map((row) => row[dateSource])) : { ambiguous: false, invalid: true };
  const detectedMeasurementUnit = overrides.measurementUnit
    || (measurementColumn ? unitFromHeader(measurementColumn) : undefined)
    || (unitColumn ? unitFromValues(parsed.rows.map((row) => row[unitColumn])) : undefined);

  if (!dateSource) warnings.push('NO_USABLE_DATE_OR_TIMESTAMP');
  else if (dateDetection.ambiguous && !overrides.dateFormat) warnings.push('AMBIGUOUS_DATE_FORMAT: confirm DD/MM/YYYY or provide an unambiguous date format.');
  else if (dateDetection.invalid && !overrides.dateFormat) warnings.push('UNSUPPORTED_OR_INVALID_DATE_FORMAT');
  if (!blockColumn && !timestampColumn && !timeColumn) warnings.push('NO_USABLE_INTERVAL_OR_TIME');
  if (!measurementColumn) warnings.push('NO_USABLE_POWER_OR_ENERGY_COLUMN');
  if (measurementColumn === energyColumn && !overrides.confirmEnergyToPower) warnings.push('ENERGY_VS_POWER_AMBIGUITY: energy cannot be treated as power without explicit confirmation.');
  if (!detectedMeasurementUnit) warnings.push('MEASUREMENT_UNIT_REQUIRES_CONFIRMATION');
  if (proposedMappings.some((mapping) => mapping.confidence !== 'high')) warnings.push('MEDIUM_OR_LOW_CONFIDENCE_MAPPING_REQUIRES_CONFIRMATION');

  const mapping: CsvSchemaMapping = {
    dateColumn,
    timestampColumn,
    timeColumn,
    blockColumn,
    measurementColumn,
    unitColumn,
    dateFormat: overrides.dateFormat || dateDetection.format,
    measurementUnit: detectedMeasurementUnit,
    confirmEnergyToPower: overrides.confirmEnergyToPower,
  };
  return {
    columns: parsed.columns,
    totalRows: parsed.rows.length,
    delimiter: parsed.delimiter,
    proposedMappings,
    mapping,
    detectedDateFormat: mapping.dateFormat,
    detectedIntervalMinutes: blockColumn || timestampColumn || timeColumn ? 15 : undefined,
    detectedMeasurementUnit,
    warnings,
    parserErrors: parsed.parserErrors,
    requiresConfirmation: warnings.length > 0 || parsed.parserErrors.length > 0,
  };
}
