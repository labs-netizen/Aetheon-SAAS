import { describe, expect, it } from 'vitest';
import { parseGridForecastResponse } from '@/lib/analytics/grid-input-evidence';

const evidence = {
  operating_date: '2026-01-02',
  total_blocks_expected: 96,
  total_blocks_received: 96,
  completeness_pct: 100,
  is_complete: true,
  freshness: 'STALE',
  latest_timestamp_utc: '2026-01-02T18:15:00.000Z',
  source: 'interval_data_96',
};

describe('Grid forecast HTTP response contract', () => {
  it('retains committed input evidence when forecast output is suppressed', async () => {
    const payload = {
      forecast_available: false,
      forecast_status: 'SUPPRESSED',
      is_suppressed: true,
      suppression_reason: 'LIVE_MODEL_AND_PRICE_FEED_REQUIRED',
      input_evidence: evidence,
      blocks: [],
    };
    const result = await parseGridForecastResponse(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(result).toEqual({ data: payload, warning: null });
    expect(result.data.input_evidence).toMatchObject({ operating_date: '2026-01-02', total_blocks_received: 96, completeness_pct: 100 });
    expect(result.data.blocks).toEqual([]);
  });

  it('does not discard evidence from a structured suppressed non-2xx response', async () => {
    const payload = { error: 'FORECAST_UNAVAILABLE', is_suppressed: true, input_evidence: evidence, blocks: [] };
    await expect(parseGridForecastResponse(new Response(JSON.stringify(payload), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }))).resolves.toEqual({ data: payload, warning: 'FORECAST_UNAVAILABLE' });
  });

  it('keeps genuine authentication and database failures as errors', async () => {
    await expect(parseGridForecastResponse(new Response(JSON.stringify({ error: 'GRID_INPUT_LOOKUP_FAILED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }))).rejects.toThrow('GRID_INPUT_LOOKUP_FAILED');
  });
});
