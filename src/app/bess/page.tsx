'use client';

import React, { useState } from 'react';
import {
  BatteryCharging,
  Zap,
  Lock,
  AlertOctagon,
  Sliders,
  DollarSign,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { formatPower, formatEnergy, formatSoc } from '@/lib/units/energy';

export default function BESSPage() {
  const { currentSite } = useSite();
  const [maintenanceLock, setMaintenanceLock] = useState(false);
  const [simulatedSoc, setSimulatedSoc] = useState(48.0);

  // Asset parameters (Tesla Megapack 2XL Demo)
  const battery = {
    name: 'Tesla Megapack 2XL Demo Asset',
    usableCapacityKwh: 1000.0,
    powerRatingKw: 500.0,
    minSocPct: 10.0,
    maxSocPct: 90.0,
    chargeEff: 0.92,
    dischargeEff: 0.92,
    degCostPerCycleInr: 1800.0,
  };

  // Hard safety interlock check
  const isSafetyLocked = maintenanceLock || simulatedSoc < battery.minSocPct;

  // Advisory opportunity windows
  const opportunityWindows = [
    {
      action: 'CHARGE',
      timeWindow: '01:30 - 04:30 IST',
      blocks: 'Blocks 7–18',
      avgPrice: '₹2,950 / MWh',
      targetSoc: '85.0%',
      rationale: 'Deep off-peak night valley tariff on Day-Ahead Market.',
    },
    {
      action: 'DISCHARGE',
      timeWindow: '18:30 - 20:30 IST',
      blocks: 'Blocks 74–82',
      avgPrice: '₹8,400 / MWh',
      targetSoc: '18.0%',
      rationale: 'Discharge against MSEDCL HT-1 evening peak ToD tariff slab.',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              <BatteryCharging className="w-5 h-5 text-purple-400" />
              BESS Arbitrage Signals (Battery Energy Storage)
            </h1>
            <Badge variant="demo">DEMO / UNVERIFIED</Badge>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Degradation-aware advisory opportunity windows for commercial and industrial energy storage assets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline">Advisory Mode (Zero Plant Control)</Badge>
        </div>
      </div>

      {/* Strict Advisory Boundary Banner */}
      <div className="p-4 rounded-md border border-purple-900/50 bg-purple-950/20 text-xs text-purple-200/90 flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>Mandatory Safety & Boundary Guardrail:</strong> Signals generated below represent <em>advisory recommended opportunity windows</em> only.
          This platform does NOT dispatch physical inverter equipment, override battery management systems (BMS), or control substation SCADA.
        </p>
      </div>

      {/* Battery Telemetry & State Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="industrial">
          <span className="text-xs text-slate-400 block mb-1">Battery Asset</span>
          <div className="text-base font-bold text-slate-100 truncate">
            {battery.name}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Capacity: <strong>{formatEnergy(battery.usableCapacityKwh)}</strong> • Rating: <strong>{formatPower(battery.powerRatingKw)}</strong>
          </p>
        </Card>

        <Card variant="industrial">
          <span className="text-xs text-slate-400 block mb-1">Current State of Charge (SOC)</span>
          <div className="text-2xl font-bold font-mono text-purple-300">
            {formatSoc(simulatedSoc)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Operational bounds: {battery.minSocPct}% to {battery.maxSocPct}%
          </p>
        </Card>

        <Card variant="industrial">
          <span className="text-xs text-slate-400 block mb-1">Round-Trip Efficiency (RTE)</span>
          <div className="text-2xl font-bold font-mono text-slate-200">
            {((battery.chargeEff * battery.dischargeEff) * 100).toFixed(1)}%
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Cell degradation: ₹{battery.degCostPerCycleInr}/cycle
          </p>
        </Card>

        <Card variant="industrial">
          <span className="text-xs text-slate-400 block mb-1">Safety Interlock Lockout</span>
          <div className="flex items-center justify-between mt-1">
            <span className={isSafetyLocked ? 'text-rose-400 font-bold text-sm' : 'text-emerald-400 font-bold text-sm'}>
              {isSafetyLocked ? 'LOCKOUT ACTIVE' : 'TELEMETRY HEALTHY'}
            </span>
            <Button
              onClick={() => setMaintenanceLock(!maintenanceLock)}
              variant={maintenanceLock ? 'danger' : 'outline'}
              size="sm"
              className="text-[11px] py-1 px-2"
            >
              {maintenanceLock ? 'Clear Lock' : 'Simulate Lock'}
            </Button>
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            Signals hard-suppressed when locked
          </p>
        </Card>
      </div>

      {/* Opportunity Windows Card */}
      <Card variant="default">
        <CardHeader>
          <div>
            <CardTitle className="text-purple-400">
              Recommended Charge / Discharge Opportunity Windows (Tomorrow Outlook)
            </CardTitle>
            <CardDescription>
              Advisory operational schedule maximizing net arbitrage value after accounting for battery degradation.
            </CardDescription>
          </div>
        </CardHeader>

        {isSafetyLocked ? (
          <div className="p-8 text-center rounded-lg border border-rose-900/60 bg-rose-950/20 space-y-2">
            <AlertOctagon className="w-8 h-8 text-rose-400 mx-auto" />
            <h4 className="text-sm font-semibold text-rose-200">
              Advisory Signals Hard-Suppressed
            </h4>
            <p className="text-xs text-rose-300/90 max-w-md mx-auto leading-relaxed">
              Battery maintenance lockout is active or SOC is outside operating bounds. To protect asset health, no opportunity windows are broadcast.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {opportunityWindows.map((win, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-md bg-slate-950 border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant={win.action === 'CHARGE' ? 'info' : 'success'}>
                      RECOMMENDED {win.action}
                    </Badge>
                    <span className="font-mono text-xs font-bold text-slate-200">{win.timeWindow}</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Expected DAM Price: <strong className="text-amber-300">{win.avgPrice}</strong> • Target SOC: <span className="text-purple-300">{win.targetSoc}</span>
                  </p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Strategy: {win.rationale}
                  </p>
                </div>
              ))}
            </div>

            {/* Financial Net Value Calculation */}
            <div className="p-4 rounded-md bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div>
                <span className="text-slate-400 block">Gross Daily Arbitrage Spread:</span>
                <span className="text-base font-bold font-mono text-slate-200">₹4,250.00</span>
              </div>
              <div>
                <span className="text-slate-400 block">Estimated Cell Degradation:</span>
                <span className="text-base font-bold font-mono text-rose-400">-₹1,440.00</span>
              </div>
              <div className="p-2.5 rounded bg-emerald-950/40 border border-emerald-800/60">
                <span className="text-emerald-300 block font-semibold">Net Daily Opportunity Value:</span>
                <span className="text-lg font-bold font-mono text-emerald-400">+₹2,810.00 / day</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Provenance Footer */}
      <ProvenanceFooter
        modelVersion="BESS_HEURISTIC_SOLVER_v1.0"
        modelGenerationTime="2026-09-06T18:00:00Z"
      />
    </div>
  );
}
