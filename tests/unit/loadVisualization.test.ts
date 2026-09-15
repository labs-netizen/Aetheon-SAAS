import { describe, expect, it } from 'vitest';
import { aggregateLoadVisualization, siteCapacityPlausibility, type LoadRow } from '@/lib/analytics/load-visualization';
import { replayCurvePoints } from '@/lib/analytics/grid-replay-visualization';
import { REPLAY_LABEL } from '@/lib/analytics/grid-replay';

const day = (date: string, shift = 0): LoadRow[] => Array.from({ length: 96 }, (_, index) => ({
  operating_date: date, block_index: 96 - index, load_kw: 100 + (96 - index) + shift, data_quality: 'PASSED',
}));

describe('committed evidence visualization calculations', () => {
  it('orders all 96 actual blocks, aggregates only complete PASSED days and honours selected date', () => {
    const rows = [...day('2026-01-05'), ...day('2026-01-03', 50), ...day('2026-01-04').slice(0, 95)];
    const result = aggregateLoadVisualization(rows, '2026-01-03', 7, 1000, 'kVA');
    expect(result.selected_profile).toHaveLength(96);
    expect(result.selected_profile.map((point) => point.block_index)).toEqual(Array.from({ length: 96 }, (_, index) => index + 1));
    expect(result.selected_profile[0]).toEqual({ block_index: 1, time: '00:00', load_kw: 151 });
    expect(result.daily_trend.map((item) => item.operating_date)).toEqual(['2026-01-03', '2026-01-05']);
    expect(result.summary).toMatchObject({ observed_days: 3, valid_days: 2, valid_blocks: 192, peak_date: '2026-01-03' });
    expect(result.summary.completeness_pct).toBeCloseTo(99.65);
    expect(result.summary.p95_kw).toBeGreaterThanOrEqual(result.summary.average_kw!);
    expect(result.heatmap).toHaveLength(2);
    expect(result.typical_weekend).toHaveLength(96);
    expect(result.typical_weekday).toHaveLength(96);
  });

  it('keeps empty and incomplete data truthful and excludes failed quality from summary', () => {
    const empty = aggregateLoadVisualization([], null, 30, 1000, 'kVA');
    expect(empty.summary).toMatchObject({ valid_blocks: 0, completeness_pct: 0, min_kw: null });
    expect(empty.selected_profile).toEqual([]);
    const incomplete = aggregateLoadVisualization(day('2026-01-01').slice(0, 91), '2026-01-01', 7, 1000, 'kVA');
    expect(incomplete.selected_profile).toHaveLength(91);
    expect(incomplete.selected_day_quality).toBe('INCOMPLETE_OR_FAILED_QUALITY');
    expect(incomplete.daily_trend).toEqual([]);
    expect(incomplete.summary).toMatchObject({ valid_days: 0, valid_blocks: 0, completeness_pct: 94.79 });
    const failed = day('2026-01-02');
    failed[50].data_quality = 'FAILED';
    expect(aggregateLoadVisualization(failed, '2026-01-02', 7, 1000, 'kVA').summary.valid_blocks).toBe(0);
  });

  it('flags only materially implausible kW versus recorded kVA/MVA, without altering measurements', () => {
    expect(siteCapacityPlausibility(10000, 1500, 'kVA')).toMatchObject({ code: 'SITE_CAPACITY_PLAUSIBILITY_WARNING' });
    expect(siteCapacityPlausibility(10000, 1.5, 'MVA')).toMatchObject({ sanctioned_demand_kva: 1500 });
    expect(siteCapacityPlausibility(1500, 1500, 'kVA')).toBeNull();
    expect(siteCapacityPlausibility(10000, 1500, 'kW')).toBeNull();
  });

  it('labels replay evidence and never draws an unavailable actual series', () => {
    const forecast = Array.from({ length: 96 }, (_, index) => ({ block_index: index + 1, forecast_load_kw: 900 + index }));
    const prices = forecast.map((point) => ({ block_index: point.block_index, mcp_rs_per_mwh: 3000 + point.block_index }));
    const absent = replayCurvePoints(forecast, prices, null, [2], [95]);
    expect(absent.label).toBe(REPLAY_LABEL);
    expect(absent.actual_available).toBe(false);
    expect(absent.load[0]).not.toHaveProperty('actual_kw');
    expect(absent.mcp[1].price_window).toBe('LOW');
    expect(absent.mcp[94].price_window).toBe('HIGH');
    const actual = replayCurvePoints(forecast, prices, Array(96).fill(1000));
    expect(actual.actual_available).toBe(true);
    expect(actual.load[0]).toMatchObject({ actual_kw: 1000 });
  });
});
