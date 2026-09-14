import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('multi-day analytics date scoping', () => {
  it('keeps DSM, BESS, and Renewable inputs explicitly operating-date scoped', () => {
    const modules = [
      source('src/app/api/dsm/route.ts'),
      source('src/app/api/bess/route.ts'),
      source('src/app/api/renewables/route.ts'),
    ];
    for (const moduleSource of modules) {
      expect(moduleSource).toMatch(/\.eq\(\s*'operating_date'\s*,\s*operatingDate\s*\)/);
      expect(moduleSource).not.toMatch(/\.slice\(\s*-?96|\.limit\(\s*96/);
    }
  });

  it('confirms Open Access Compliance has no interval ingestion dependency', () => {
    expect(source('src/app/api/compliance/route.ts')).not.toContain('interval_data_96');
  });

  it('keeps Grid input completeness separate from forecast output length', () => {
    const page = source('src/app/grid-intelligence/page.tsx');
    expect(page).toContain('forecastResult?.input_evidence?.total_blocks_received ?? forecastBlocks.length');
    expect(page).toContain('forecastResult?.input_evidence?.completeness_pct');
  });
});
