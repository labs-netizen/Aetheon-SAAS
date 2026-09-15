import type { GridForecastResponseContract } from '@/types/analytics-contracts';

export const REPLAY_LABEL = 'HISTORICAL BACKTEST — NOT LIVE OPERATIONAL ADVICE';

export interface ReplayPriceRow {
  block_index: number;
  time_start: string;
  time_end: string;
  mcp_rs_per_mwh: number | string;
  delivery_date: string;
  source_type: string | null;
  source_reference: string | null;
  source_file_hash: string | null;
  provenance_status: string;
  verification_status: string;
}

export function assessReplayPrices(rows: ReplayPriceRow[], targetDate: string) {
  const blocks = new Map<number, number>();
  const authoritative = rows.every((row) => row.delivery_date === targetDate &&
    row.verification_status === 'VERIFIED' && row.provenance_status === 'OFFICIAL_SOURCE_CONFIRMED' &&
    Boolean(row.source_type && row.source_reference && row.source_file_hash));
  let canonical = true;
  for (const row of rows) {
    const index = Number(row.block_index);
    const mcp = Number(row.mcp_rs_per_mwh);
    const start = (index - 1) * 15;
    const end = index * 15;
    const hhmm = (minutes: number) => minutes === 1440 ? '24:00'
      : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    if (!Number.isInteger(index) || index < 1 || index > 96 || blocks.has(index) || row.mcp_rs_per_mwh === null ||
      !Number.isFinite(mcp) || mcp < 0 || row.time_start !== hhmm(start) || row.time_end !== hhmm(end)) {
      canonical = false;
      continue;
    }
    blocks.set(index, mcp);
  }
  const status = rows.length === 0 ? 'MISSING'
    : rows.length !== 96 || blocks.size !== 96 || !canonical ? 'INCOMPLETE'
    : !authoritative ? 'UNVERIFIED' : 'READY';
  return { status, blocks: status === 'READY' ? Array.from({ length: 96 }, (_, index) => ({
    block_index: index + 1, mcp_rs_per_mwh: blocks.get(index + 1)!,
  })) : [] };
}

export function calculateReplayOutputs(forecast: GridForecastResponseContract, prices: Array<{ block_index: number; mcp_rs_per_mwh: number }>, actual: number[] | null) {
  if (forecast.blocks.length !== 96 || prices.length !== 96) throw new Error('REPLAY_BLOCKS_INCOMPLETE');
  const forecastLoads = forecast.blocks.map((block) => block.forecast_load_kw);
  const priceValues = prices.map((block) => block.mcp_rs_per_mwh);
  const lowest = Math.min(...priceValues);
  const highest = Math.max(...priceValues);
  const lowestBlocks = prices.filter((block) => block.mcp_rs_per_mwh === lowest).map((block) => block.block_index);
  const highestBlocks = prices.filter((block) => block.mcp_rs_per_mwh === highest).map((block) => block.block_index);
  const indicativeEnergyComponentInr = forecastLoads.reduce((total, demandKw, index) =>
    total + demandKw * 0.25 * priceValues[index] / 1000, 0);
  let actualMetrics = null;
  if (actual && actual.length === 96 && actual.every((load) => Number.isFinite(load) && load >= 0)) {
    const errors = forecastLoads.map((load, index) => load - actual[index]);
    const forecastPeak = Math.max(...forecastLoads);
    const actualPeak = Math.max(...actual);
    actualMetrics = {
      mae_kw: errors.reduce((sum, error) => sum + Math.abs(error), 0) / 96,
      rmse_kw: Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / 96),
      smape_pct: errors.reduce((sum, error, index) => {
        const denominator = Math.abs(forecastLoads[index]) + Math.abs(actual[index]);
        return sum + (denominator > 0 ? 200 * Math.abs(error) / denominator : 0);
      }, 0) / 96,
      peak_timing_error_minutes: (forecastLoads.indexOf(forecastPeak) - actual.indexOf(actualPeak)) * 15,
      peak_magnitude_error_kw: forecastPeak - actualPeak,
    };
  }
  return {
    peak_forecast_block: forecast.peak_demand_block,
    peak_forecast_kw: forecast.peak_demand_kw,
    lowest_iex_mcp_rs_per_mwh: lowest,
    lowest_iex_mcp_blocks: lowestBlocks,
    highest_iex_mcp_rs_per_mwh: highest,
    highest_iex_mcp_blocks: highestBlocks,
    indicative_iex_energy_component_inr: indicativeEnergyComponentInr,
    price_sensitive_windows: { lower_exchange_price_blocks: lowestBlocks, higher_exchange_price_blocks: highestBlocks },
    actual_comparison: actualMetrics,
  };
}
