'use client';

import React from 'react';
import { FileText, Download, Printer, ShieldCheck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';

export default function ReportsPage() {
  const { currentSite } = useSite();

  const reports = [
    {
      id: 'rep-01',
      title: 'Daily Grid Intelligence Brief - 2026-09-07',
      type: 'DAILY_BRIEF',
      period: '2026-09-07',
      modelVersion: 'GRID_INTEL_v1.0',
      tariffVersion: 'MSEDCL_HT1_2024_DEMO',
      quality: 'PASSED',
      generatedAt: 'Today at 06:00 IST',
    },
    {
      id: 'rep-02',
      title: 'Weekly Sourcing & Landed Cost Optimization Summary',
      type: 'WEEKLY_SUMMARY',
      period: '2026-09-01 to 2026-09-07',
      modelVersion: 'GRID_OPTIMIZER_v1.0',
      tariffVersion: 'MSEDCL_HT1_2024_DEMO',
      quality: 'PASSED',
      generatedAt: 'Yesterday at 23:59 IST',
    },
    {
      id: 'rep-03',
      title: 'Monthly DSM Risk & Deviation Settlement Audit',
      type: 'MONTHLY_PERFORMANCE',
      period: 'August 2026',
      modelVersion: 'CERC_DSM_HEURISTIC_v1.0',
      tariffVersion: 'CERC_DSM_2024_DEMO',
      quality: 'PASSED',
      generatedAt: '2026-09-01',
    },
    {
      id: 'rep-04',
      title: 'Monthly Scope 2 Avoided Carbon Emissions Statement',
      type: 'ESG_CARBON',
      period: 'August 2026',
      modelVersion: 'CEA_CO2_EMISSION_LEDGER_v19',
      tariffVersion: 'CEA_BASELINE_DB_v19',
      quality: 'PASSED',
      generatedAt: '2026-09-01',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-teal-400" />
            Executive Reports & Provenance Archives
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Standardized digital intelligence outputs with complete calculation snapshot provenance.
          </p>
        </div>
      </div>

      {/* Reports List */}
      <div className="space-y-3">
        {reports.map((rep) => (
          <Card key={rep.id} variant="default" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <Badge variant="outline">{rep.type.replace(/_/g, ' ')}</Badge>
                <h4 className="text-xs font-semibold text-slate-200">{rep.title}</h4>
              </div>
              <p className="text-[11px] text-slate-400">
                Operating Period: <strong className="text-slate-300">{rep.period}</strong> • Model: {rep.modelVersion} • Tariff: {rep.tariffVersion}
              </p>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>Quality Gate: <strong className="text-emerald-400">{rep.quality}</strong></span>
                <span>• Generated: {rep.generatedAt}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => window.print()} variant="outline" size="sm" className="text-xs gap-1.5">
                <Printer className="w-3.5 h-3.5" />
                Print Layout
              </Button>
              <Button
                onClick={() => alert(`Downloading CSV snapshot for ${rep.title}`)}
                variant="primary"
                size="sm"
                className="text-xs gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
