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
  BarChart3,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useSite } from '@/components/layout/SiteContext';
import { FreshnessBadge } from '@/components/shared/FreshnessBadge';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { formatPower, formatEnergy, formatPercentage } from '@/lib/units/energy';
import { PRODUCTS } from '@/lib/constants';

export default function DashboardPage() {
  const { currentSite, currentOrg, isEntitled } = useSite();

  if (!currentSite || !currentOrg) {
    return null;
  }

  const isMonitoringActive = currentSite.activation_status === 'ACTIVE';
  const isDemo = currentSite.is_demo === true;
  const evidenceUnavailable = 'No verified dashboard evidence is available for this live site.';

  const productStatus = (productId: keyof typeof PRODUCTS) =>
    isDemo ? 'DEMO / UNVERIFIED' : isEntitled(productId) ? 'ENTITLED' : 'UNSUBSCRIBED';

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-lg border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              {currentSite.name}
            </h1>
            <Badge data-testid="site-status" variant={isMonitoringActive ? 'success' : 'warning'}>
              {currentSite.activation_status}
            </Badge>
          </div>
          <p className="text-xs text-slate-400">
            {currentOrg.name} • {currentSite.state} ({currentSite.discom}) • Sanctioned Demand: {currentSite.contract_demand_value} {currentSite.contract_demand_unit}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isDemo ? (
            <>
              <Badge variant="demo" data-testid="dashboard-demo-label">DEMO / UNVERIFIED</Badge>
              <FreshnessBadge status="DEMO" />
            </>
          ) : (
            <>
              <Badge variant="outline" data-testid="dashboard-live-evidence-state">Evidence: NOT VERIFIED</Badge>
              <FreshnessBadge status="UNKNOWN" />
            </>
          )}
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
          <div className="text-2xl font-bold font-mono text-slate-100" data-testid="dashboard-demand-kpi">
            {isDemo && isMonitoringActive ? formatPower(2180.5) : 'UNAVAILABLE'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {isDemo && isMonitoringActive ? <>Synthetic peak window: <strong>Block 38 (09:15 - 09:30)</strong></> : evidenceUnavailable}
          </p>
        </Card>

        <Card variant="industrial">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Day-Ahead Average Price</span>
            <BarChart3 className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-300" data-testid="dashboard-price-kpi">
            {isDemo && isMonitoringActive ? '₹4,820/MWh' : 'UNAVAILABLE'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {isDemo && isMonitoringActive ? 'Synthetic demo price; not verified market evidence.' : 'Authoritative verified market evidence is required.'}
          </p>
        </Card>

        <Card variant="industrial">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>DSM Deviation Status</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-300" data-testid="dashboard-dsm-kpi">
            {isDemo && isMonitoringActive ? 'NORMAL (2.4%)' : 'UNAVAILABLE'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {isDemo && isMonitoringActive ? 'Synthetic technical status; no authoritative penalty claim.' : 'Validated schedule and actual-drawal evidence is required.'}
          </p>
        </Card>

        <Card variant="industrial">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Solar Self-Consumption</span>
            <Sun className="w-4 h-4 text-yellow-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-yellow-300" data-testid="dashboard-solar-kpi">
            {isDemo && isMonitoringActive ? formatPercentage(88.4) : 'UNAVAILABLE'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {isDemo && isMonitoringActive ? 'Synthetic demo generation and emissions estimate.' : 'Verified generation and emissions-factor evidence is required.'}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2" data-testid="dashboard-grid-brief">
          <div className="p-4 rounded-md bg-slate-950/60 border border-slate-800 space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Top High-Cost Window
            </span>
            <div className="text-lg font-bold text-rose-400 font-mono">
              {isDemo && isMonitoringActive ? '18:30 - 21:00 IST' : 'SUPPRESSED'}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {isDemo && isMonitoringActive
                ? <>Synthetic demo window. Projected demo DAM price exceeds <strong>₹7,800/MWh</strong>.</>
                : 'No operational recommendation is published without a validated forecast and authoritative price evidence.'}
            </p>
          </div>

          <div className="p-4 rounded-md bg-slate-950/60 border border-slate-800 space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Optimal Sourcing Window
            </span>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              {isDemo && isMonitoringActive ? '11:30 - 15:00 IST' : 'SUPPRESSED'}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {isDemo && isMonitoringActive
                ? <>Synthetic demo window. Projected demo price softens to <strong>₹3,200/MWh</strong>.</>
                : 'No sourcing or charging window is published without verified forecast, price, and asset evidence.'}
            </p>
          </div>

          <div className="p-4 rounded-md bg-slate-950/60 border border-slate-800 space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Estimated Avoided Landed Cost
            </span>
            <div className="text-lg font-bold text-teal-300 font-mono" data-testid="dashboard-cost-kpi">
              {isDemo && isMonitoringActive ? '₹48,250 / day' : 'UNAVAILABLE'}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {isDemo && isMonitoringActive
                ? 'Synthetic demo estimate; not a landed-cost or savings claim.'
                : 'Complete load, tariff, price, and operational evidence is required before an indicative monetary result can be shown.'}
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
              <Badge variant={isDemo || isEntitled('GRID_INTELLIGENCE') ? 'success' : 'outline'}>{productStatus('GRID_INTELLIGENCE')}</Badge>
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
              <Badge variant={isDemo ? 'demo' : isEntitled('OA_COMPLIANCE') ? 'success' : 'outline'}>{productStatus('OA_COMPLIANCE')}</Badge>
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
              <Badge variant={isDemo ? 'demo' : isEntitled('DSM_RISK') ? 'success' : 'outline'}>{productStatus('DSM_RISK')}</Badge>
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
              <Badge variant={isDemo ? 'demo' : isEntitled('BESS_ARBITRAGE') ? 'success' : 'outline'}>{productStatus('BESS_ARBITRAGE')}</Badge>
            </div>
            <h4 className="font-semibold text-slate-100 mb-1">{PRODUCTS.BESS_ARBITRAGE.name}</h4>
            <p className="text-xs text-slate-400 mb-4 line-clamp-2">{PRODUCTS.BESS_ARBITRAGE.description}</p>
            <Link
              href="/bess"
              data-testid="launch-bess-module"
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-700 bg-transparent px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-secondary"
            >
              View Opportunity Windows
            </Link>
          </Card>

          {/* Renewable Portfolio */}
          <Card className="hover:border-slate-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded bg-amber-950/80 border border-amber-800/60 text-amber-400">
                <Sun className="w-5 h-5" />
              </div>
              <Badge variant={isDemo ? 'demo' : isEntitled('RENEWABLE_PORTFOLIO') ? 'success' : 'outline'}>{productStatus('RENEWABLE_PORTFOLIO')}</Badge>
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
      {isDemo ? (
        <div data-testid="dashboard-demo-provenance">
          <ProvenanceFooter
            sourceType="Synthetic demo dataset"
            modelVersion="GRID_FORECAST_HEURISTIC_v1.0_DEMO"
            modelGenerationTime="2026-09-06T18:00:00Z"
            tariffVersion="MSEDCL_HT1_2024_DEMO"
          />
        </div>
      ) : (
        <div data-testid="dashboard-live-provenance" className="mt-8 pt-4 border-t border-slate-800 text-xs text-slate-400">
          <strong className="text-slate-300">Dashboard evidence:</strong> UNAVAILABLE / NOT VERIFIED. Open each entitled module to view its independently validated evidence and suppression status.
        </div>
      )}
    </div>
  );
}
