import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveGridInputEvidence } from './grid-input-evidence';

export const LOAD_VISUAL_WINDOWS = [7, 30, 90] as const;
export type LoadVisualWindow = typeof LOAD_VISUAL_WINDOWS[number];
export type LoadRow = { operating_date: string; block_index: number; load_kw: number | string | null; data_quality: string };
export type LoadPoint = { block_index: number; time: string; load_kw: number };

export const blockTime = (index: number) => `${String(Math.floor((index - 1) / 4)).padStart(2, '0')}:${String(((index - 1) % 4) * 15).padStart(2, '0')}`;

export function siteCapacityPlausibility(maxKw: number | null, demand: number | null, unit: string | null) {
  const kva = unit === 'kVA' ? demand : unit === 'MVA' && demand !== null ? demand * 1000 : null;
  if (maxKw === null || kva === null || !Number.isFinite(kva) || kva <= 0) return null;
  // kW cannot exceed kVA at PF <= 1. A 20% margin makes this an investigation cue, not a compliance claim.
  return maxKw > kva * 1.2 ? { code: 'SITE_CAPACITY_PLAUSIBILITY_WARNING', measured_peak_kw: maxKw,
    sanctioned_demand_kva: kva, message: 'Measured kW substantially exceeds recorded sanctioned kVA. Check site metadata, file/site selection, and measurement units or scaling. This is not a finding of contract violation.' } : null;
}

export function aggregateLoadVisualization(rows: LoadRow[], selectedDate: string | null, windowDays: number,
  demand: number | null, unit: string | null) {
  const byDate = new Map<string, LoadRow[]>();
  for (const row of rows) byDate.set(row.operating_date, [...(byDate.get(row.operating_date) || []), row]);
  const dates = [...byDate.keys()].sort();
  const complete = dates.flatMap((date) => {
    const day = byDate.get(date)!;
    const indexes = new Set(day.map((row) => Number(row.block_index)));
    if (day.length !== 96 || indexes.size !== 96 || day.some((row) =>
      row.data_quality !== 'PASSED' || !Number.isInteger(Number(row.block_index)) || Number(row.block_index) < 1 ||
      Number(row.block_index) > 96 || row.load_kw === null || !Number.isFinite(Number(row.load_kw)) || Number(row.load_kw) < 0)) return [];
    return [{ date, points: day.map((row) => ({ block_index: Number(row.block_index), time: blockTime(Number(row.block_index)), load_kw: Number(row.load_kw) }))
      .sort((a, b) => a.block_index - b.block_index) }];
  });
  const selectedRows = selectedDate ? byDate.get(selectedDate) || [] : [];
  const selectedProfile = selectedRows.filter((row) => Number.isInteger(Number(row.block_index)) && Number(row.block_index) >= 1 &&
    Number(row.block_index) <= 96 && row.load_kw !== null && Number.isFinite(Number(row.load_kw)) && Number(row.load_kw) >= 0)
    .map((row) => ({ block_index: Number(row.block_index), time: blockTime(Number(row.block_index)), load_kw: Number(row.load_kw) }))
    .sort((a, b) => a.block_index - b.block_index);
  const selectedDayQuality = !selectedRows.length ? 'NO_DATA' : complete.some((day) => day.date === selectedDate)
    ? 'PASSED' : 'INCOMPLETE_OR_FAILED_QUALITY';
  const values = complete.flatMap((day) => day.points.map((point) => point.load_kw));
  const observedBlocks = dates.reduce((total, date) => {
    const indexes = new Set((byDate.get(date) || []).filter((row) => row.load_kw !== null &&
      Number.isFinite(Number(row.load_kw)) && Number(row.load_kw) >= 0 && Number.isInteger(Number(row.block_index)) &&
      Number(row.block_index) >= 1 && Number(row.block_index) <= 96).map((row) => Number(row.block_index)));
    return total + indexes.size;
  }, 0);
  const sorted = [...values].sort((a, b) => a - b);
  const peak = complete.flatMap((day) => day.points.map((point) => ({ ...point, operating_date: day.date })))
    .reduce<{ operating_date: string; block_index: number; time: string; load_kw: number } | null>((winner, point) =>
      !winner || point.load_kw > winner.load_kw ? point : winner, null);
  const typical = (weekend: boolean) => {
    const days = complete.filter((day) => {
      const dow = new Date(`${day.date}T00:00:00Z`).getUTCDay();
      return (dow === 0 || dow === 6) === weekend;
    });
    return days.length ? Array.from({ length: 96 }, (_, index) => ({ block_index: index + 1, time: blockTime(index + 1),
      load_kw: days.reduce((sum, day) => sum + day.points[index].load_kw, 0) / days.length })) : [];
  };
  const summary = { date_from: dates[0] || null, date_to: dates.at(-1) || null, window_days: windowDays,
    observed_days: dates.length, valid_days: complete.length, valid_blocks: values.length,
    completeness_pct: dates.length ? Number((observedBlocks / (dates.length * 96) * 100).toFixed(2)) : 0,
    min_kw: sorted[0] ?? null, average_kw: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    p95_kw: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    max_kw: peak?.load_kw ?? null, peak_date: peak?.operating_date ?? null, peak_time: peak?.time ?? null };
  return { available_dates: dates, selected_date: selectedDate, selected_profile: selectedProfile,
    selected_day_quality: selectedDayQuality,
    daily_trend: complete.map((day) => ({ operating_date: day.date,
      average_kw: day.points.reduce((sum, point) => sum + point.load_kw, 0) / 96,
      peak_kw: Math.max(...day.points.map((point) => point.load_kw)) })),
    typical_weekday: typical(false), typical_weekend: typical(true),
    heatmap: complete.map((day) => ({ operating_date: day.date, load_kw: day.points.map((point) => point.load_kw) })),
    summary, plausibility_warning: siteCapacityPlausibility(summary.max_kw, demand, unit) };
}

export async function loadCommittedVisualization(client: SupabaseClient, siteId: string, windowDays: LoadVisualWindow,
  requestedDate: string | null, demand: number | null, unit: string | null) {
  const latest = await resolveGridInputEvidence(client, siteId);
  const anchor = latest.operating_date;
  if (!anchor) return aggregateLoadVisualization([], requestedDate, windowDays, demand, unit);
  const endMs = Date.parse(`${anchor}T00:00:00Z`);
  const startMs = endMs - (windowDays - 1) * 86400000;
  const rows: LoadRow[] = [];
  // Eight-date windows remain below PostgREST's 1,000-row response limit for canonical days.
  for (let toMs = endMs; toMs >= startMs; toMs -= 8 * 86400000) {
    const fromMs = Math.max(startMs, toMs - 7 * 86400000);
    const { data, error } = await client.from('interval_data_96')
      .select('operating_date,block_index,load_kw,data_quality').eq('site_id', siteId)
      .gte('operating_date', new Date(fromMs).toISOString().slice(0, 10))
      .lte('operating_date', new Date(toMs).toISOString().slice(0, 10)).limit(1000);
    if (error) throw new Error(`LOAD_VISUALIZATION_LOOKUP_FAILED: ${error.message}`);
    if (data?.length === 1000) throw new Error('LOAD_VISUALIZATION_ROW_CAP_EXCEEDED');
    rows.push(...(data || []));
  }
  if (requestedDate && !rows.some((row) => row.operating_date === requestedDate)) {
    const { data, error } = await client.from('interval_data_96')
      .select('operating_date,block_index,load_kw,data_quality').eq('site_id', siteId)
      .eq('operating_date', requestedDate).limit(100);
    if (error) throw new Error(`LOAD_VISUALIZATION_LOOKUP_FAILED: ${error.message}`);
    if (data?.length === 100) throw new Error('LOAD_VISUALIZATION_ROW_CAP_EXCEEDED');
    rows.push(...(data || []));
  }
  const selected = requestedDate || anchor;
  const result = aggregateLoadVisualization(rows, selected, windowDays, demand, unit);
  // An explicitly requested day outside the trend window never changes recent-window statistics.
  if (requestedDate && (Date.parse(`${requestedDate}T00:00:00Z`) < startMs || requestedDate > anchor)) {
    const recent = rows.filter((row) => row.operating_date >= new Date(startMs).toISOString().slice(0, 10) && row.operating_date <= anchor);
    const stats = aggregateLoadVisualization(recent, selected, windowDays, demand, unit);
    return { ...stats, selected_date: selected, selected_profile: result.selected_profile,
      selected_day_quality: result.selected_day_quality };
  }
  return result;
}
