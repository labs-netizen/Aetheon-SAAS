import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Grid input and forecast UI independence', () => {
  const page = source('src/app/grid-intelligence/page.tsx');
  const forecastRoute = source('src/app/api/forecast/route.ts');

  it('loads committed input evidence before forecast output', () => {
    expect(page.indexOf('/api/grid/input-evidence')).toBeGreaterThan(-1);
    expect(page.indexOf('/api/grid/input-evidence')).toBeLessThan(page.indexOf('/api/forecast'));
  });

  it('derives live completeness only from the independent evidence state', () => {
    expect(page).toContain('inputEvidence?.completeness_pct ?? 0.0');
    expect(page).toContain('inputEvidence?.received_blocks ?? 0');
    expect(page).toContain('inputEvidence?.quality_status || \'NO_DATA\'');
    expect(page).not.toContain('forecastResult?.input_evidence');
    expect(page).not.toMatch(/totalBlocksReceived:[^\n]*forecastBlocks/);
  });

  it('keeps the forecast endpoint independent from committed-input queries', () => {
    expect(forecastRoute).not.toContain('resolveGridInputEvidence');
    expect(forecastRoute).not.toContain('input_evidence');
    expect(forecastRoute).toContain("forecast_status: 'SUPPRESSED'");
    expect(forecastRoute).toContain('blocks: []');
  });
});
