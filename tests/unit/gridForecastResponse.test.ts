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

  it('uses committed history for forecasting without returning it as UI completeness evidence', () => {
    expect(forecastRoute).not.toContain('resolveGridInputEvidence');
    expect(forecastRoute).not.toContain('input_evidence');
    expect(forecastRoute).toContain('loadGridHistoricalInput');
    expect(forecastRoute).toContain('historicalDays: historicalInput.complete_days');
  });

  it('keeps authoritative market-price readiness independent from demand output', () => {
    expect(page).toContain('/api/grid/price-evidence');
    expect(page).toContain("priceEvidence?.readiness_status === 'READY'");
    expect(page).toContain('prices.get(b.block_index)');
    expect(page).not.toContain('b.forecast_price_inr_per_mwh ?? b.price_mwh');
    expect(page).toContain('IEX DAM MCP (₹/MWh)');
  });

  it('keeps stale or otherwise suppressed LIVE forecasts ahead of flexibility optimization', () => {
    expect(forecastRoute.indexOf('forecastResult.forecast_available === false'))
      .toBeLessThan(forecastRoute.lastIndexOf('resolveFlexibilityDecision'));
    expect(forecastRoute).toContain("suppression_reason: forecastResult.suppression_reason || 'VALIDATED_FORECAST_REQUIRED'");
    expect(page).toContain('Load-shift decision SUPPRESSED');
    expect(page).not.toContain('guaranteed savings');
  });
});
