'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EvidenceCurve, type CurvePoint } from '@/components/shared/EvidenceCurve';
import { blockTime } from '@/lib/analytics/load-visualization';

interface LoadVisualization {
  site_id: string; source: 'COMMITTED_INTERVAL_DATA_96'; selected_date: string | null; available_dates: string[];
  selected_profile: Array<{ block_index: number; time: string; load_kw: number }>;
  selected_day_quality: 'PASSED' | 'INCOMPLETE_OR_FAILED_QUALITY' | 'NO_DATA';
  daily_trend: Array<{ operating_date: string; average_kw: number; peak_kw: number }>;
  typical_weekday: Array<{ block_index: number; time: string; load_kw: number }>;
  typical_weekend: Array<{ block_index: number; time: string; load_kw: number }>;
  heatmap: Array<{ operating_date: string; load_kw: number[] }>;
  summary: { date_from: string | null; date_to: string | null; window_days: number; observed_days: number; valid_days: number;
    valid_blocks: number; completeness_pct: number; min_kw: number | null; average_kw: number | null; p95_kw: number | null;
    max_kw: number | null; peak_date: string | null; peak_time: string | null };
  plausibility_warning: { code: string; measured_peak_kw: number; sanctioned_demand_kva: number; message: string } | null;
}

export function LoadVisualizationPanel({ siteId, refreshKey }: { siteId: string; refreshKey: number }) {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [response, setResponse] = useState<{ siteId: string; data: LoadVisualization } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const data = response?.siteId === siteId ? response.data : null;

  useEffect(() => { setSelectedDate(null); setResponse(null); setError(null); }, [siteId, refreshKey]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const load = async () => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error('AUTHENTICATED_SESSION_REQUIRED');
      const params = new URLSearchParams({ site_id: siteId, window_days: String(windowDays) });
      if (selectedDate) params.set('operating_date', selectedDate);
      const result = await fetch(`/api/ingestion/load-visualization?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
      });
      const body = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(body.details || body.error || `HTTP ${result.status}`);
      if (body.site_id !== siteId || body.source !== 'COMMITTED_INTERVAL_DATA_96') throw new Error('INVALID_LOAD_VISUALIZATION_RESPONSE');
      if (active) setResponse({ siteId, data: body as LoadVisualization });
    };
    load().catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : String(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [siteId, refreshKey, selectedDate, windowDays, supabase]);

  const kw = (value: number | null) => value === null ? '—' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })} kW`;
  const typical: CurvePoint[] = Array.from({ length: 96 }, (_, index) => ({ block_index: index + 1,
    time: data?.typical_weekday[index]?.time || data?.typical_weekend[index]?.time,
    weekday_kw: data?.typical_weekday[index]?.load_kw ?? null, weekend_kw: data?.typical_weekend[index]?.load_kw ?? null }));
  const scale = data?.summary.max_kw || 1;
  const measuredByBlock = new Map(data?.selected_profile.map((point) => [point.block_index, point.load_kw]) || []);
  const selectedCurve: CurvePoint[] = data?.selected_profile.length ? Array.from({ length: 96 }, (_, index) => ({
    block_index: index + 1, time: blockTime(index + 1), load_kw: measuredByBlock.get(index + 1) ?? null })) : [];
  return <section className="space-y-4 rounded border border-slate-700 bg-slate-900/50 p-4" data-testid="committed-load-visualization">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-base font-semibold text-slate-100">Committed Load Intelligence</h2>
        <p className="text-xs text-slate-400">Site-scoped measured kW from committed PASSED 15-minute blocks. Recent window ends at the latest complete day.</p></div>
      <div className="flex flex-wrap gap-2 text-xs">
        <label>Recent window <select aria-label="Recent window" value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value) as 7 | 30 | 90)}
          className="ml-1 rounded border border-slate-600 bg-slate-950 p-2">{[7, 30, 90].map((days) => <option key={days} value={days}>{days} days</option>)}</select></label>
        <label>Operating date <input aria-label="Operating date" type="date" value={selectedDate || data?.selected_date || ''}
          onChange={(event) => setSelectedDate(event.target.value || null)} className="ml-1 rounded border border-slate-600 bg-slate-950 p-2" /></label>
      </div>
    </div>
    {loading && <p role="status" className="text-xs text-slate-300">Loading committed load evidence…</p>}
    {error && <p role="alert" className="text-xs text-rose-300">Load visualisation unavailable: {error}</p>}
    {!loading && !error && data && <>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-5">
        {[
          ['Dates', `${data.summary.date_from || '—'} → ${data.summary.date_to || '—'}`],
          ['Observed / PASSED days', `${data.summary.observed_days} / ${data.summary.valid_days}`],
          ['PASSED blocks', String(data.summary.valid_blocks)], ['Completeness', `${data.summary.completeness_pct}%`],
          ['Minimum', kw(data.summary.min_kw)], ['Average', kw(data.summary.average_kw)], ['P95', kw(data.summary.p95_kw)],
          ['Maximum', kw(data.summary.max_kw)], ['Peak date/time', `${data.summary.peak_date || '—'} ${data.summary.peak_time || ''} IST`],
        ].map(([label, value]) => <div key={label} className="rounded border border-slate-700 bg-slate-950 p-2"><div className="text-slate-400">{label}</div>
          <strong className="font-mono text-slate-100">{value}</strong></div>)}
      </div>
      {data.plausibility_warning && <p role="alert" data-testid="site-capacity-plausibility-warning" className="rounded border border-amber-700 bg-amber-950/30 p-3 text-xs text-amber-200">
        {data.plausibility_warning.code}: {data.plausibility_warning.message}
      </p>}
      {data.summary.valid_blocks === 0 && <p className="text-xs text-amber-200">No complete PASSED day in this window. Upload and validate measured load data.</p>}
      <p className="text-xs text-slate-300">Selected day: {data.selected_date || '—'} · {data.selected_profile.length}/96 measured blocks · {data.selected_day_quality}.
        {data.selected_day_quality !== 'PASSED' && ' Selected-day values are shown as measured evidence only and excluded from PASSED aggregates.'}</p>
      <EvidenceCurve testId="measured-load-curve" title={`Measured 15-minute load · ${data.selected_date || 'No date'}`}
        unit="kW" data={selectedCurve} series={[{ key: 'load_kw', label: 'Measured load', color: '#38bdf8' }]} />
      <div className="grid gap-3 lg:grid-cols-2">
        <EvidenceCurve title="Daily measured demand trend · PASSED days" unit="kW" data={data.daily_trend}
          series={[{ key: 'average_kw', label: 'Daily average', color: '#38bdf8' }, { key: 'peak_kw', label: 'Daily peak', color: '#fbbf24' }]} />
        <EvidenceCurve title="Typical PASSED weekday / weekend profile" unit="kW" data={data.typical_weekday.length || data.typical_weekend.length ? typical : []}
          series={[{ key: 'weekday_kw', label: 'Weekday mean', color: '#38bdf8' }, { key: 'weekend_kw', label: 'Weekend mean', color: '#fbbf24' }]} />
      </div>
      <div className="rounded border border-slate-700 bg-slate-950 p-3"><h3 className="mb-2 text-sm text-slate-100">PASSED load heatmap · date × 15-minute block</h3>
        <div className="overflow-x-auto"><div className="min-w-[800px] space-y-1">{data.heatmap.map((day) =>
          <div key={day.operating_date} className="flex gap-px"><span className="w-24 shrink-0 text-[10px] text-slate-300">{day.operating_date}</span>
            {day.load_kw.map((value, index) => <span key={index} title={`${day.operating_date} ${String(Math.floor(index / 4)).padStart(2, '0')}:${String(index % 4 * 15).padStart(2, '0')} IST · ${kw(value)}`}
              className="h-3 min-w-[6px] flex-1" style={{ backgroundColor: `rgba(20,184,166,${0.12 + 0.88 * value / scale})` }} />)}</div>)}</div></div>
      </div>
      <details className="text-xs text-slate-300"><summary className="cursor-pointer">Selected-date block audit table ({data.selected_profile.length} measured blocks)</summary>
        <div className="max-h-80 overflow-auto"><table className="w-full text-left"><thead><tr><th>Block</th><th>IST start</th><th>Measured kW</th></tr></thead>
          <tbody>{data.selected_profile.map((point) => <tr key={point.block_index} className="border-t border-slate-800">
            <td>{point.block_index}</td><td>{point.time}</td><td>{kw(point.load_kw)}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
