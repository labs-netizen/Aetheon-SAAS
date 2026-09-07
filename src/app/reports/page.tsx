'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Download, Printer, ShieldCheck, Plus, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';

interface ReportRecord {
  id: string;
  module: string;
  report_type: string;
  period_start: string;
  period_end: string;
  title: string;
  summary: Record<string, any>;
  quality_status: string;
  model_version: string;
  tariff_version: string;
  generation_time: string;
  created_at: string;
  download_url?: string;
}

export default function ReportsPage() {
  const { currentSite } = useSite();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedType, setSelectedType] = useState('GRID_DAILY_BRIEF');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchReports = useCallback(async () => {
    if (!currentSite?.id) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/reports?siteId=${currentSite.id}`);
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentSite?.id]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleGenerateReport = async () => {
    if (!currentSite?.id) return;
    setIsGenerating(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: currentSite.id,
          reportType: selectedType,
          periodStart: new Date().toISOString().split('T')[0],
          periodEnd: new Date().toISOString().split('T')[0],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to generate report');
      }

      setFeedback({
        type: 'success',
        message: `Successfully generated and persisted ${selectedType.replace(/_/g, ' ')}!`,
      });
      await fetchReports();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Report generation failed',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = (reportId: string, filename: string) => {
    const downloadUrl = `/api/reports/${reportId}/download`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
            Persisted regulatory intelligence outputs with complete calculation snapshot provenance.
          </p>
        </div>

        {/* Generate Controls */}
        <div className="flex items-center gap-3">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            disabled={isGenerating}
            className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-teal-500"
          >
            <option value="GRID_DAILY_BRIEF">Grid Daily Brief</option>
            <option value="GRID_MONTHLY_REPORT">Grid Monthly Report</option>
            <option value="DSM_MONTHLY_REVIEW">DSM Monthly Review</option>
            <option value="BESS_PERFORMANCE_REPORT">BESS Advisory Performance</option>
            <option value="RENEWABLES_RECONCILIATION">Renewables Reconciliation</option>
            <option value="COMPLIANCE_AUDIT">Open Access Compliance Audit</option>
          </select>
          <Button
            onClick={handleGenerateReport}
            disabled={isGenerating || !currentSite?.id}
            variant="primary"
            size="sm"
            className="text-xs gap-1.5"
          >
            {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Generate Snapshot
          </Button>
        </div>
      </div>

      {feedback && (
        <div className={`p-3 rounded text-xs flex items-center gap-2 border ${feedback.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-rose-950/40 border-rose-800/60 text-rose-300'}`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Reports List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="py-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
            Loading persisted report archives...
          </div>
        ) : reports.length === 0 ? (
          <Card className="py-10 text-center text-xs text-slate-400">
            No persisted reports found for site {currentSite?.name || 'current site'}. Select a report type and click &quot;Generate Snapshot&quot; to create a persisted audit record.
          </Card>
        ) : (
          reports.map((rep) => (
            <Card key={rep.id} variant="default" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <Badge variant="outline">{rep.report_type.replace(/_/g, ' ')}</Badge>
                  <h4 className="text-xs font-semibold text-slate-200">{rep.title}</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Operating Period: <strong className="text-slate-300">{rep.period_start} to {rep.period_end}</strong> • Module: {rep.module} • Model: {rep.model_version} • Tariff: {rep.tariff_version || 'MERC_GEOA_2024'}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  <span>Quality Gate: <strong className="text-emerald-400">{rep.quality_status}</strong></span>
                  <span>• Generated: {new Date(rep.generation_time || rep.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={() => window.print()} variant="outline" size="sm" className="text-xs gap-1.5">
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </Button>
                <Button
                  onClick={() => handleDownload(rep.id, rep.title)}
                  variant="primary"
                  size="sm"
                  className="text-xs gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download CSV
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
