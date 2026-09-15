import { REPLAY_LABEL } from './grid-replay';

export function replayCurvePoints(
  forecast: Array<{ block_index: number; forecast_load_kw: number }> | null,
  prices: Array<{ block_index: number; mcp_rs_per_mwh: number }> | null,
  actual: number[] | null | undefined,
  lowerBlocks: number[] = [], higherBlocks: number[] = []
) {
  const availableActual = actual?.length === 96 && actual.every((value) => Number.isFinite(value) && value >= 0);
  const lower = new Set(lowerBlocks);
  const higher = new Set(higherBlocks);
  const load = forecast?.length === 96 ? forecast.map((block) => ({ block_index: block.block_index,
    time: `${String(Math.floor((block.block_index - 1) / 4)).padStart(2, '0')}:${String(((block.block_index - 1) % 4) * 15).padStart(2, '0')}`,
    forecast_kw: block.forecast_load_kw,
    ...(availableActual ? { actual_kw: actual![block.block_index - 1] } : {}) })) : [];
  const mcp = prices?.length === 96 ? prices.map((block) => ({ block_index: block.block_index,
    time: `${String(Math.floor((block.block_index - 1) / 4)).padStart(2, '0')}:${String(((block.block_index - 1) % 4) * 15).padStart(2, '0')}`,
    mcp_rs_per_mwh: block.mcp_rs_per_mwh,
    price_window: lower.has(block.block_index) ? 'LOW' as const : higher.has(block.block_index) ? 'HIGH' as const : null })) : [];
  return { label: REPLAY_LABEL, load, mcp, actual_available: Boolean(availableActual) };
}
