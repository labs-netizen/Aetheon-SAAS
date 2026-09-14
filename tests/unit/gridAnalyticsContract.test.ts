import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validGridAnalyticsResponse } from '@/lib/analytics/domain-safety';

const responses = JSON.parse(readFileSync(
  resolve(process.cwd(), 'tests/fixtures/grid_forecast_contract_responses.json'),
  'utf8'
));
const stale = responses.stale_input;
const eligible = responses.validated;
const block = (index: number) => {
  const minutes = (index - 1) * 15;
  const end = index * 15;
  return {
    block_index: index,
    start_time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    end_time: end === 1440 ? '24:00' : `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
    forecast_load_kw: 1000,
    forecast_price_inr_per_mwh: null,
    confidence_lower_kw: 900,
    confidence_upper_kw: 1100,
    is_high_cost_window: null,
  };
};

describe('authoritative Grid analytics response contract', () => {
  it('accepts the exact stale response serialized by FastAPI', () => {
    expect(validGridAnalyticsResponse(stale, stale.site_id, stale.operating_date)).toBe(true);
    expect(stale.blocks).toEqual([]);
  });

  it('accepts a validated eligible demand forecast with exactly 96 no-price blocks', () => {
    expect(validGridAnalyticsResponse(eligible, eligible.site_id, eligible.operating_date)).toBe(true);
    expect(validGridAnalyticsResponse({ ...eligible, blocks: eligible.blocks.slice(0, 95) }, eligible.site_id, eligible.operating_date)).toBe(false);
  });

  it.each(['calibrating', 'failed_validation'])('accepts the real FastAPI %s suppression', (key) => {
    const response = responses[key];
    expect(validGridAnalyticsResponse(response, response.site_id, response.operating_date)).toBe(true);
  });

  it('rejects malformed or internally contradictory analytics output', () => {
    expect(validGridAnalyticsResponse({ ...stale, forecast_status: 'AVAILABLE' }, stale.site_id, stale.operating_date)).toBe(false);
    expect(validGridAnalyticsResponse({ ...stale, blocks: [block(1)] }, stale.site_id, stale.operating_date)).toBe(false);
    expect(validGridAnalyticsResponse({ ...stale, price_status: 'AVAILABLE' }, stale.site_id, stale.operating_date)).toBe(false);
  });
});
