'use client';

import React, { useState, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Moon,
  Volume2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { getBlockTimes } from '@/lib/dates/blocks96';

export default function DSMPage() {
  const { currentSite } = useSite();
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [acknowledgedIncidents, setAcknowledgedIncidents] = useState<Set<string>>(new Set());

  // Deterministic 96 blocks for deviation analysis
  const deviationBlocks = useMemo(() => {
    const blocks = [];
    for (let b = 1; b <= 96; b++) {
      const timing = getBlockTimes(b);
      let scheduled = 1200.0;
      let actual = 1200.0;

      // Simulate an afternoon industrial ramp-up deviation (Blocks 54–58: 13:15 to 14:30)
      if (b >= 54 && b <= 58) {
        actual = 1380.0; // 15% positive deviation (Critical)
      } else if (b >= 30 && b <= 33) {
        actual = 1280.0; // ~6.6% deviation (Watch)
      }

      const devKw = actual - scheduled;
      const pct = (Math.abs(devKw) / scheduled) * 100.0;

      let risk: 'NORMAL' | 'WATCH' | 'HIGH' | 'CRITICAL' = 'NORMAL';
      if (pct >= 12.0) risk = 'CRITICAL';
      else if (pct >= 8.0) risk = 'HIGH';
      else if (pct >= 4.0) risk = 'WATCH';

      blocks.push({
        block_index: b,
        startTime: timing.startTime,
        endTime: timing.endTime,
        scheduledKw: scheduled,
        actualKw: actual,
        devKw,
        devPct: pct,
        risk,
      });
    }
    return blocks;
  }, []);

  // Incident Grouping (combines adjacent non-normal blocks)
  const incidents = useMemo(() => {
    return [
      {
        id: 'inc-01',
        timeWindow: '13:15 - 14:30 IST',
        blocks: 'Blocks 54 to 58 (5 blocks)',
        severity: 'CRITICAL',
        maxDeviation: '+15.0%',
        excessEnergyKwh: 225.0,
        estimatedExposure: '₹3,150.00 (DEMO)',
        cause: 'Aetheon Demo Plant 1 press shop unexpected parallel shift startup',
      },
      {
        id: 'inc-02',
        timeWindow: '07:15 - 08:15 IST',
        blocks: 'Blocks 30 to 33 (4 blocks)',
        severity: 'WATCH',
        maxDeviation: '+6.6%',
        excessEnergyKwh: 80.0,
        estimatedExposure: '₹280.00 (DEMO)',
        cause: 'Morning compressor pre-heating variance',
      },
    ];
  }, []);

  const handleAcknowledge = (id: string) => {
    setAcknowledgedIncidents((prev) => new Set(prev).add(id));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-rose-400" />
              DSM Risk Monitor (Deviation Settlement Mechanism)
            </h1>
            <Badge variant="demo">DEMO / UNVERIFIED</Badge>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time 15-minute scheduled vs. actual deviation tracking under CERC/SERC guidelines.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="success">Rule Engine: CERC_DSM_2024</Badge>
        </div>
      </div>

      {/* Operational Safeguards Card */}
      <Card variant="industrial">
        <CardHeader>
          <div>
            <CardTitle className="text-rose-400">
              <ShieldAlert className="w-4 h-4" />
              Operational Safeguards & Alert Dampening
            </CardTitle>
            <CardDescription>
              Prevents alert fatigue, enforces quiet hours, and suppresses notifications during meter maintenance.
            </CardDescription>
          </div>
        </CardHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="p-3 bg-slate-950 rounded border border-slate-800 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Moon className="w-3.5 h-3.5 text-teal-400" />
                Quiet Hours (22:00 - 06:00 IST)
              </span>
              <p className="text-[10px] text-slate-400">Non-critical alerts muted on SMS</p>
            </div>
            <input
              type="checkbox"
              checked={quietHoursEnabled}
              onChange={(e) => setQuietHoursEnabled(e.target.checked)}
              className="w-4 h-4 accent-teal-500 cursor-pointer"
            />
          </div>

          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-0.5">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-amber-400" />
              Alert Rate Limiter
            </span>
            <p className="text-[10px] text-slate-400">Maximum 1 notification per 30 minutes for single incident</p>
          </div>

          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-0.5">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              Missing Input Suppression
            </span>
            <p className="text-[10px] text-emerald-400 font-medium">Active (Zero manufactured penalty figures)</p>
          </div>
        </div>
      </Card>

      {/* Active Operational Incidents (Adjacent-block grouping) */}
      <Card variant="default">
        <CardHeader>
          <div>
            <CardTitle className="text-slate-100">
              Active Deviation Incidents (Grouped)
            </CardTitle>
            <CardDescription>
              Adjacent out-of-band deviation blocks automatically grouped into actionable operational incidents.
            </CardDescription>
          </div>
        </CardHeader>

        <div className="space-y-3">
          {incidents.map((inc) => {
            const isAck = acknowledgedIncidents.has(inc.id);
            return (
              <div
                key={inc.id}
                className="p-4 rounded-md bg-slate-950 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={inc.severity === 'CRITICAL' ? 'danger' : 'warning'}>
                      {inc.severity}
                    </Badge>
                    <span className="text-xs font-bold text-slate-200">{inc.timeWindow}</span>
                    <span className="text-[11px] text-slate-500 font-mono">({inc.blocks})</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Max Deviation: <strong className="text-rose-400">{inc.maxDeviation}</strong> • Excess Energy: {inc.excessEnergyKwh} kWh • Est. Penalty Exposure: <span className="text-amber-300 font-mono">{inc.estimatedExposure}</span>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Root Cause: <em>{inc.cause}</em>
                  </p>
                </div>

                <div>
                  {isAck ? (
                    <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      Acknowledged
                    </span>
                  ) : (
                    <Button onClick={() => handleAcknowledge(inc.id)} variant="primary" size="sm" className="text-xs">
                      Acknowledge Incident
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 96-Block Deviation Operational Grid */}
      <Card variant="default">
        <CardHeader>
          <div>
            <CardTitle className="text-slate-100">
              Today&apos;s 96-Block Deviation Log
            </CardTitle>
            <CardDescription>
              Actual drawal vs approved SLDC schedule across every 15-minute block.
            </CardDescription>
          </div>
        </CardHeader>

        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900 sticky top-0 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="p-3">Block</th>
                <th className="p-3">Time Window</th>
                <th className="p-3 text-right">Scheduled (kW)</th>
                <th className="p-3 text-right">Actual (kW)</th>
                <th className="p-3 text-right">Variance (kW)</th>
                <th className="p-3 text-right">Deviation %</th>
                <th className="p-3 text-center">Risk Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {deviationBlocks.map((b) => (
                <tr key={b.block_index} className={b.risk === 'CRITICAL' ? 'bg-rose-950/20' : b.risk === 'WATCH' ? 'bg-amber-950/20' : 'hover:bg-slate-900/40'}>
                  <td className="p-3 font-mono font-bold text-slate-400">B{b.block_index}</td>
                  <td className="p-3 font-mono">{b.startTime} - {b.endTime}</td>
                  <td className="p-3 text-right font-mono">{b.scheduledKw}</td>
                  <td className="p-3 text-right font-mono font-semibold text-slate-100">{b.actualKw}</td>
                  <td className="p-3 text-right font-mono text-rose-400">{b.devKw > 0 ? `+${b.devKw}` : b.devKw}</td>
                  <td className="p-3 text-right font-mono">{b.devPct.toFixed(1)}%</td>
                  <td className="p-3 text-center">
                    <Badge variant={b.risk === 'CRITICAL' ? 'danger' : b.risk === 'WATCH' ? 'warning' : 'outline'}>
                      {b.risk}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Provenance Footer */}
      <ProvenanceFooter
        modelVersion="CERC_DSM_HEURISTIC_v1.0"
        modelGenerationTime="2026-09-06T18:00:00Z"
        ruleVersion="CERC_DSM_2024_DEMO"
      />
    </div>
  );
}
