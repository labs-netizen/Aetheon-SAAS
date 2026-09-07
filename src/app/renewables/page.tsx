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

  // Solar asset parameters
  const solarAsset = {
    name: 'Factory Rooftop Solar PV Phase 1',
    installedCapacityKw: 1200.0,
    technology: 'Crystalline Silicon Rooftop',
    measuredGenerationKwh: reconData?.measured_generation_kwh || 4420.0,
    modelledGenerationKwh: reconData?.modelled_generation_kwh || 4680.0,
    estimatedGenerationKwh: reconData?.estimated_generation_kwh || 4500.0,
    selfConsumptionKwh: reconData?.self_consumption_kwh || 3910.0,
    gridExportKwh: reconData?.grid_export_kwh || 510.0,
    avoidedEmissionsTco2e: reconData?.avoided_emissions_tco2e || 3.16,
    emissionFactorSource: 'CEA_CO2_BASELINE_DB_v19 (0.716 tCO2e/MWh)',
  };

  useEffect(() => {
    if (!currentSite?.id) return;
    let isMounted = true;
    setIsLoading(true);

    const targetDate = new Date().toISOString().substring(0, 10);
    fetch('/api/renewables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assetId: 'solar_01',
        siteId: currentSite.id,
        operatingDate: targetDate,
        measuredGenerationKwh: 4420.0,
        modelledGenerationKwh: 4680.0,
        estimatedGenerationKwh: 4500.0,
        siteTotalConsumptionKwh: 5200.0,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) setReconData(data);
      })
      .catch((err) => {
        console.warn('Renewables API fetch error:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentSite?.id]);

  const selfConsumptionPct = (solarAsset.selfConsumptionKwh / solarAsset.measuredGenerationKwh) * 100.0;
  const performanceRatio = (solarAsset.measuredGenerationKwh / solarAsset.modelledGenerationKwh) * 100.0;

  return (
    <ModuleGate
      productId="RENEWABLE_PORTFOLIO"
      productName="Renewable Portfolio Monitor"
      description="Generation reconciliation, self-consumption tracking, and avoided carbon emission accounting."
      basePricePaise={3500000}
      isEntitled={isEntitled('RENEWABLE_PORTFOLIO')}
    >
      <div className="space-y-6">
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
