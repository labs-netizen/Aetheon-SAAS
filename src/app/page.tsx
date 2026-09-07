'use client';

import React from 'react';
import Link from 'next/link';
import {
  Zap,
  ShieldCheck,
  Activity,
  BatteryCharging,
  Sun,
  AlertTriangle,
  ArrowUpRight,
  Lock,
  TrendingDown,
  BarChart3,
  Calendar,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useSite } from '@/components/layout/SiteContext';
import { DataQualityBadge } from '@/components/shared/DataQualityBadge';
import { FreshnessBadge } from '@/components/shared/FreshnessBadge';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { formatPower, formatEnergy, formatPercentage } from '@/lib/units/energy';
import { PRODUCTS } from '@/lib/constants';

export default function DashboardPage() {
  const { currentSite, currentOrg } = useSite();

  if (!currentSite || !currentOrg) {
    return null;
  }

  const isMonitoringActive = currentSite.activation_status === 'ACTIVE';

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-lg border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              {currentSite.name}
            </h1>
            <Badge variant={isMonitoringActive ? 'success' : 'warning'}>
              {currentSite.activation_status}
            </Badge>
          </div>
          <p className="text-xs text-slate-400">
            {currentOrg.name} • {currentSite.state} ({currentSite.discom}) • Sanctioned Demand: {currentSite.contract_demand_value} {currentSite.contract_demand_unit}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DataQualityBadge status={isMonitoringActive ? 'PASSED' : 'WARNING'} />
          <FreshnessBadge status={isMonitoringActive ? 'RECENT' : 'DELAYED'} />
          <Link href="/settings">
            <Button variant="outline" size="sm" className="text-xs">
              Upload Interval Data
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="industrial">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Forecast Peak Demand (Tomorrow)</span>
            <Zap className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-100">
            {isMonitoringActive ? formatPower(2180.5) : '-- kW'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Peak window: <strong>Block 38 (09:15 - 09:30)</strong>
          </p>
        </Card>

        <Card variant="industrial">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Day-Ahead Average Price</span>
            <BarChart3 className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-300">
            {isMonitoringActive ? '₹4,820/MWh' : '--'}
          </div>
          <p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-1">
            <TrendingDown className="w-3 h-3" />
            4.2% lower than yesterday&apos;s clearing price
          </p>
        </Card>

        <Card variant="industrial">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>DSM Deviation Status</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-300">
            {isMonitoringActive ? 'NORMAL (2.4%)' : 'AWAITING'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Zero active penalty exposure today
          </p>
        </Card>

        <Card variant="industrial">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Solar Self-Consumption</span>
            <Sun className="w-4 h-4 text-yellow-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-yellow-300">
            {isMonitoringActive ? formatPercentage(88.4) : '--%'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Avoided 3.42 tCO₂e emissions today
          </p>
        </Card>
      </div>

      {/* Primary Section: Daily Grid Intelligence Brief Preview */}
      <Card variant="default">
        <CardHeader>
          <div>
            <CardTitle className="text-teal-400">
              <Zap className="w-4 h-4" />
              Daily Grid Intelligence Brief (Tomorrow Outlook)
            </CardTitle>
            <CardDescription>
              Day-ahead 96-block procurement recommendations & peak tariff mitigation.
            </CardDescription>
          </div>
          <Link href="/grid-intelligence">
            <Button variant="primary" size="sm" className="gap-1 text-xs">
              Open Full Forecast & Cost Explorer
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </CardHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
          <div className="p-4 rounded-md bg-slate-950/60 border border-slate-800 space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Top High-Cost Window
            </span>
            <div className="text-lg font-bold text-rose-400 font-mono">
              18:30 - 21:00 IST
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Evening peak tariff window. Projected DAM clearing price exceeds <strong>₹7,800/MWh</strong>.
              Recommended load curtailment or BESS discharge.
            </p>
          </div>

          <div className="p-4 rounded-md bg-slate-950/60 border border-slate-800 space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Optimal Sourcing Window
            </span>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              11:30 - 15:00 IST
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Solar peak generation surplus. Projected price softens to <strong>₹3,200/MWh</strong>.
              Recommended window for thermal/battery energy storage charging.
            </p>
          </div>

          <div className="p-4 rounded-md bg-slate-950/60 border border-slate-800 space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Estimated Avoided Landed Cost
            </span>
            <div className="text-lg font-bold text-teal-300 font-mono">
              ₹48,250 / day
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Achieved via rooftop solar self-consumption and peak shaving against baseline MSEDCL HT-1 ToD tariff.
            </p>
          </div>
        </div>
      </Card>

      {/* Modules Grid: Active vs Locked */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
          Platform Product Suite
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Grid Intelligence */}
          <Card className="hover:border-teal-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded bg-teal-950/80 border border-teal-800/60 text-teal-400">
                <Zap className="w-5 h-5" />
              </div>
              <Badge variant="success">ACTIVE</Badge>
            </div>
            <h4 className="font-semibold text-slate-100 mb-1">{PRODUCTS.GRID_INTELLIGENCE.name}</h4>
            <p className="text-xs text-slate-400 mb-4 line-clamp-2">{PRODUCTS.GRID_INTELLIGENCE.description}</p>
            <Link href="/grid-intelligence">
              <Button variant="outline" size="sm" className="w-full text-xs">
                Launch Module
              </Button>
            </Link>
          </Card>

          {/* Open Access */}
          <Card className="hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded bg-sky-950/80 border border-sky-800/60 text-sky-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <Badge variant="demo">DEMO / UNVERIFIED</Badge>
            </div>
            <h4 className="font-semibold text-slate-100 mb-1">{PRODUCTS.OA_COMPLIANCE.name}</h4>
            <p className="text-xs text-slate-400 mb-4 line-clamp-2">{PRODUCTS.OA_COMPLIANCE.description}</p>
            <Link href="/compliance">
              <Button variant="outline" size="sm" className="w-full text-xs">
                View Compliance Board
              </Button>
            </Link>
          </Card>

          {/* DSM Risk Monitor */}
          <Card className="hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded bg-rose-950/80 border border-rose-800/60 text-rose-400">
                <Activity className="w-5 h-5" />
              </div>
              <Badge variant="demo">DEMO / UNVERIFIED</Badge>
            </div>
            <h4 className="font-semibold text-slate-100 mb-1">{PRODUCTS.DSM_RISK.name}</h4>
            <p className="text-xs text-slate-400 mb-4 line-clamp-2">{PRODUCTS.DSM_RISK.description}</p>
            <Link href="/dsm">
              <Button variant="outline" size="sm" className="w-full text-xs">
                Monitor 96 Blocks
              </Button>
            </Link>
          </Card>

          {/* BESS Arbitrage */}
          <Card className="hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded bg-purple-950/80 border border-purple-800/60 text-purple-400">
                <BatteryCharging className="w-5 h-5" />
              </div>
              <Badge variant="demo">DEMO / UNVERIFIED</Badge>
            </div>
            <h4 className="font-semibold text-slate-100 mb-1">{PRODUCTS.BESS_ARBITRAGE.name}</h4>
            <p className="text-xs text-slate-400 mb-4 line-clamp-2">{PRODUCTS.BESS_ARBITRAGE.description}</p>
            <Link href="/bess">
              <Button variant="outline" size="sm" className="w-full text-xs">
                View Opportunity Windows
              </Button>
            </Link>
          </Card>

          {/* Renewable Portfolio */}
          <Card className="hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded bg-amber-950/80 border border-amber-800/60 text-amber-400">
                <Sun className="w-5 h-5" />
              </div>
              <Badge variant="demo">DEMO / UNVERIFIED</Badge>
            </div>
            <h4 className="font-semibold text-slate-100 mb-1">{PRODUCTS.RENEWABLE_PORTFOLIO.name}</h4>
            <p className="text-xs text-slate-400 mb-4 line-clamp-2">{PRODUCTS.RENEWABLE_PORTFOLIO.description}</p>
            <Link href="/renewables">
              <Button variant="outline" size="sm" className="w-full text-xs">
                Reconcile Generation
              </Button>
            </Link>
          </Card>
        </div>
      </div>

      {/* Provenance and Disclaimer Footer */}
      <ProvenanceFooter
        modelVersion="GRID_FORECAST_HEURISTIC_v1.0"
        modelGenerationTime="2026-09-06T18:00:00Z"
        tariffVersion="MSEDCL_HT1_2024_DEMO"
      />
    </div>
  );
}
