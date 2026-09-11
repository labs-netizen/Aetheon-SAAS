export type MappingConfidence = 'high' | 'medium' | 'low';
export type CsvDateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'ISO-8601';
export type MeasurementUnit = 'kW' | 'MW' | 'kVA' | 'MVA' | 'kWh' | 'MWh';
export type SemanticField = 'operating_date' | 'timestamp' | 'time' | 'block_index' | 'load_kw' | 'energy' | 'unit';

export interface DetectedMapping {
  sourceColumn: string;
  targetField: SemanticField;
  confidence: MappingConfidence;
  reason: string;
}

export interface CsvSchemaMapping {
  dateColumn?: string;
  timestampColumn?: string;
  timeColumn?: string;
  blockColumn?: string;
  measurementColumn?: string;
  unitColumn?: string;
  dateFormat?: CsvDateFormat;
  measurementUnit?: MeasurementUnit;
  confirmEnergyToPower?: boolean;
}

export interface SchemaDetectionResult {
  columns: string[];
  totalRows: number;
  delimiter: string;
  proposedMappings: DetectedMapping[];
  mapping: CsvSchemaMapping;
  detectedDateFormat?: CsvDateFormat;
  detectedIntervalMinutes?: number;
  detectedMeasurementUnit?: MeasurementUnit;
  warnings: string[];
  parserErrors: string[];
  requiresConfirmation: boolean;
}
