'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { GridForecastResponseContract } from '@/types/analytics-contracts';
import { REPLAY_LABEL } from '@/lib/analytics/grid-replay';

interface ReplayResponse {
  mode: 'HISTORICAL_REPLAY';
  label: string;
  site_id: string;
  replay_input_date: string;
  replay_target_date: string;
  load_status: string;
  model_validation_status: string;
  price_status: string;
  replay_ready: boolean;
  suppression_reason: string | null;
  input_evidence?: { total_blocks_received: number; total_blocks_expected: number; quality_status: string; freshness: string };
  forecast: (GridForecastResponseContract & { mode: 'HISTORICAL_REPLAY' }) | null;
  price_evidence: { delivery_date: string; received_blocks: number; expected_blocks: number; status: string;
    blocks: Array<{ block_index: number; mcp_rs_per_mwh: number }> } | null;
  outputs: { peak_forecast_block: number; peak_forecast_kw: number; lowest_iex_mcp_rs_per_mwh: number;
    lowest_iex_mcp_blocks: number[]; highest_iex_mcp_rs_per_mwh: number; highest_iex_mcp_blocks: number[];
    indicative_iex_energy_component_inr: number; price_sensitive_windows: { lower_exchange_price_blocks: number[]; higher_exchange_price_blocks: number[] };
    actual_comparison: { mae_kw: number; rmse_kw: number; smape_pct: number; peak_timing_error_minutes: number;
      peak_magnitude_error_kw: number } | null } | null;
  actual_comparison_available: boolean;
  actual_load_kw?: number[] | null;
}

export function HistoricalReplayPanel({ siteId, suggestedInputDate }: { siteId: string; suggestedInputDate: string | null }) {
  const [inputDate, setInputDate] = useState(suggestedInputDate || '');
  const [result, setResult] = useState<ReplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const activeSite = useRef(siteId);
  const activeDate = useRef(inputDate);
  activeSite.current = siteId;
  activeDate.current = inputDate;

  useEffect(() => { setInputDate(suggestedInputDate || ''); setResult(null); setError(null); setRunning(false); }, [siteId]);
  useEffect(() => { if (!inputDate && suggestedInputDate) setInputDate(suggestedInputDate); }, [suggestedInputDate, inputDate]);

  const run = async () => {
    const requestedSite = siteId;
    const requestedDate = inputDate;
    setResult(null);
    setError(null);
    setRunning(true);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error('AUTHENTICATED_SESSION_REQUIRED');
      const response = await fetch(`/api/grid/replay?site_id=${encodeURIComponent(siteId)}&operating_date=${encodeURIComponent(inputDate)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.details || body.error || `HTTP ${response.status}`);
      if (activeSite.current !== requestedSite || activeDate.current !== requestedDate) return;
      if (body.mode !== 'HISTORICAL_REPLAY' || body.site_id !== requestedSite || body.replay_input_date !== requestedDate ||
          body.label !== REPLAY_LABEL) throw new Error('INVALID_HISTORICAL_REPLAY_RESPONSE');
      setResult(body as ReplayResponse);
    } catch (failure) {
      if (activeSite.current === requestedSite && activeDate.current === requestedDate) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (activeSite.current === requestedSite && activeDate.current === requestedDate) setRunning(false);
    }
  };

  const prices = new Map(result?.price_evidence?.blocks.map((block) => [block.block_index, block.mcp_rs_per_mwh]) || []);
  return (
    <section className="space-y-5" data-testid="historical-replay-panel">
      <div className="sticky top-0 z-20 rounded border-2 border-amber-500 bg-amber-950 p-4 text-amber-100" data-testid="historical-replay-banner">
        <strong className="block text-base">HISTORICAL BACKTEST</strong>
        <strong className="block">NOT LIVE OPERATIONAL ADVICE</strong>
        <span className="text-xs">Historical evidence and model outputs are for retrospective evaluation only. No trading or dispatch action is generated.</span>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded border border-slate-700 p-4">
        <label className="text-xs text-slate-200">Complete historical input date
          <input data-testid="replay-input-date" type="date" value={inputDate} onChange={(event) => { activeDate.current = event.target.value; setInputDate(event.target.value); setResult(null); setRunning(false); }}
            className="mt-1 block rounded border border-slate-600 bg-slate-900 p-2 text-slate-100" />
        </label>
        <button type="button" data-testid="run-historical-replay" onClick={run} disabled={!inputDate || running}
          className="rounded border border-amber-500 px-4 py-2 text-xs font-semibold text-amber-200 disabled:opacity-50">
          {running ? 'Running historical replay…' : 'Run Historical Replay'}
        </button>
        {inputDate && <span className="text-xs text-slate-300">Target IEX DAM date: {new Date(Date.parse(`${inputDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)}</span>}
      </div>
      {error && <div role="alert" className="rounded border border-rose-700 p-3 text-sm text-rose-300">Historical replay unavailable: {error}</div>}
      {result && (
        <div className="space-y-4" data-testid="historical-replay-result">
          <div className="rounded border border-slate-700 p-4 text-sm text-slate-200">
            <strong className="block text-amber-200">{REPLAY_LABEL}</strong>
            <div>Committed input: {result.replay_input_date} · {result.input_evidence?.total_blocks_received ?? 0}/96 blocks · {result.load_status}</div>
            <div>Historical forecast target: {result.replay_target_date} · Model validation: {result.model_validation_status}</div>
            <div>Exact-date IEX DAM MCP: {result.price_evidence?.delivery_date || result.replay_target_date} · {result.price_evidence?.received_blocks ?? 0}/96 blocks · {result.price_status}</div>
            <div>Replay status: {result.replay_ready ? 'READY FOR HISTORICAL BACKTEST' : `SUPPRESSED — ${result.suppression_reason || 'EVIDENCE_UNAVAILABLE'}`}</div>
            <div>Wall-clock freshness: {result.input_evidence?.freshness || 'UNKNOWN'} · applies to LIVE only</div>
          </div>
          {result.forecast && <div className="rounded border border-slate-700 p-4 text-sm text-slate-200">
            <strong className="block text-amber-200">{REPLAY_LABEL}</strong>
            <div>Selected model: {result.forecast.selected_model || 'UNAVAILABLE'} · Version: {result.forecast.model_version}</div>
            <div>Chronological holdout: MAE {result.forecast.validation_metrics?.mae_kw ?? '—'} kW · RMSE {result.forecast.validation_metrics?.rmse_kw ?? '—'} kW · sMAPE {result.forecast.validation_metrics?.smape_pct ?? '—'}%</div>
            <div>Forecast blocks: {result.forecast.blocks.length}/96 · Actual target-day comparison: {result.actual_comparison_available ? 'AVAILABLE' : 'UNAVAILABLE — FORECAST-ONLY REPLAY'}</div>
          </div>}
          {result.replay_ready && result.outputs && result.forecast && (
            <>
              <div className="grid gap-3 sm:grid-cols-2" data-testid="replay-historical-outputs">
                <div className="rounded border border-amber-700 p-4 text-sm text-slate-200"><strong className="block text-xs text-amber-200">{REPLAY_LABEL}</strong>
                  FORECAST peak: Block {result.outputs.peak_forecast_block} · {result.outputs.peak_forecast_kw.toFixed(2)} kW</div>
                <div className="rounded border border-amber-700 p-4 text-sm text-slate-200"><strong className="block text-xs text-amber-200">{REPLAY_LABEL}</strong>
                  IEX DAM MCP / exchange price: lowest ₹{result.outputs.lowest_iex_mcp_rs_per_mwh.toFixed(2)}/MWh (blocks {result.outputs.lowest_iex_mcp_blocks.join(', ')}) · highest ₹{result.outputs.highest_iex_mcp_rs_per_mwh.toFixed(2)}/MWh (blocks {result.outputs.highest_iex_mcp_blocks.join(', ')})</div>
                <div className="rounded border border-amber-700 p-4 text-sm text-slate-200"><strong className="block text-xs text-amber-200">{REPLAY_LABEL}</strong>
                  Indicative historical demand × IEX MCP energy component: ₹{result.outputs.indicative_iex_energy_component_inr.toFixed(2)}. Excludes OA charges, CSS, transmission, losses, duties and taxes.</div>
                <div className="rounded border border-amber-700 p-4 text-sm text-slate-200"><strong className="block text-xs text-amber-200">{REPLAY_LABEL}</strong>
                  Historical exchange-price windows: lower MCP blocks {result.outputs.price_sensitive_windows.lower_exchange_price_blocks.join(', ')}; higher MCP blocks {result.outputs.price_sensitive_windows.higher_exchange_price_blocks.join(', ')}. Descriptive only.</div>
              </div>
              {result.outputs.actual_comparison && <div className="rounded border border-amber-700 p-4 text-sm text-slate-200">
                <strong className="block text-xs text-amber-200">{REPLAY_LABEL}</strong>
                FORECAST vs ACTUAL: MAE {result.outputs.actual_comparison.mae_kw.toFixed(2)} kW · RMSE {result.outputs.actual_comparison.rmse_kw.toFixed(2)} kW · sMAPE {result.outputs.actual_comparison.smape_pct.toFixed(2)}% · peak timing error {result.outputs.actual_comparison.peak_timing_error_minutes} min · peak magnitude error {result.outputs.actual_comparison.peak_magnitude_error_kw.toFixed(2)} kW
              </div>}
              <div className="max-h-80 overflow-auto rounded border border-slate-700" data-testid="replay-block-table">
                <table className="w-full text-left text-xs text-slate-200"><thead className="sticky top-0 bg-slate-900"><tr>
                  <th className="p-2">Block</th><th className="p-2">FORECAST kW</th><th className="p-2">ACTUAL kW</th><th className="p-2">IEX DAM MCP ₹/MWh</th><th className="p-2">HISTORICAL BACKTEST — NOT LIVE OPERATIONAL ADVICE</th>
                </tr></thead><tbody>{result.forecast.blocks.map((block) => <tr key={block.block_index} className="border-t border-slate-800">
                  <td className="p-2">{block.block_index}</td><td className="p-2">{block.forecast_load_kw.toFixed(2)}</td>
                  <td className="p-2">{result.actual_load_kw?.[block.block_index - 1]?.toFixed(2) ?? 'UNAVAILABLE'}</td>
                  <td className="p-2">{prices.get(block.block_index)?.toFixed(2) ?? 'UNAVAILABLE'}</td><td className="p-2">HISTORICAL BACKTEST</td>
                </tr>)}</tbody></table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
