'use client';

import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { useSite } from '@/components/layout/SiteContext';
import { Block96Chart, type Block96Point } from '@/components/shared/Block96Chart';
import { DataQualityBadge } from '@/components/shared/DataQualityBadge';
import { FreshnessBadge } from '@/components/shared/FreshnessBadge';
import { QualityGateBlock } from '@/components/shared/QualityGateBlock';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { evaluateQualityGate } from '@/features/quality/qualityGate';
import { getBlockTimes } from '@/lib/dates/blocks96';
import { formatPower, formatEnergy, formatPercentage } from '@/lib/units/energy';
import { formatPaiseToInr } from '@/lib/units/currency';

export default function GridIntelligencePage() {
  const { currentSite } = useSite();
  const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'explorer'>('chart');
  const [solarEnabled, setSolarEnabled] = useState(true);
  const [bessEnabled, setBessEnabled] = useState(true);
  const [oaEnabled, setOaEnabled] = useState(false);

  // Quality gate evaluation
  const qualityGate = useMemo(() => {
    return evaluateQualityGate({
      sourceTimestamp: '2026-09-06T18:00:00Z',
      sourceType: '15-min Smart AMR Meter (Demo)',
      completenessPct: currentSite.activation_status === 'ACTIVE' ? 100.0 : 0.0,
      totalBlocksExpected: 96,
      totalBlocksReceived: currentSite.activation_status === 'ACTIVE' ? 96 : 0,
      validationStatus: currentSite.activation_status === 'ACTIVE' ? 'PASSED' : 'STALE',
      freshnessStatus: currentSite.activation_status === 'ACTIVE' ? 'RECENT' : 'STALE',
      modelVersion: 'GRID_INTEL_DAY_AHEAD_v1.0',
      modelGenerationTime: '2026-09-06T18:30:00Z',
      tariffVersion: 'MSEDCL_HT1_TOD_2024_DEMO',
    });
  }, [currentSite]);

  // Generate deterministic 96 blocks for demonstration
  const forecastBlocks: Block96Point[] = useMemo(() => {
    const pts: Block96Point[] = [];
    const baseDemand = currentSite.contract_demand_value * 0.75;

    for (let b = 1; b <= 96; b++) {
      const timing = getBlockTimes(b);
      const hour = (b - 1) / 4.0;

      // Diurnal demand curve
      let demandFactor = 0.65 + 0.25 * Math.sin(((hour - 6) * Math.PI) / 12.0);
      if (hour >= 9 && hour <= 14) demandFactor += 0.12;
      const demandKw = Math.round(baseDemand * Math.max(0.4, Math.min(0.95, demandFactor)));

      // Day-Ahead Market (DAM) Clearing Price (₹/MWh)
      let price = 4200;
      if (b >= 32 && b <= 44) price = 5600 + (b - 32) * 90; // Morning peak
      else if (b >= 72 && b <= 88) price = 7800 + Math.sin(((b - 72) / 16) * Math.PI) * 1800; // Evening peak
      else if (b <= 24) price = 2900 + (b % 4) * 50; // Night valley

      // Solar generation (blocks 25 to 72)
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
  }, [currentSite]);

  // Cost Explorer scenario math
  const explorerCalculations = useMemo(() => {
    const totalDailyKwh = forecastBlocks.reduce((acc, b) => acc + (b.demand_kw || 0) * 0.25, 0);
    const baselineCostPaise = Math.round(totalDailyKwh * 7.85 * 100); // Baseline utility tariff ₹7.85/kWh

    let avoidedKwh = 0;
    if (solarEnabled) avoidedKwh += 4200; // ~4,200 kWh solar generation
    if (bessEnabled) avoidedKwh += 1500;  // 1,500 kWh peak shaved

    const scenarioKwhFromGrid = Math.max(0, totalDailyKwh - avoidedKwh);
    const gridTariffRate = oaEnabled ? 5.20 : 7.85; // Landed open access ₹5.20 vs DISCOM ₹7.85
    const scenarioCostPaise = Math.round(scenarioKwhFromGrid * gridTariffRate * 100);

    const dailyAvoidedPaise = Math.max(0, baselineCostPaise - scenarioCostPaise);
    const monthlyAvoidedPaise = dailyAvoidedPaise * 30;

    return {
      totalDailyKwh,
      baselineCostPaise,
      scenarioCostPaise,
      dailyAvoidedPaise,
      monthlyAvoidedPaise,
      landedUnitCostInr: (scenarioCostPaise / (totalDailyKwh * 100)).toFixed(2),
    };
  }, [forecastBlocks, solarEnabled, bessEnabled, oaEnabled]);

  const handleExportCsv = () => {
    const headers = ['block_index', 'start_time', 'forecast_demand_kw', 'forecast_price_inr_per_mwh', 'solar_generation_kw', 'is_high_cost'];
    const rows = forecastBlocks.map((b) =>
      [b.block_index, b.start_time, b.demand_kw, b.price_mwh, b.solar_kw, b.is_high_cost ? 'YES' : 'NO'].join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `grid_forecast_96block_${currentSite.name.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              <Zap className="w-5 h-5 text-teal-400" />
              Grid Intelligence Monitor
            </h1>
            <Badge variant="success">Primary Sellable Target</Badge>
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

      {/* Quality Gate Check: Hard Suppression if data is stale */}
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
                Block 38 (09:15 - 09:30)
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Projected demand: <strong>{formatPower(2180.5)}</strong>
              </p>
            </Card>

            <Card variant="industrial">
              <span className="text-xs text-slate-400 block mb-1">Highest Cost Window</span>
              <div className="text-xl font-bold font-mono text-rose-400">
                Blocks 72–88 (18:00 - 22:00)
              </div>
              <p className="text-xs text-rose-300 mt-1">
                Clearing price: <strong>₹7,800 - ₹9,600/MWh</strong>
              </p>
            </Card>

            <Card variant="industrial">
              <span className="text-xs text-slate-400 block mb-1">Lowest Cost Sourcing Window</span>
              <div className="text-xl font-bold font-mono text-emerald-400">
                Blocks 1–20 (00:00 - 05:00)
              </div>
              <p className="text-xs text-emerald-300 mt-1">
                Clearing price: <strong>₹2,800 - ₹3,400/MWh</strong>
              </p>
            </Card>

            <Card variant="industrial">
              <span className="text-xs text-slate-400 block mb-1">Avoided Cost Opportunity</span>
              <div className="text-xl font-bold font-mono text-teal-300">
                {formatPaiseToInr(explorerCalculations.dailyAvoidedPaise)} / day
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Monthly potential: <strong>{formatPaiseToInr(explorerCalculations.monthlyAvoidedPaise)}</strong>
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
                96-Block Profile Chart
              </Button>
              <Button
                variant={activeTab === 'table' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('table')}
                className="gap-1.5 text-xs"
              >
                <TableIcon className="w-3.5 h-3.5" />
                96-Block Tabular Grid
              </Button>
              <Button
                variant={activeTab === 'explorer' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('explorer')}
                className="gap-1.5 text-xs"
              >
                <Sliders className="w-3.5 h-3.5" />
                Cost Explorer & Sourcing Mix
              </Button>
            </div>

            <span className="text-xs text-slate-500 font-mono">
              Operating Date: Tomorrow (IST)
            </span>
          </div>

          {/* Tab 1: Interactive 96-Block Chart */}
          {activeTab === 'chart' && (
            <div className="space-y-4">
              <Block96Chart data={forecastBlocks} showPrice={true} showSolar={true} height={400} />
              <div className="p-3 bg-slate-900/60 rounded-md border border-slate-800 text-xs text-slate-300 flex items-center justify-between">
                <span>
                  <strong>Confidence Band:</strong> ±6.0% interval load envelope based on 30-day historical AMR meter calibration.
                </span>
                <span className="text-teal-400 font-mono">
                  Algorithm: Baseline Heuristic (DEMO)
                </span>
              </div>
            </div>
          )}

          {/* Tab 2: 96-Block Table */}
          {activeTab === 'table' && (
            <Card variant="default">
              <div className="max-h-[500px] overflow-y-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900 sticky top-0 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="p-3">Block</th>
                      <th className="p-3">Time Window</th>
                      <th className="p-3 text-right">Forecast Demand (kW)</th>
                      <th className="p-3 text-right">Clearing Price (₹/MWh)</th>
                      <th className="p-3 text-right">Solar PV (kW)</th>
                      <th className="p-3 text-center">Cost Band</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {forecastBlocks.map((b) => (
                      <tr key={b.block_index} className={b.is_high_cost ? 'bg-rose-950/20' : 'hover:bg-slate-900/40'}>
                        <td className="p-3 font-mono font-bold text-slate-400">B{b.block_index}</td>
                        <td className="p-3 font-mono">{b.start_time} - {getBlockTimes(b.block_index).endTime}</td>
                        <td className="p-3 text-right font-mono font-semibold text-slate-100">{b.demand_kw}</td>
                        <td className="p-3 text-right font-mono text-amber-300">₹{b.price_mwh}</td>
                        <td className="p-3 text-right font-mono text-yellow-300">{b.solar_kw || 0}</td>
                        <td className="p-3 text-center">
                          {b.is_high_cost ? (
                            <Badge variant="danger">HIGH COST</Badge>
                          ) : (
                            <Badge variant="outline">NORMAL</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Tab 3: Cost Explorer */}
          {activeTab === 'explorer' && (
            <Card variant="default" className="space-y-6">
              <CardHeader>
                <div>
                  <CardTitle className="text-teal-400">
                    <DollarSign className="w-4 h-4" />
                    Landed Cost Scenario Explorer
                  </CardTitle>
                  <CardDescription>
                    Compare current utility baseline against configured onsite solar, battery storage, and Open Access sourcing.
                  </CardDescription>
                </div>
              </CardHeader>

              {/* Sourcing Toggles */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-md bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">Onsite Solar PV</span>
                    <input
                      type="checkbox"
                      checked={solarEnabled}
                      onChange={(e) => setSolarEnabled(e.target.checked)}
                      className="w-4 h-4 accent-teal-500 cursor-pointer"
                    />
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    1,200 kW installed capacity behind-the-meter. Generates ~4,200 kWh/day self-consumption.
                  </p>
                </div>

                <div className="p-4 rounded-md bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">BESS Storage Shaving</span>
                    <input
                      type="checkbox"
                      checked={bessEnabled}
                      onChange={(e) => setBessEnabled(e.target.checked)}
                      className="w-4 h-4 accent-teal-500 cursor-pointer"
                    />
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    1,000 kWh / 500 kW battery asset. Discharges during 18:00–21:00 evening peak ToD tariff.
                  </p>
                </div>

                <div className="p-4 rounded-md bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">Open Access Sourcing</span>
                    <input
                      type="checkbox"
                      checked={oaEnabled}
                      onChange={(e) => setOaEnabled(e.target.checked)}
                      className="w-4 h-4 accent-teal-500 cursor-pointer"
                    />
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Group captive / bilateral procurement. Replaces grid tariff with landed cost of ₹5.20/kWh.
                  </p>
                </div>
              </div>

              {/* Scenario Financial Comparison Table */}
              <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                  Daily Cost Impact Breakdown
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-3 rounded bg-slate-900 border border-slate-800">
                    <span className="text-xs text-slate-400 block mb-1">Baseline Cost (MSEDCL HT-1)</span>
                    <div className="text-lg font-bold font-mono text-slate-200">
                      {formatPaiseToInr(explorerCalculations.baselineCostPaise)}
                    </div>
                    <span className="text-[11px] text-slate-500">Fixed ₹7.85/kWh average landed rate</span>
                  </div>

                  <div className="p-3 rounded bg-slate-900 border border-slate-800">
                    <span className="text-xs text-slate-400 block mb-1">Optimized Scenario Cost</span>
                    <div className="text-lg font-bold font-mono text-teal-300">
                      {formatPaiseToInr(explorerCalculations.scenarioCostPaise)}
                    </div>
                    <span className="text-[11px] text-teal-400">
                      Effective rate: ₹{explorerCalculations.landedUnitCostInr}/kWh
                    </span>
                  </div>

                  <div className="p-3 rounded bg-emerald-950/30 border border-emerald-800/60">
                    <span className="text-xs text-emerald-300 block mb-1">Daily Avoided Landed Cost</span>
                    <div className="text-lg font-bold font-mono text-emerald-400">
                      {formatPaiseToInr(explorerCalculations.dailyAvoidedPaise)}
                    </div>
                    <span className="text-[11px] text-emerald-300">
                      ~{formatPaiseToInr(explorerCalculations.monthlyAvoidedPaise)} / month
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Provenance Footer */}
      <ProvenanceFooter
        modelVersion={qualityGate.qualityMetadata.modelVersion}
        modelGenerationTime={qualityGate.qualityMetadata.modelGenerationTime}
        tariffVersion={qualityGate.qualityMetadata.tariffVersion}
      />
    </div>
  );
}
