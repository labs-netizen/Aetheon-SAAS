import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flexibilityChartData, optimizeGridFlexibility, validateFlexibilityProfile } from '@/lib/analytics/grid-flexibility';

const siteId = 'b4233eac-4f81-4bd2-bab7-8f4e1b1314ab';
const orgId = '129cfc77-f611-4191-9b9c-b248452e5641';
const prices = Array.from({ length: 96 }, (_, index) => ({ block_index: index + 1,
  mcp_rs_per_mwh: index === 79 ? 10000 : index === 19 ? 2500 : 6000 }));
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/grid_forecast_contract_responses.json'), 'utf8')).validated;
const forecast = { ...fixture, site_id: siteId, operating_date: '2026-05-01', forecast_target_date: '2026-05-01',
  blocks: fixture.blocks.map((block: any) => ({ ...block, forecast_load_kw: 1000, lower_bound_kw: 900, upper_bound_kw: 1100 })) };
const profile = { site_id: siteId, organisation_id: orgId, flexible_load_kw: 500,
  maximum_shift_energy_kwh_per_day: 125, maximum_upward_shift_kw_per_block: 500,
  maximum_downward_shift_kw_per_block: 500, earliest_shift_block: 1, latest_shift_block: 96,
  maximum_shift_duration_blocks: 1, critical_blocks: [] as number[], energy_conservation_required: true,
  minimum_operating_load_kw: 500, maximum_operating_load_kw: 1500, is_active: true };
const run = (overrides: Record<string, unknown> = {}, priceRows = prices, forecastValue = forecast) =>
  optimizeGridFlexibility({ mode: 'HISTORICAL_REPLAY', inputDate: '2026-04-30', targetDate: '2026-05-01',
    forecast: forecastValue, prices: priceRows, priceProvenance: { import_id: 'import-1', delivery_date: '2026-05-01',
      source_reference: 'https://www.iexindia.com/', source_file_hash: 'a'.repeat(64) },
    profile: { ...profile, ...overrides } });

describe('constrained Grid demand flexibility', () => {
  it('shifts energy deterministically from high to low MCP and lowers only the indicative component', () => {
    const first = run(); const second = run();
    expect(first.delta_kw[79]).toBe(-500);
    expect(first.delta_kw[19]).toBe(500);
    expect(first.shifted_energy_kwh).toBe(125);
    expect(first.delta_kw.reduce((sum, value) => sum + value, 0)).toBe(0);
    expect(first.optimized_indicative_component_inr).toBeLessThan(first.baseline_indicative_component_inr);
    expect(first).toMatchObject({ status: 'READY', modified_blocks: 2, uncertainty_status: 'ROBUST' });
    expect(first.runtime_ms).toBeLessThan(1000);
    expect({ ...second, runtime_ms: 0 }).toEqual({ ...first, runtime_ms: 0 });
    expect(flexibilityChartData(first)).toHaveLength(96);
  });

  it('keeps critical blocks untouched and enforces shift, duration, and operating-load bounds', () => {
    const boundedPrices = prices.map((row) => row.block_index === 79 ? { ...row, mcp_rs_per_mwh: 9000 }
      : row.block_index === 21 ? { ...row, mcp_rs_per_mwh: 3000 } : row);
    const decision = run({ critical_blocks: [80], maximum_shift_duration_blocks: 2,
      maximum_downward_shift_kw_per_block: 25, maximum_upward_shift_kw_per_block: 50,
      maximum_shift_energy_kwh_per_day: 100, minimum_operating_load_kw: 950, maximum_operating_load_kw: 1025 }, boundedPrices);
    expect(decision.delta_kw[79]).toBe(0);
    expect(Math.max(...decision.delta_kw)).toBeLessThanOrEqual(25);
    expect(Math.min(...decision.delta_kw)).toBeGreaterThanOrEqual(-25);
    expect(decision.delta_kw.filter((value) => value < 0)).toHaveLength(2);
    expect(decision.optimized_profile_kw.every((value) => value >= 950 && value <= 1025)).toBe(true);
  });

  it('does not force a change without a beneficial price difference', () => {
    const flat = run({}, prices.map((row) => ({ ...row, mcp_rs_per_mwh: 5000 })));
    expect(flat.modified_blocks).toBe(0);
    expect(flat.shifted_energy_kwh).toBe(0);
    expect(flat.indicative_difference_inr).toBe(0);
  });

  it('labels interval-sensitive decisions and does not fabricate interval confidence', () => {
    const sensitive = run({ minimum_operating_load_kw: 950 });
    expect(sensitive.uncertainty_status).toBe('SENSITIVE_TO_FORECAST_UNCERTAINTY');
    const noIntervals = { ...forecast, blocks: forecast.blocks.map((block: any) => ({ ...block,
      lower_bound_kw: null, upper_bound_kw: null, confidence_lower_kw: null, confidence_upper_kw: null })) };
    expect(run({}, prices, noIntervals).uncertainty_status).toBe('INSUFFICIENT_INTERVAL_EVIDENCE');
  });

  it('fails closed for invalid profiles, incomplete/wrong-date prices, and invalid forecast evidence', () => {
    expect(validateFlexibilityProfile({ ...profile, flexible_load_kw: 0 })).toBeNull();
    expect(() => run({}, prices.slice(0, 95))).toThrow('EXACT_DATE_VERIFIED_IEX_DAM_REQUIRED');
    expect(() => optimizeGridFlexibility({ mode: 'LIVE', inputDate: '2026-04-30', targetDate: '2026-05-02',
      forecast, prices, priceProvenance: { import_id: 'x', delivery_date: '2026-05-01', source_reference: 'x', source_file_hash: 'x' }, profile })).toThrow('EXACT_DATE_VERIFIED_IEX_DAM_REQUIRED');
    expect(() => run({}, prices, { ...forecast, forecast_available: false, blocks: [] })).toThrow('VALIDATED_96_BLOCK_FORECAST_REQUIRED');
  });

  it('keeps persistence tenant-scoped, audited, and unavailable to direct authenticated writes', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260916000031_grid_site_flexibility_profiles.sql'), 'utf8');
    expect(migration).toContain('FOREIGN KEY (site_id, organisation_id)');
    expect(migration).toContain('public.has_site_access(site_id)');
    expect(migration).toContain("p_actor_role NOT IN ('ORGANISATION_ADMIN','ENERGY_MANAGER')");
    expect(migration).toContain("'SITE_FLEXIBILITY_PROFILE_UPSERTED'");
    expect(migration).toContain('REVOKE ALL ON public.site_flexibility_profiles FROM PUBLIC, anon, authenticated');
    expect(migration).not.toContain('GRANT INSERT, UPDATE, DELETE ON public.site_flexibility_profiles TO authenticated');
  });
});
