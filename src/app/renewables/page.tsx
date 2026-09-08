'use client';

import React, { useState, useEffect } from 'react';
import {
  Sun,
  Leaf,
  BarChart2,
  CheckCircle2,
  TrendingUp,
  FileCheck,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { ModuleGate } from '@/components/shared/ModuleGate';
import { formatPower, formatEnergy, formatPercentage, formatEmissions } from '@/lib/units/energy';

export default function RenewablesPage() {
  const { currentSite, isEntitled } = useSite();
  const [reconData, setReconData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reconError, setReconError] = useState<string | null>(null);

  const solarAsset = {
    name: 'Rooftop Solar PV Array 1',
    installedCapacityKw: 1200.0,
    technology: 'Crystalline Silicon Rooftop',
    measuredGenerationKwh: reconData?.total_measured_generation_kwh || reconData?.measured_generation_kwh || (currentSite?.is_demo ? 4420.0 : 0),
    modelledGenerationKwh: reconData?.total_modelled_generation_kwh || reconData?.modelled_generation_kwh || (currentSite?.is_demo ? 4680.0 : 0),
    estimatedGenerationKwh: reconData?.estimated_generation_kwh || (currentSite?.is_demo ? 4500.0 : 0),
    selfConsumptionKwh: reconData?.self_consumption_kwh || (currentSite?.is_demo ? 3910.0 : 0),
    gridExportKwh: reconData?.grid_export_kwh || (currentSite?.is_demo ? 510.0 : 0),
    avoidedEmissionsTco2e: reconData?.avoided_emissions_tco2e || (currentSite?.is_demo ? 3.16 : 0),
    emissionFactorSource: reconData?.emission_factor_source || 'CEA_CO2_BASELINE_DB_v19 (0.716 tCO2e/MWh)',
  };

  useEffect(() => {
    if (!currentSite?.id) return;
    let isMounted = true;
    setIsLoading(true);
    setReconError(null);

    const targetDate = new Date().toISOString().substring(0, 10);
    const isDemo = Boolean(currentSite.is_demo);

    fetch('/api/renewables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: currentSite.id,
        operatingDate: targetDate,
        ...(isDemo
          ? {
              installedCapacityKw: 1200.0,
              measuredGenerationKwh: 4420.0,
              siteTotalConsumptionKwh: 5200.0,
            }
          : {}),
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || errData.message || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (isMounted) setReconData(data);
      })
      .catch((err) => {
        console.warn('Renewables API fetch error:', err);
        if (isMounted) setReconError(err.message);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentSite?.id, currentSite?.is_demo]);

  const selfConsumptionPct = solarAsset.measuredGenerationKwh > 0 ? (solarAsset.selfConsumptionKwh / solarAsset.measuredGenerationKwh) * 100.0 : 0;
  const performanceRatio = solarAsset.modelledGenerationKwh > 0 ? (solarAsset.measuredGenerationKwh / solarAsset.modelledGenerationKwh) * 100.0 : 0;

  return (
    <ModuleGate
      productId="RENEWABLE_PORTFOLIO"
      productName="Renewable Portfolio Monitor"
      description="Generation reconciliation, self-consumption tracking, and avoided carbon emission accounting."
      basePricePaise={2490000}
      isEntitled={isEntitled('RENEWABLE_PORTFOLIO')}
    >
      <div className="space-y-6">
        {reconError && (
          <div className="p-4 rounded-md bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <strong>Renewables Reconciliation Error:</strong> {reconError}. Live mode requires active AMR generation telemetry.
            </div>
          </div>
        )}
        {currentSite?.is_demo && (
          <div className="flex items-center gap-2">
            <Badge variant="warning">DEMO / SYNTHETIC / UNVERIFIED</Badge>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
                <Sun className="w-5 h-5 text-amber-400" />
                Renewable Portfolio Monitor
              </h1>
              <Badge variant="outline">DEMO_ONLY</Badge>
              {reconData?.persisted && (
                <Badge variant="success">DB PERSISTED LEDGER</Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Generation reconciliation, self-consumption tracking, and avoided carbon emission accounting.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="success">Technology: Solar PV</Badge>
            {isLoading && <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />}
          </div>
        </div>

        {/* Distinction of Measured vs Modelled vs Estimated */}
        <Card variant="industrial">
          <CardHeader>
            <div>
              <CardTitle className="text-amber-400">
                Generation Reconciliation - Measured vs. Modelled vs. Estimated
              </CardTitle>
              <CardDescription>
                Strictly categorizes telemetry sources to preserve audit integrity under GHG protocol standards.
              </CardDescription>
            </div>
          </CardHeader>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 bg-slate-950 rounded border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Actual Meter Drawal</span>
                <Badge variant="success">MEASURED</Badge>
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-300">
                {formatEnergy(solarAsset.measuredGenerationKwh)}
              </div>
              <span className="text-[11px] text-slate-500">From revenue class bi-directional meter</span>
            </div>

            <div className="p-4 bg-slate-950 rounded border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Engineering Yield Model</span>
                <Badge variant="info">MODELLED</Badge>
              </div>
              <div className="text-2xl font-bold font-mono text-sky-300">
                {formatEnergy(solarAsset.modelledGenerationKwh)}
              </div>
              <span className="text-[11px] text-slate-500">PVSyst / Irradiance simulation baseline</span>
            </div>

            <div className="p-4 bg-slate-950 rounded border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Weather-Adjusted Norm</span>
                <Badge variant="outline">ESTIMATED</Badge>
              </div>
              <div className="text-2xl font-bold font-mono text-slate-200">
                {formatEnergy(solarAsset.estimatedGenerationKwh)}
              </div>
              <span className="text-[11px] text-slate-500">Derived from local pyranometer satellite data</span>
            </div>
          </div>
        </Card>

        {/* KPI Performance Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card variant="default">
            <span className="text-xs text-slate-400 block mb-1">Performance Ratio (PR)</span>
            <div className="text-2xl font-bold font-mono text-teal-300">
              {formatPercentage(performanceRatio)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Measured generation vs theoretical solar insolation
            </p>
          </Card>

          <Card variant="default">
            <span className="text-xs text-slate-400 block mb-1">Self-Consumption Ratio</span>
            <div className="text-2xl font-bold font-mono text-emerald-300">
              {formatPercentage(selfConsumptionPct)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {formatEnergy(solarAsset.selfConsumptionKwh)} utilized onsite • {formatEnergy(solarAsset.gridExportKwh)} exported
            </p>
          </Card>

          <Card variant="default">
            <span className="text-xs text-slate-400 block mb-1">Avoided Carbon Emissions (Today)</span>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {formatEmissions(solarAsset.avoidedEmissionsTco2e)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Baseline factor: 0.716 tCO₂e/MWh (CEA DB v19)
            </p>
          </Card>
        </div>

        {/* Carbon & ESG Disclaimer Card */}
        <div className="p-4 rounded-md border border-slate-800 bg-slate-900/60 text-xs text-slate-300 flex items-start gap-3">
          <Leaf className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Carbon Accounting Notice:</strong> Avoided greenhouse gas emissions shown above represent internal operational estimates derived from CEA grid emission factors.
            These calculations do NOT constitute certified carbon credits or registered Renewable Energy Certificates (RECs) until verified by accredited carbon registries.
          </p>
        </div>

        {/* Provenance Footer */}
        <ProvenanceFooter
          modelVersion="RENEWABLE_RECONCILIATION_v1.0"
          modelGenerationTime="2026-09-07T00:00:00Z"
          ruleVersion="CEA_CO2_BASELINE_DB_v19_VALIDATED"
        />
      </div>
    </ModuleGate>
  );
}
