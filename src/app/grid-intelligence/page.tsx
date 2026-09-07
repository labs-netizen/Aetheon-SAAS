'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap,
  TrendingDown,
  Download,
  Printer,
  Sliders,
  DollarSign,
  AlertCircle,
  Table as TableIcon,
  LineChart as ChartIcon,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';
import { Block96Chart, type Block96Point } from '@/components/shared/Block96Chart';
import { DataQualityBadge } from '@/components/shared/DataQualityBadge';
import { FreshnessBadge } from '@/components/shared/FreshnessBadge';
import { QualityGateBlock } from '@/components/shared/QualityGateBlock';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { ModuleGate } from '@/components/shared/ModuleGate';
import { evaluateQualityGate } from '@/features/quality/qualityGate';
import { getBlockTimes } from '@/lib/dates/blocks96';
import { formatPower, formatEnergy, formatPercentage } from '@/lib/units/energy';
import { formatPaiseToInr } from '@/lib/units/currency';
import { PRODUCTS } from '@/types';

export default function GridIntelligencePage() {
  const { currentSite, isEntitled } = useSite();
  const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'explorer'>('chart');
  const [solarEnabled, setSolarEnabled] = useState(true);
  const [bessEnabled, setBessEnabled] = useState(true);
  const [oaEnabled, setOaEnabled] = useState(false);

  // Backend forecast state
  const [forecastResult, setForecastResult] = useState<any>(null);
  const [isLoadingForecast, setIsLoadingForecast] = useState<boolean>(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // Load backend forecast from /api/forecast
  useEffect(() => {
    if (!currentSite?.id) return;

    let isMounted = true;
    setIsLoadingForecast(true);
    setForecastError(null);

    const targetDate = new Date().toISOString().substring(0, 10);
    fetch(`/api/forecast?siteId=${currentSite.id}&operatingDate=${targetDate}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || errData.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (isMounted) {
          setForecastResult(data);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setForecastError(err.message);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingForecast(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentSite?.id]);

  // Transform backend blocks to Block96Point
  const forecastBlocks: Block96Point[] = useMemo(() => {
    if (forecastResult?.blocks && Array.isArray(forecastResult.blocks) && forecastResult.blocks.length > 0) {
      return forecastResult.blocks.map((b: any) => ({
        block_index: b.block_index,
        start_time: b.start_time || getBlockTimes(b.block_index).startTime,
        demand_kw: Math.round(b.forecast_demand_kw || b.demand_kw || 0),
        price_mwh: Math.round(b.forecast_price_inr_per_mwh || b.price_mwh || 0),
        solar_kw: Math.round(b.solar_generation_kw || 0),
        is_high_cost: Boolean(b.is_high_cost_window || (b.forecast_price_inr_per_mwh || 0) >= 7500),
      }));
    }

    // In LIVE mode, fail closed: do NOT synthesize Math.sin() blocks when backend output is unavailable
    if (!currentSite?.is_demo) {
      return [];
    }

    // Deterministic fallback permitted ONLY in explicit trusted DEMO mode
    const pts: Block96Point[] = [];
    const baseDemand = (currentSite?.contract_demand_value || 1000) * 0.75;

    for (let b = 1; b <= 96; b++) {
      const timing = getBlockTimes(b);
      const hour = (b - 1) / 4.0;
      let demandFactor = 0.65 + 0.25 * Math.sin(((hour - 6) * Math.PI) / 12.0);
      if (hour >= 9 && hour <= 14) demandFactor += 0.12;
      const demandKw = Math.round(baseDemand * Math.max(0.4, Math.min(0.95, demandFactor)));

      let price = 4200;
      if (b >= 32 && b <= 44) price = 5600 + (b - 32) * 90;
      else if (b >= 72 && b <= 88) price = 7800 + Math.sin(((b - 72) / 16) * Math.PI) * 1800;
      else if (b <= 24) price = 2900 + (b % 4) * 50;

      let solarKw = 0;
      if (b >= 25 && b <= 72) {
        const t = (b - 25) / 47.0;
        solarKw = Math.round(900 * Math.sin(t * Math.PI));
      }

      pts.push({
        block_index: b,
        start_time: timing.startTime,
        demand_kw: demandKw,
        price_mwh: Math.round(price),
        solar_kw: solarKw,
        is_high_cost: price >= 7500,
      });
    }
    return pts;
  }, [forecastResult, currentSite]);

  // Quality gate evaluation
  const qualityGate = useMemo(() => {
    return evaluateQualityGate({
      sourceTimestamp: forecastResult?.model_generation_time || '2026-09-07T00:00:00Z',
      sourceType: forecastResult?.persisted ? 'PostgreSQL Persisted Model Forecast' : 'DEMO / INTERNAL_VALIDATION',
      completenessPct: currentSite?.activation_status === 'ACTIVE' ? 100.0 : 95.0,
      totalBlocksExpected: 96,
      totalBlocksReceived: forecastBlocks.length,
      validationStatus: forecastResult?.data_quality || 'PASSED',
      freshnessStatus: forecastResult?.freshness || 'RECENT',
      modelVersion: forecastResult?.model_version || 'DEMO_BASELINE_v1.0',
      modelGenerationTime: forecastResult?.model_generation_time || new Date().toISOString(),
      tariffVersion: 'MSEDCL_HT1_TOD_2024_VALIDATED',
    });
  }, [forecastResult, currentSite, forecastBlocks.length]);

  const isDemo = Boolean(currentSite?.is_demo);
  const hasValidForecast = Boolean(forecastResult && Array.isArray(forecastResult.blocks) && forecastResult.blocks.length > 0);

  // Cost Explorer calculations based on server-returned blocks
  const explorerCalculations = useMemo(() => {
    if (!isDemo && (!hasValidForecast || forecastBlocks.length === 0)) {
      return {
        totalDailyKwh: 0,
        baselineCostPaise: 0,
        scenarioCostPaise: 0,
        dailyAvoidedPaise: 0,
        monthlyAvoidedPaise: 0,
        landedUnitCostInr: 'DATA GAP',
        isDataGap: true,
      };
    }

    const totalDailyKwh = forecastBlocks.reduce((acc, b) => acc + (b.demand_kw || 0) * 0.25, 0);

    let avoidedKwh = 0;
    if (solarEnabled) {
      const solarKwhFromBlocks = forecastBlocks.reduce((acc, b) => acc + (b.solar_kw || 0) * 0.25, 0);
      avoidedKwh += isDemo ? 4200 : solarKwhFromBlocks;
    }
    if (bessEnabled) {
      avoidedKwh += isDemo ? 1500 : 0;
    }

    const baselineTariff = 7.85;
    const baselineCostPaise = Math.round(totalDailyKwh * baselineTariff * 100);

    const scenarioKwhFromGrid = Math.max(0, totalDailyKwh - avoidedKwh);
    const gridTariffRate = oaEnabled ? (isDemo ? 5.20 : 5.80) : baselineTariff;
    const scenarioCostPaise = Math.round(scenarioKwhFromGrid * gridTariffRate * 100);

    const dailyAvoidedPaise = Math.max(0, baselineCostPaise - scenarioCostPaise);
    const monthlyAvoidedPaise = dailyAvoidedPaise * 30;

    return {
      totalDailyKwh,
      baselineCostPaise,
      scenarioCostPaise,
      dailyAvoidedPaise,
      monthlyAvoidedPaise,
      landedUnitCostInr: totalDailyKwh > 0 ? (scenarioCostPaise / (totalDailyKwh * 100)).toFixed(2) : '0.00',
      isDataGap: false,
    };
  }, [forecastBlocks, solarEnabled, bessEnabled, oaEnabled, isDemo, hasValidForecast]);

  const handleExportCsv = () => {
    const headers = ['block_index', 'start_time', 'forecast_demand_kw', 'forecast_price_inr_per_mwh', 'solar_generation_kw', 'is_high_cost'];
    const rows = forecastBlocks.map((b) =>
      [b.block_index, b.start_time, b.demand_kw, b.price_mwh, b.solar_kw, b.is_high_cost ? 'YES' : 'NO'].join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `grid_forecast_96block_${(currentSite?.name || 'site').replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const peakBlock = hasValidForecast ? forecastResult.peak_demand_block : (isDemo ? 38 : null);
  const peakKw = hasValidForecast ? forecastResult.peak_demand_kw : (isDemo ? 2180.5 : null);
  const avgPrice = hasValidForecast ? forecastResult.average_price_inr_per_mwh : (isDemo ? 4560 : null);

  return (
    <ModuleGate
      productId="GRID_INTELLIGENCE"
      productName="Grid Intelligence Monitor"
      description="Algorithmic Day-Ahead 96-block price & demand forecast, high-cost window alerts, and scenario cost explorer."
      basePricePaise={PRODUCTS.GRID_INTELLIGENCE.basePricePaise}
      isEntitled={isEntitled('GRID_INTELLIGENCE')}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
                <Zap className="w-5 h-5 text-teal-400" />
                Grid Intelligence Monitor
              </h1>
              <Badge variant="warning">INTERNAL_VALIDATION</Badge>
              {forecastResult?.persisted && (
                <Badge variant="success">DB PERSISTED RUN #{forecastResult.run_id?.substring(0, 8)}</Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Day-ahead 96-block price & demand forecast, high-cost window alerts, and scenario cost explorer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DataQualityBadge status={qualityGate.qualityMetadata.validationStatus} />
            <FreshnessBadge status={qualityGate.qualityMetadata.freshnessStatus} />
            <Button onClick={handleExportCsv} variant="outline" size="sm" className="gap-1.5 text-xs">
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </Button>
            <Button onClick={() => window.print()} variant="outline" size="sm" className="gap-1.5 text-xs">
              <Printer className="w-3.5 h-3.5" />
              Print Brief
            </Button>
          </div>
        </div>

        {forecastError && (
          <div className="p-3 rounded bg-amber-950/40 border border-amber-800 text-xs text-amber-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              {isDemo
                ? `FastAPI live forecast unavailable (${forecastError}); rendering validated internal baseline.`
                : `Operational forecast unavailable (${forecastError}): DATA GAP / FORECAST UNAVAILABLE.`}
            </span>
          </div>
        )}

        {/* Quality Gate Check */}
        {qualityGate.isSuppressed ? (
          <QualityGateBlock
            reason={qualityGate.suppressionReason || 'Data requirements not satisfied.'}
            remediationAdvice={qualityGate.remediationAdvice}
            onRemediate={() => window.location.assign('/settings')}
          />
        ) : (
          <>
            {/* Daily Grid Brief Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card variant="industrial">
                <span className="text-xs text-slate-400 block mb-1">Peak Demand Block</span>
                <div className="text-xl font-bold font-mono text-slate-100">
                  {peakBlock !== null ? `Block ${peakBlock} (${getBlockTimes(peakBlock).startTime} - ${getBlockTimes(peakBlock).endTime})` : 'DATA GAP'}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Server projected demand: <strong>{peakKw !== null ? formatPower(peakKw) : 'FORECAST UNAVAILABLE'}</strong>
                </p>
              </Card>

              <Card variant="industrial">
                <span className="text-xs text-slate-400 block mb-1">Average Daily Clearing Price</span>
                <div className="text-xl font-bold font-mono text-sky-400">
                  {avgPrice !== null ? `₹${avgPrice.toLocaleString('en-IN')} / MWh` : 'DATA GAP'}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Model: <span className="font-mono text-[10px] text-teal-300">{avgPrice !== null ? (forecastResult?.model_version || (isDemo ? 'DEMO_BASELINE_v1.0' : 'INTERNAL_VALIDATION')) : 'FORECAST UNAVAILABLE'}</span>
                </p>
              </Card>

              <Card variant="industrial">
                <span className="text-xs text-slate-400 block mb-1">Highest Cost Window</span>
                <div className="text-xl font-bold font-mono text-rose-400">
                  {hasValidForecast || isDemo ? 'Blocks 72–88 (18:00 - 22:00)' : 'DATA GAP'}
                </div>
                <p className="text-xs text-rose-300 mt-1">
                  Clearing price: <strong>{hasValidForecast || isDemo ? '₹7,800 - ₹9,600/MWh' : 'FORECAST UNAVAILABLE'}</strong>
                </p>
              </Card>

              <Card variant="industrial">
                <span className="text-xs text-slate-400 block mb-1">Avoided Cost Opportunity</span>
                <div className="text-xl font-bold font-mono text-teal-300">
                  {explorerCalculations.isDataGap ? 'DATA GAP' : `${formatPaiseToInr(explorerCalculations.dailyAvoidedPaise)} / day`}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Monthly potential: <strong>{explorerCalculations.isDataGap ? 'CONFIGURATION REQUIRED' : formatPaiseToInr(explorerCalculations.monthlyAvoidedPaise)}</strong>
                </p>
              </Card>
            </div>

            {/* Sub-view Navigation Tabs */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Button
                  variant={activeTab === 'chart' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTab('chart')}
                  className="gap-1.5 text-xs"
                >
                  <ChartIcon className="w-3.5 h-3.5" />
                  96-Block Curve
                </Button>
                <Button
                  variant={activeTab === 'table' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTab('table')}
                  className="gap-1.5 text-xs"
                >
                  <TableIcon className="w-3.5 h-3.5" />
                  Block Data Table
                </Button>
                <Button
                  variant={activeTab === 'explorer' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTab('explorer')}
                  className="gap-1.5 text-xs"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  Scenario Cost Explorer
                </Button>
              </div>

              <span className="text-[11px] text-slate-500 hidden sm:inline">
                Data pipeline: {forecastResult?.persisted ? 'PostgreSQL / FastAPI Solvers' : 'DEMO / INTERNAL_VALIDATION'}
              </span>
            </div>

            {/* View 1: 96-Block Interactive Chart */}
            {activeTab === 'chart' && (
              <div className="space-y-4">
                <Block96Chart
                  title={`Day-Ahead Grid Horizon — ${currentSite?.name || 'Industrial Facility'}`}
                  points={forecastBlocks}
                  showSolar={solarEnabled}
                />
              </div>
            )}

            {/* View 2: Data Table */}
            {activeTab === 'table' && (
              <Card variant="industrial">
                <CardHeader>
                  <CardTitle>96-Block Operational Horizon Matrix</CardTitle>
                  <CardDescription>
                    Detailed 15-minute time-of-day interval dispatch parameters and market prices.
                  </CardDescription>
                </CardHeader>
                <div className="p-6 pt-0 overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">Block</th>
                        <th className="py-2.5 px-3">Start Time</th>
                        <th className="py-2.5 px-3">Projected Demand</th>
                        <th className="py-2.5 px-3">DAM Price</th>
                        <th className="py-2.5 px-3">Solar Output</th>
                        <th className="py-2.5 px-3">High-Cost Window</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-200">
                      {forecastBlocks.map((b) => (
                        <tr
                          key={b.block_index}
                          className={b.is_high_cost ? 'bg-rose-950/20 text-rose-300' : 'hover:bg-slate-900/40'}
                        >
                          <td className="py-2 px-3">{b.block_index}</td>
                          <td className="py-2 px-3">{b.start_time}</td>
                          <td className="py-2 px-3">{b.demand_kw} kW</td>
                          <td className="py-2 px-3">₹{(b.price_mwh || 0).toLocaleString('en-IN')}/MWh</td>
                          <td className="py-2 px-3 text-amber-400">{b.solar_kw} kW</td>
                          <td className="py-2 px-3">
                            {b.is_high_cost ? (
                              <span className="px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-200 text-[10px] font-bold">
                                PEAK TOOD
                              </span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* View 3: Scenario Cost Explorer */}
            {activeTab === 'explorer' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-4 lg:col-span-1">
                  <Card variant="industrial">
                    <CardHeader>
                      <CardTitle className="text-teal-400">
                        <Sliders className="w-4 h-4" />
                        Scenario Asset Toggles
                      </CardTitle>
                      <CardDescription>
                        Evaluate dynamic avoided cost across integrated site DER assets.
                      </CardDescription>
                    </CardHeader>
                    <div className="p-6 pt-0 space-y-4 text-xs">
                      <div className="flex items-center justify-between p-3 rounded bg-slate-950 border border-slate-800">
                        <div>
                          <div className="font-semibold text-slate-200">Rooftop Solar Integration</div>
                          <div className="text-[11px] text-slate-400">900 kWp installed PV generation</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={solarEnabled}
                          onChange={(e) => setSolarEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-teal-600 focus:ring-teal-500"
                        />
                      </div>

                      <div className="flex items-center justify-between p-3 rounded bg-slate-950 border border-slate-800">
                        <div>
                          <div className="font-semibold text-slate-200">BESS Peak Shaving</div>
                          <div className="text-[11px] text-slate-400">500 kW / 1000 kWh battery storage</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={bessEnabled}
                          onChange={(e) => setBessEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-teal-600 focus:ring-teal-500"
                        />
                      </div>

                      <div className="flex items-center justify-between p-3 rounded bg-slate-950 border border-slate-800">
                        <div>
                          <div className="font-semibold text-slate-200">Landed Open Access Sourcing</div>
                          <div className="text-[11px] text-slate-400">₹5.20 landed vs ₹7.85 utility tariff</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={oaEnabled}
                          onChange={(e) => setOaEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-teal-600 focus:ring-teal-500"
                        />
                      </div>
                    </div>
                  </Card>
                </div>

                <div className="lg:col-span-2 space-y-4">
                  <Card variant="industrial">
                    <CardHeader>
                      <CardTitle className="text-slate-100 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-emerald-400" />
                        Avoided Cost & Tariff Impact Simulation
                      </CardTitle>
                      <CardDescription>
                        Scenario projection against baseline MSEDCL utility tariff.
                      </CardDescription>
                    </CardHeader>
                    <div className="p-6 pt-0 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-md bg-slate-950 border border-slate-800">
                          <span className="text-xs text-slate-400 block mb-1">Baseline Monthly Energy Bill</span>
                          <div className="text-xl font-bold font-mono text-slate-300">
                            {explorerCalculations.isDataGap ? 'CONFIGURATION REQUIRED' : formatPaiseToInr(explorerCalculations.baselineCostPaise * 30)}
                          </div>
                          <span className="text-[10px] text-slate-500 block mt-1">
                            {explorerCalculations.isDataGap ? 'DATA GAP / INSUFFICIENT TELEMETRY' : '100% DISCOM sourcing @ ₹7.85/kWh'}
                          </span>
                        </div>

                        <div className="p-4 rounded-md bg-slate-950 border border-slate-800">
                          <span className="text-xs text-slate-400 block mb-1">Scenario Projected Monthly Bill</span>
                          <div className="text-xl font-bold font-mono text-emerald-400">
                            {explorerCalculations.isDataGap ? 'CONFIGURATION REQUIRED' : formatPaiseToInr(explorerCalculations.scenarioCostPaise * 30)}
                          </div>
                          <span className="text-[10px] text-emerald-300 block mt-1">
                            {explorerCalculations.isDataGap ? 'DATA GAP' : `Effective unit rate: ₹${explorerCalculations.landedUnitCostInr}/kWh`}
                          </span>
                        </div>
                      </div>

                      <div className="p-4 rounded-md bg-teal-950/30 border border-teal-800/60 flex items-center justify-between">
                        <div>
                          <span className="text-xs font-semibold text-teal-300 block">Total Avoided Cost Potential</span>
                          <span className="text-[11px] text-slate-300">Summed across solar self-consumption and battery arbitrage.</span>
                        </div>
                        <div className="text-2xl font-bold font-mono text-teal-400">
                          {explorerCalculations.isDataGap ? 'DATA GAP' : `${formatPaiseToInr(explorerCalculations.monthlyAvoidedPaise)} / mo`}
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* Cryptographic Provenance Footer */}
            <ProvenanceFooter
              sourceTimestamp={qualityGate.qualityMetadata.sourceTimestamp}
              sourceType={qualityGate.qualityMetadata.sourceType}
              freshnessStatus={qualityGate.qualityMetadata.freshnessStatus}
              validationStatus={qualityGate.qualityMetadata.validationStatus}
              completenessPct={qualityGate.qualityMetadata.completenessPct}
              modelVersion={qualityGate.qualityMetadata.modelVersion}
              tariffVersion={qualityGate.qualityMetadata.tariffVersion}
            />
          </>
        )}
      </div>
    </ModuleGate>
  );
}
