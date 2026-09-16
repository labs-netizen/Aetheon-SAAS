'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { GridForecastResponseContract } from '@/types/analytics-contracts';
import { REPLAY_LABEL } from '@/lib/analytics/grid-replay';
import { EvidenceCurve } from '@/components/shared/EvidenceCurve';
import { replayCurvePoints } from '@/lib/analytics/grid-replay-visualization';
import { blockTimeWindow, flexibilityChartData, groupFlexibilityActions, summarizeFlexibilityDecision,
  type FlexibilityDecision } from '@/lib/analytics/grid-flexibility';
import type { BESSBehindMeterResponseContract } from '@/types/analytics-contracts';
import { BessSimulationPanel } from '@/features/bess/BessSimulationPanel';

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
  flexibility_decision?: FlexibilityDecision | { status: 'SUPPRESSED'; suppression_reason: string };
  bess_simulation?: BESSBehindMeterResponseContract | { status: string; suppression_reason?: string | null };
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
  const curves = replayCurvePoints(result?.forecast?.blocks || null, result?.price_evidence?.blocks || null,
    result?.actual_comparison_available ? result.actual_load_kw : null,
    result?.outputs?.price_sensitive_windows.lower_exchange_price_blocks || [],
    result?.outputs?.price_sensitive_windows.higher_exchange_price_blocks || []);
  const flexibility = result?.flexibility_decision?.status === 'READY' ? result.flexibility_decision : null;
  const flexibilityPoints = flexibility ? flexibilityChartData(flexibility) : [];
  const flexibilitySummary = flexibility ? summarizeFlexibilityDecision(flexibility) : null;
  const groupedFlexibilityActions = flexibility ? groupFlexibilityActions(flexibility) : [];
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
            <div>WALK-FORWARD VALIDATION METRICS: MAE {result.forecast.validation_metrics?.mae_kw ?? '—'} kW · RMSE {result.forecast.validation_metrics?.rmse_kw ?? '—'} kW · sMAPE {result.forecast.validation_metrics?.smape_pct ?? '—'}%</div>
            {result.forecast.model_version === 'GRID_HISTORICAL_LOAD_V2.0' && <div>
              Baseline {result.forecast.baseline_model || 'UNAVAILABLE'} · runner-up {result.forecast.runner_up || 'UNAVAILABLE'} · {result.forecast.validation_days ?? 0} walk-forward days · measured improvement vs baseline {result.forecast.improvement_vs_baseline_percent ?? '—'}% · drift {result.forecast.drift_status || 'INSUFFICIENT_EVIDENCE'}
            </div>}
            <div>Forecast blocks: {result.forecast.blocks.length}/96 · Actual target-day comparison: {result.actual_comparison_available ? 'AVAILABLE' : 'UNAVAILABLE — FORECAST-ONLY REPLAY'}</div>
          </div>}
          {result.bess_simulation && <BessSimulationPanel result={result.bess_simulation} historical />}
          <section className="space-y-3" data-testid="replay-visualizations">
            <strong className="block text-xs text-amber-200">{REPLAY_LABEL}</strong>
            <div className="grid gap-3 lg:grid-cols-2">
              <div><div className="mb-1 text-[11px] font-semibold text-amber-200">{REPLAY_LABEL}</div>
                <EvidenceCurve title="Historical forecast vs committed actual" unit="kW" testId="replay-forecast-curve"
                  data={curves.load} series={[{ key: 'forecast_kw', label: 'Historical forecast', color: '#38bdf8' },
                    ...(result.forecast?.empirical_interval_status === 'AVAILABLE'
                      ? [{ key: 'empirical_lower_kw' as const, label: 'Empirical interval lower', color: '#64748b' },
                         { key: 'empirical_upper_kw' as const, label: 'Empirical interval upper', color: '#94a3b8' }] : []),
                    ...(curves.actual_available ? [{ key: 'actual_kw' as const, label: 'Committed actual', color: '#34d399' }] : [])]} /></div>
              <div><div className="mb-1 text-[11px] font-semibold text-amber-200">{REPLAY_LABEL}</div>
                <EvidenceCurve title="Historical exact-date IEX DAM MCP · price windows in tooltips" unit="₹/MWh" testId="replay-price-curve"
                  data={curves.mcp} series={[{ key: 'mcp_rs_per_mwh', label: 'Verified MCP', color: '#fbbf24' }]} /></div>
            </div>
            {!curves.actual_available && <p className="text-xs text-amber-200" data-testid="replay-actual-unavailable">{REPLAY_LABEL}: committed actual target-day load unavailable; no actual series is drawn.</p>}
            {result.forecast?.validation_metrics && <div className="rounded border border-amber-700 bg-slate-950 p-3 text-xs text-slate-200" data-testid="replay-model-metrics-visual">
              <strong className="block text-amber-200">{REPLAY_LABEL} · WALK-FORWARD VALIDATION METRICS · {result.forecast.selected_model || 'UNAVAILABLE'}</strong>
              <div className="mt-2 grid grid-cols-3 gap-2">{[
                ['MAE', result.forecast.validation_metrics.mae_kw, 'kW'],
                ['RMSE', result.forecast.validation_metrics.rmse_kw, 'kW'],
                ['sMAPE', result.forecast.validation_metrics.smape_pct, '%'],
              ].map(([name, value, unit]) => <div key={String(name)} className="rounded border border-slate-700 p-2">
                <div className="text-slate-400">{name}</div><strong>{value ?? '—'} {unit}</strong></div>)}</div>
            </div>}
            {result.forecast?.model_comparison_metrics && Object.keys(result.forecast.model_comparison_metrics).length > 0 &&
              <div className="rounded border border-amber-700 bg-slate-950 p-3 text-xs text-slate-200" data-testid="replay-model-tournament">
                <strong className="block text-amber-200">{REPLAY_LABEL} · WALK-FORWARD MODEL TOURNAMENT</strong>
                <div className="mt-2 max-h-56 overflow-auto"><table className="w-full text-left"><thead><tr>
                  <th>Model</th><th>MAE kW</th><th>RMSE kW</th><th>sMAPE %</th><th>Peak magnitude kW</th><th>Peak timing min</th>
                </tr></thead><tbody>{Object.entries(result.forecast.model_comparison_metrics).map(([name, metric]) =>
                  <tr key={name} className="border-t border-slate-800"><td>{name}{name === result.forecast?.selected_model ? ' · SELECTED' : ''}</td>
                    <td>{metric.mae_kw}</td><td>{metric.rmse_kw}</td><td>{metric.smape_pct}</td>
                    <td>{metric.peak_magnitude_error_kw ?? '—'}</td><td>{metric.peak_timing_error_minutes ?? '—'}</td></tr>)}</tbody></table></div>
                {Object.keys(result.forecast.ensemble_weights || {}).length > 0 && <p className="mt-2">Validated ensemble weights: {Object.entries(result.forecast.ensemble_weights || {}).map(([name, weight]) => `${name} ${(weight * 100).toFixed(1)}%`).join(' · ')}</p>}
                <p className="mt-2">Empirical forecast interval: {result.forecast.empirical_interval_status || 'INSUFFICIENT_EVIDENCE'} · descriptive residual quantiles, not guaranteed coverage.</p>
              </div>}
          </section>
          {result.replay_ready && result.outputs && result.forecast && (
            <>
              <section className="space-y-3" data-testid="replay-flexibility-decision">
                <strong className="block text-amber-200">{REPLAY_LABEL}</strong>
                {!flexibility ? <div className="rounded border border-amber-700 p-3 text-xs text-amber-200">
                  <strong className="block">{REPLAY_LABEL}</strong>
                  Load-shift decision SUPPRESSED — {result.flexibility_decision?.suppression_reason || 'FLEXIBILITY_PROFILE_REQUIRED'}.
                </div> : <>
                  <div className="rounded border border-amber-700 p-4 text-xs text-slate-200" data-testid="replay-optimization-summary">
                    <strong className="block text-amber-200">{REPLAY_LABEL}</strong>
                    <strong className="mt-2 block text-sm">OPTIMIZATION STATUS · {flexibility.uncertainty_status}</strong>
                    <strong className="mt-2 block">{flexibility.component_label}</strong>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      <span>Flexibility used: {flexibilitySummary!.flexibility_used_kwh.toFixed(2)} / {flexibilitySummary!.configured_maximum_kwh.toFixed(2)} kWh</span>
                      <span>Source blocks modified: {flexibilitySummary!.source_blocks_modified}</span>
                      <span>Destination blocks modified: {flexibilitySummary!.destination_blocks_modified}</span>
                      <span>Total modified blocks: {flexibilitySummary!.total_modified_blocks}</span>
                      <span>Energy conservation: {flexibilitySummary!.energy_conservation_status}</span>
                      <span>Critical-block constraint: {flexibilitySummary!.critical_block_status}</span>
                      <span>Operating-bound constraint: {flexibilitySummary!.operating_bound_status}</span>
                      <span>Indicative reduction: ₹{flexibility.indicative_difference_inr.toFixed(2)} ({flexibility.indicative_difference_pct.toFixed(2)}%)</span>
                      <span>Drift status: {flexibility.drift_status}</span>
                    </div>
                    <div className="mt-2">Baseline ₹{flexibility.baseline_indicative_component_inr.toFixed(2)} · optimized ₹{flexibility.optimized_indicative_component_inr.toFixed(2)}.</div>
                    <div>NOT LANDED ELECTRICITY COST. Excludes CSS, additional surcharge, transmission, wheeling, losses, duties, SLDC charges and other OA costs.</div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <EvidenceCurve title="Historical baseline vs constrained optimized demand" unit="kW" testId="replay-flexibility-load-curve"
                      data={flexibilityPoints} series={[{ key: 'baseline_kw', label: 'Baseline forecast', color: '#38bdf8' },
                        { key: 'optimized_kw', label: 'Constrained optimized', color: '#34d399' }]} />
                    <EvidenceCurve title="Historical shift delta · negative reduced / positive added" unit="kW" testId="replay-flexibility-delta-curve"
                      data={flexibilityPoints} series={[{ key: 'delta_kw', label: 'Shift delta', color: '#f59e0b' }]} />
                  </div>
                  {groupedFlexibilityActions.length === 0 ? <div className="rounded border border-amber-700 p-4 text-xs text-slate-200" data-testid="replay-no-beneficial-shift">
                    <strong className="block text-amber-200">{REPLAY_LABEL}</strong><strong>NO BENEFICIAL FEASIBLE SHIFT IDENTIFIED</strong>
                    <p>All configured flexibility constraints were respected, but no feasible shift reduced the indicative IEX DAM energy component.</p>
                  </div> : <div className="grid gap-3 md:grid-cols-2" data-testid="replay-grouped-recommendations">{groupedFlexibilityActions.map((action) =>
                    <div key={`${action.action}-${action.start_block}`} className="rounded border border-amber-700 p-4 text-xs text-slate-200">
                      <strong className="block text-amber-200">{REPLAY_LABEL}</strong>
                      <strong className={action.action === 'REDUCE' ? 'text-rose-300' : 'text-emerald-300'}>{action.action === 'REDUCE' ? 'REDUCE FLEXIBLE LOAD' : 'INCREASE / REALLOCATE LOAD'}</strong>
                      <div className="mt-1 text-base font-semibold">{action.time_window}</div><div>Blocks {action.start_block}{action.end_block === action.start_block ? '' : `–${action.end_block}`}</div>
                      <div className="mt-2">Up to {action.peak_delta_kw.toFixed(2)} kW · {action.energy_kwh.toFixed(2)} kWh shifted</div>
                      <div>Average {action.action === 'REDUCE' ? 'source' : 'destination'} MCP: ₹{action.average_mcp_rs_per_mwh.toFixed(2)}/MWh</div>
                      {action.counterparty_average_mcp_rs_per_mwh !== null && <div>{action.action === 'REDUCE' ? 'Destination' : 'Source'} MCP: ₹{action.counterparty_average_mcp_rs_per_mwh.toFixed(2)}/MWh</div>}
                      <div>Indicative ₹ effect: ₹{action.indicative_effect_inr.toFixed(2)}</div>
                    </div>)}</div>}
                  <details className="rounded border border-amber-700 p-3 text-xs text-slate-200"><summary className="cursor-pointer font-semibold">{REPLAY_LABEL} · Detailed block-level shifts</summary>
                    <table className="mt-2 w-full text-left"><thead><tr><th>Block / time</th><th>Delta kW</th><th>Energy kWh</th><th>MCP ₹/MWh</th></tr></thead>
                      <tbody>{flexibility.delta_kw.map((delta, index) => Math.abs(delta) > 1e-7 && <tr key={index} className="border-t border-slate-800">
                        <td>Block {index + 1} · {blockTimeWindow(index + 1)}</td><td>{delta > 0 ? '+' : ''}{delta.toFixed(2)}</td>
                        <td>{(Math.abs(delta) * 0.25).toFixed(2)}</td><td>{flexibility.mcp_rs_per_mwh[index].toFixed(2)}</td></tr>)}</tbody></table>
                  </details>
                </>}
              </section>
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
                TARGET-DAY ACTUAL BACKTEST METRICS: MAE {result.outputs.actual_comparison.mae_kw.toFixed(2)} kW · RMSE {result.outputs.actual_comparison.rmse_kw.toFixed(2)} kW · sMAPE {result.outputs.actual_comparison.smape_pct.toFixed(2)}% · peak timing error {result.outputs.actual_comparison.peak_timing_error_minutes} min · peak magnitude error {result.outputs.actual_comparison.peak_magnitude_error_kw.toFixed(2)} kW
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
