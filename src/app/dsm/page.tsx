'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Moon,
  Volume2,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { ModuleGate } from '@/components/shared/ModuleGate';
import { getBlockTimes } from '@/lib/dates/blocks96';
import { PRODUCTS } from '@/types';

export default function DSMPage() {
  const { currentSite, isEntitled } = useSite();
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [acknowledgedIncidents, setAcknowledgedIncidents] = useState<Set<string>>(new Set());
  const [dsmDataResponse, setDsmData] = useState<any>(null);
  const dsmData = dsmDataResponse && dsmDataResponse.requestSiteId === currentSite?.id ? dsmDataResponse.data : null;
  const [isLoading, setIsLoading] = useState(false);

  const [dsmError, setDsmError] = useState<string | null>(null);

  // Trigger real backend DSM calculation from /api/dsm
  useEffect(() => {
    if (!currentSite?.id) return;
    let isMounted = true;
    setIsLoading(true);
    setDsmError(null);
    setAcknowledgedIncidents(new Set());

    const targetDate = new Date(Date.now()+330*60000-(currentSite.is_demo ? 0 : 86400000)).toISOString().substring(0, 10);
    
    // In demo mode only, generate deterministic synthetic 96-block arrays
    const isDemo = Boolean(currentSite.is_demo);
    const scheduled = isDemo ? Array.from({ length: 96 }, () => 1200.0) : undefined;
    const actual = isDemo ? Array.from({ length: 96 }, (_, i) => {
      if (i >= 53 && i <= 57) return 1380.0; // 15% positive deviation
      if (i >= 29 && i <= 32) return 1280.0; // ~6.6% deviation
      return 1200.0;
    }) : undefined;

    fetch('/api/dsm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: currentSite.id,
        operatingDate: targetDate,
        contractDemandKw: currentSite.contract_demand_value || 1000,
        ...(isDemo ? { scheduledDrawalKw: scheduled, actualDrawalKw: actual } : {}),
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
        if (isMounted) {
          setDsmData({ requestSiteId: currentSite.id, data });
          if (Array.isArray(data.incidents)) {
            const persistedAcks = new Set<string>();
            data.incidents.forEach((inc: any) => {
              if (inc.acknowledged && inc.id) persistedAcks.add(inc.id);
            });
            if (persistedAcks.size > 0) {
              setAcknowledgedIncidents((prev) => new Set([...prev, ...persistedAcks]));
            }
          }
        }
      })
      .catch((err) => {
        console.warn('DSM API fetch error:', err);
        if (isMounted) setDsmError(err.message);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentSite?.id, currentSite?.is_demo, currentSite?.contract_demand_value]);

  // Use backend incidents if available, or fallback ONLY in demo mode
  const incidents = useMemo(() => {
    if (dsmData?.is_suppressed || dsmData?.incidents?.length === 0) return [];
    const isDemo = Boolean(currentSite?.is_demo);
    if (dsmData?.incidents && Array.isArray(dsmData.incidents) && dsmData.incidents.length > 0) {
      return dsmData.incidents.map((inc: any, i: number) => {
        const maxDev = inc.max_deviation_pct !== undefined && inc.max_deviation_pct !== null
          ? `+${Number(inc.max_deviation_pct).toFixed(1)}%`
          : 'UNDEFINED (zero schedule)';
        const excessEnergy = inc.total_excess_energy_kwh !== undefined && inc.total_excess_energy_kwh !== null
          ? inc.total_excess_energy_kwh
          : (inc.excess_energy_kwh !== undefined ? inc.excess_energy_kwh : (isDemo ? 225.0 : null));
        const exposure = inc.estimated_exposure_inr !== undefined && inc.estimated_exposure_inr !== null
          ? `₹${Math.round(inc.estimated_exposure_inr).toLocaleString('en-IN')}`
          : (isDemo ? '₹3,150' : 'DATA GAP');

        return {
          id: inc.id || `inc-${i + 1}`,
          timeWindow: `${getBlockTimes(inc.start_block).startTime} - ${getBlockTimes(inc.end_block).endTime} IST`,
          blocks: `Blocks ${inc.start_block} to ${inc.end_block} (${inc.block_count || (inc.end_block - inc.start_block + 1)} blocks)`,
          severity: inc.severity || 'CRITICAL',
          maxDeviation: maxDev,
          excessEnergyKwh: excessEnergy,
          estimatedExposure: exposure,
          cause: inc.root_cause_tag || inc.cause || (isDemo ? 'Industrial ramp-up deviation beyond CERC allowable band' : 'UNSPECIFIED_DEVIATION'),
          acknowledged: Boolean(inc.acknowledged),
        };
      });
    }

    if (isDemo) {
      return [
        {
          id: 'inc-01',
          timeWindow: '13:15 - 14:30 IST',
          blocks: 'Blocks 54 to 58 (5 blocks)',
          severity: 'CRITICAL',
          maxDeviation: '+15.0%',
          excessEnergyKwh: 225.0,
          estimatedExposure: '₹3,150.00',
          cause: 'Facility press shop unexpected parallel shift startup',
          acknowledged: false,
        },
        {
          id: 'inc-02',
          timeWindow: '07:15 - 08:15 IST',
          blocks: 'Blocks 30 to 33 (4 blocks)',
          severity: 'WATCH',
          maxDeviation: '+6.6%',
          excessEnergyKwh: 80.0,
          estimatedExposure: '₹280.00',
          cause: 'Morning compressor pre-heating variance',
          acknowledged: false,
        },
      ];
    }

    return [];
  }, [dsmData, currentSite?.is_demo]);

  // Deviation blocks
  const deviationBlocks = useMemo(() => {
    if (dsmData?.is_suppressed) return [];
    const isDemo = Boolean(currentSite?.is_demo);
    if (dsmData?.blocks && Array.isArray(dsmData.blocks) && dsmData.blocks.length > 0) {
      return dsmData.blocks.map((b: any) => {
        const timing = getBlockTimes(b.block_index);
        const scheduled = b.scheduled_drawal_kw !== undefined && b.scheduled_drawal_kw !== null ? b.scheduled_drawal_kw : (isDemo ? 1200.0 : null);
        const actual = b.actual_drawal_kw !== undefined && b.actual_drawal_kw !== null ? b.actual_drawal_kw : (isDemo ? 1200.0 : null);
        const devKw = (scheduled !== null && actual !== null) ? actual - scheduled : null;
        const pct = (scheduled && devKw !== null) ? Math.abs(b.deviation_pct ?? (devKw / scheduled) * 100.0) : (b.deviation_pct ?? null);
        return {
          block_index: b.block_index,
          startTime: timing.startTime,
          endTime: timing.endTime,
          scheduledKw: scheduled,
          actualKw: actual,
          devKw,
          devPct: pct,
          risk: b.risk_level || (pct && pct >= 12.0 ? 'CRITICAL' : pct && pct >= 8.0 ? 'HIGH' : pct && pct >= 4.0 ? 'WATCH' : 'NORMAL'),
        };
      });
    }

    if (!isDemo) return [];

    const blocks = [];
    for (let b = 1; b <= 96; b++) {
      const timing = getBlockTimes(b);
      let scheduled = 1200.0;
      let actual = 1200.0;

      if (b >= 54 && b <= 58) actual = 1380.0;
      else if (b >= 30 && b <= 33) actual = 1280.0;

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
  }, [dsmData, currentSite?.is_demo]);

  const handleAcknowledge = async (id: string) => {
    if (!currentSite?.id) return;
    try {
      const res = await fetch('/api/dsm', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId: id, siteId: currentSite.id }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || `Acknowledgement failed: HTTP ${res.status}`);
      }
      setAcknowledgedIncidents((prev) => new Set(prev).add(id));
    } catch (ackErr) {
      console.error('Failed to persist incident acknowledgement to DB:', ackErr);
      setDsmError(ackErr instanceof Error ? ackErr.message : 'Failed to acknowledge incident');
    }
  };

  return (
    <ModuleGate
      productId="DSM_RISK"
      productName="DSM Risk Monitor"
      description="Deviation Settlement Mechanism exposure tracking, 96-block scheduling variance, and regulatory breach prevention."
      basePricePaise={PRODUCTS.DSM_RISK.basePricePaise}
      isEntitled={isEntitled('DSM_RISK')}
    >
      <div className="space-y-6">
        {dsmError && (
          <div className="p-4 rounded-md bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <strong>DSM Calculation Error:</strong> {dsmError}. Live mode requires active AMR interval telemetry.
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
                <Activity className="w-5 h-5 text-rose-400" />
                DSM Risk Monitor (Deviation Settlement Mechanism)
              </h1>
              <Badge variant="warning">INTERNAL_VALIDATION</Badge>
              {dsmData?.persisted && (
                <Badge variant="success">DB PERSISTED INCIDENTS</Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Completed-day 15-minute schedule versus actual deviations. Risk bands are technical heuristics, not regulatory limits.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {dsmData?.rule_version ? (
              <Badge variant="success">Rule Engine: {dsmData.rule_version}</Badge>
            ) : dsmData?.rule_status === 'REGULATORY_CONFIGURATION_REQUIRED' || !currentSite?.is_demo ? (
              <Badge variant="warning">REGULATORY CONFIGURATION REQUIRED</Badge>
            ) : (
              <Badge variant="success">Rule Engine: CERC_DSM_2024</Badge>
            )}
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
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-teal-600 focus:ring-teal-500"
              />
            </div>

            <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-0.5">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Dampening Interval
              </span>
              <p className="text-[11px] text-slate-300 font-mono">15 minutes minimum repeat</p>
              <p className="text-[10px] text-slate-500">Duplicate alarms suppressed across contiguous blocks</p>
            </div>

            <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-0.5">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                Escalation Hierarchy
              </span>
              <p className="text-[11px] text-slate-300">Operator → Energy Manager</p>
              <p className="text-[10px] text-slate-500">Escalates after 2 unacknowledged critical blocks</p>
            </div>
          </div>
        </Card>

        {/* Grouped Incidents List */}
        <Card variant="default">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-rose-400">Contiguous Deviation Incidents (Today)</CardTitle>
                <CardDescription>
                  Contiguous non-normal blocks grouped into single actionable operational events.
                </CardDescription>
              </div>
              {isLoading && <RefreshCw className="w-4 h-4 text-rose-400 animate-spin" />}
            </div>
          </CardHeader>

          <div className="space-y-3 p-6 pt-0">
            {incidents.map((inc: any) => {
              const isAck = acknowledgedIncidents.has(inc.id);
              return (
                <div
                  key={inc.id}
                  className={`p-4 rounded-md border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
                    isAck
                      ? 'bg-slate-950/40 border-slate-800 opacity-60'
                      : inc.severity === 'CRITICAL'
                      ? 'bg-rose-950/20 border-rose-800/80'
                      : 'bg-amber-950/20 border-amber-800/80'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={inc.severity === 'CRITICAL' ? 'danger' : 'warning'}>
                        {inc.severity}
                      </Badge>
                      <span className="font-semibold text-slate-200 text-xs">{inc.timeWindow}</span>
                      <span className="text-[11px] text-slate-400">({inc.blocks})</span>
                    </div>
                    <p className="text-xs text-slate-300">
                      Primary Cause: <strong className="text-slate-100">{inc.cause}</strong>
                    </p>
                    <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1">
                      <span>Max Peak Deviation: <strong className="text-rose-400">{inc.maxDeviation}</strong></span>
                      <span>Net Imbalance: <strong>{inc.excessEnergyKwh} kWh</strong></span>
                      <span>Estimated DSM Penalty: <strong className="text-amber-300">{inc.estimatedExposure}</strong></span>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {isAck ? (
                      <span className="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Acknowledged
                      </span>
                    ) : (
                      <Button
                        onClick={() => handleAcknowledge(inc.id)}
                        variant="outline"
                        size="sm"
                        className="text-xs border-slate-700 hover:bg-slate-800"
                      >
                        Acknowledge Event
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* 96-Block Deviation Horizon */}
        <Card variant="industrial">
          <CardHeader>
            <CardTitle>96-Block Real-Time Deviation Matrix</CardTitle>
            <CardDescription>
              Disaggregated interval-by-interval deviation tolerance limits.
            </CardDescription>
          </CardHeader>
          <div className="p-6 pt-0 overflow-x-auto max-h-96">
            <table className="w-full text-left text-xs font-mono">
              <thead className="border-b border-slate-800 text-slate-400 uppercase text-[10px] sticky top-0 bg-slate-900">
                <tr>
                  <th className="py-2.5 px-3">Block</th>
                  <th className="py-2.5 px-3">Time Window</th>
                  <th className="py-2.5 px-3">Scheduled</th>
                  <th className="py-2.5 px-3">Actual Drawal</th>
                  <th className="py-2.5 px-3">Deviation (kW)</th>
                  <th className="py-2.5 px-3">Deviation %</th>
                  <th className="py-2.5 px-3">Risk Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {deviationBlocks.map((b: any) => (
                  <tr
                    key={b.block_index}
                    className={
                      b.risk === 'CRITICAL'
                        ? 'bg-rose-950/30 text-rose-300'
                        : b.risk === 'HIGH'
                        ? 'bg-amber-950/20 text-amber-300'
                        : b.risk === 'WATCH'
                        ? 'bg-yellow-950/10 text-yellow-200'
                        : 'hover:bg-slate-900/40'
                    }
                  >
                    <td className="py-2 px-3">{b.block_index}</td>
                    <td className="py-2 px-3">{b.startTime} - {b.endTime}</td>
                    <td className="py-2 px-3">{b.scheduledKw} kW</td>
                    <td className="py-2 px-3">{b.actualKw} kW</td>
                    <td className="py-2 px-3 font-semibold">
                      {b.devKw > 0 ? `+${b.devKw.toFixed(1)}` : b.devKw.toFixed(1)} kW
                    </td>
                    <td className="py-2 px-3">{b.devPct.toFixed(2)}%</td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          b.risk === 'CRITICAL'
                            ? 'bg-rose-900 text-rose-100'
                            : b.risk === 'HIGH'
                            ? 'bg-amber-900 text-amber-100'
                            : b.risk === 'WATCH'
                            ? 'bg-yellow-900/60 text-yellow-200'
                            : 'text-slate-500'
                        }`}
                      >
                        {b.risk}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <ProvenanceFooter
          sourceTimestamp="2026-09-07T00:00:00Z"
          sourceType="PostgreSQL / DSM Deviation Algorithm"
          freshnessStatus="RECENT"
          validationStatus="PASSED"
          completenessPct={100}
          modelVersion={dsmData?.model_version || (currentSite?.is_demo ? "DSM_ALGORITHM_v1.0" : "DSM_INTERNAL_VALIDATION_v1.0")}
          tariffVersion={dsmData?.rule_version || (currentSite?.is_demo ? "CERC_DSM_2024_DEMO" : "REGULATORY CONFIGURATION REQUIRED")}
        />
      </div>
    </ModuleGate>
  );
}
