'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Check,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';
import { parseAndValidateCsv, generateCsvTemplate, type ParseResult } from '@/features/ingestion/csvParser';
import { evaluateGridReadiness } from '@/features/onboarding/readiness';
import { INDIAN_STATES, VOLTAGE_CATEGORIES, LOAD_CLASSES } from '@/lib/constants';

export default function SettingsPage() {
  const { currentSite, refreshSites } = useSite();
  const [activeSubTab, setActiveSubTab] = useState<'upload' | 'site' | 'readiness'>('upload');

  // CSV Upload State
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  // Commit State
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitFeedback, setCommitFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Site Parameters Form State
  const [siteName, setSiteName] = useState(currentSite.name);
  const [siteState, setSiteState] = useState(currentSite.state);
  const [siteDiscom, setSiteDiscom] = useState(currentSite.discom);
  const [siteVoltage, setSiteVoltage] = useState(currentSite.voltage_category);
  const [siteContractDemand, setSiteContractDemand] = useState(String(currentSite.contract_demand_value));
  const [siteMeteringPoint, setSiteMeteringPoint] = useState(currentSite.metering_point);
  const [siteLoadClass, setSiteLoadClass] = useState(currentSite.load_class);
  const [isSavingSite, setIsSavingSite] = useState(false);
  const [siteFeedback, setSiteFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setSiteName(currentSite.name);
    setSiteState(currentSite.state);
    setSiteDiscom(currentSite.discom);
    setSiteVoltage(currentSite.voltage_category);
    setSiteContractDemand(String(currentSite.contract_demand_value));
    setSiteMeteringPoint(currentSite.metering_point);
    setSiteLoadClass(currentSite.load_class);
  }, [currentSite]);

  // Readiness evaluation
  const readiness = evaluateGridReadiness({
    state: currentSite.state,
    discom: currentSite.discom,
    contractDemandValue: currentSite.contract_demand_value,
    voltageCategory: currentSite.voltage_category,
    hasAlertRecipient: true,
    hasHistoricalIntervals: true,
    intervalDaysCount: 30,
    hasSolarAsset: true,
    hasBessAsset: true,
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setCommitFeedback(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setFileContent(content);
      const result = parseAndValidateCsv(content, currentSite.id);
      setParseResult(result);
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const template = generateCsvTemplate('2026-09-08');
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'aetheon_96block_amr_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCommitToDatabase = async () => {
    if (!parseResult || !parseResult.parsedData.length) return;
    setIsCommitting(true);
    setCommitFeedback(null);

    try {
      const res = await fetch('/api/ingestion/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: currentSite.id,
          filename: fileName,
          checksum: parseResult.checksum,
          parsedData: parseResult.parsedData,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to commit data');
      }

      setCommitFeedback({
        type: 'success',
        message: `Successfully committed ${data.totalBlocks || parseResult.acceptedRows} interval blocks to site database (Run ID: ${data.ingestionRunId}).`,
      });
      await refreshSites();
    } catch (err) {
      setCommitFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to commit data to database.',
      });
    } finally {
      setIsCommitting(false);
    }
  };

  const handleSaveSiteParameters = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSite(true);
    setSiteFeedback(null);

    try {
      const res = await fetch(`/api/sites/${currentSite.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: siteName,
          state: siteState,
          discom: siteDiscom,
          voltage_category: siteVoltage,
          contract_demand_value: Number(siteContractDemand),
          metering_point: siteMeteringPoint,
          load_class: siteLoadClass,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to update site configuration');
      }

      setSiteFeedback({
        type: 'success',
        message: 'Site configuration persisted successfully to PostgreSQL database.',
      });
      await refreshSites();
    } catch (err) {
      setSiteFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to persist site configuration.',
      });
    } finally {
      setIsSavingSite(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Settings className="w-5 h-5 text-teal-400" />
            Settings, Site Operations & Data Gateway
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage site electrical boundaries, ingest 15-minute AMR meter data, and track module data readiness.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={activeSubTab === 'upload' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab('upload')}
            className="text-xs gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            Data Ingestion (CSV)
          </Button>
          <Button
            variant={activeSubTab === 'site' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab('site')}
            className="text-xs gap-1.5"
          >
            Site Parameters
          </Button>
          <Button
            variant={activeSubTab === 'readiness' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab('readiness')}
            className="text-xs gap-1.5"
          >
            Data Readiness ({readiness.readinessPct}%)
          </Button>
        </div>
      </div>

      {/* Subtab 1: CSV Ingestion Gateway */}
      {activeSubTab === 'upload' && (
        <div className="space-y-6">
          <Card variant="industrial">
            <CardHeader>
              <div>
                <CardTitle className="text-teal-400">
                  <FileSpreadsheet className="w-4 h-4" />
                  15-Minute AMR Interval Data Ingestion Gateway
                </CardTitle>
                <CardDescription>
                  Upload 96-block daily load or smart meter readings. Enforces 15-minute contiguity and SHA-256 duplicate prevention.
                </CardDescription>
              </div>
              <Button onClick={handleDownloadTemplate} variant="outline" size="sm" className="text-xs gap-1.5">
                <Download className="w-3.5 h-3.5" />
                Download CSV Template
              </Button>
            </CardHeader>

            {/* Dropzone Area */}
            <div className="p-8 border-2 border-dashed border-slate-700 rounded-lg bg-slate-950/60 text-center space-y-3">
              <Upload className="w-10 h-10 text-teal-400 mx-auto" />
              <div>
                <label className="cursor-pointer">
                  <span className="text-sm font-semibold text-teal-400 hover:text-teal-300 underline">
                    Choose CSV file
                  </span>
                  <span className="text-xs text-slate-400"> or drag and drop</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                <p className="text-[11px] text-slate-500 mt-1">
                  Supported format: 96-block 15-minute AMR CSV (Max 25MB).
                </p>
              </div>
            </div>

            {/* Ingestion Validation Results */}
            {parseResult && (
              <div className="mt-6 space-y-4 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Validation Outcome for {fileName}
                  </span>
                  <span className="text-xs font-mono text-slate-500">
                    Checksum SHA-256: {parseResult.checksum.substring(0, 16)}...
                  </span>
                </div>

                {parseResult.isDuplicate ? (
                  <div className="p-4 rounded-md bg-rose-950/30 border border-rose-800 text-xs text-rose-200">
                    <strong>Duplicate File Rejected:</strong> An identical file with checksum {parseResult.checksum.substring(0, 12)} has already been processed for this site.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 rounded bg-slate-950 border border-slate-800">
                        <span className="text-xs text-slate-400 block mb-1">Total Rows</span>
                        <div className="text-lg font-bold font-mono text-slate-200">{parseResult.totalRows}</div>
                      </div>
                      <div className="p-3 rounded bg-emerald-950/30 border border-emerald-800/60">
                        <span className="text-xs text-emerald-300 block mb-1">Accepted Valid Blocks</span>
                        <div className="text-lg font-bold font-mono text-emerald-400">{parseResult.acceptedRows}</div>
                      </div>
                      <div className="p-3 rounded bg-rose-950/30 border border-rose-800/60">
                        <span className="text-xs text-rose-300 block mb-1">Rejected Rows</span>
                        <div className="text-lg font-bold font-mono text-rose-400">{parseResult.rejectedRows}</div>
                      </div>
                    </div>

                    {parseResult.errors.length > 0 && (
                      <div className="p-4 rounded-md bg-rose-950/20 border border-rose-900 text-xs text-rose-200 space-y-2">
                        <strong className="block text-rose-300">Row-Level Ingestion Errors:</strong>
                        <ul className="list-disc pl-4 space-y-1 font-mono text-[11px]">
                          {parseResult.errors.slice(0, 5).map((err, i) => (
                            <li key={i}>
                              Row {err.rowNumber} [{err.column || 'GENERAL'}]: {err.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {commitFeedback && (
                      <div
                        className={`p-3 rounded-md text-xs flex items-center gap-2 ${
                          commitFeedback.type === 'success'
                            ? 'bg-emerald-950/50 border border-emerald-800 text-emerald-200'
                            : 'bg-rose-950/50 border border-rose-800 text-rose-200'
                        }`}
                      >
                        {commitFeedback.type === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        )}
                        <span>{commitFeedback.message}</span>
                      </div>
                    )}

                    {parseResult.acceptedRows === 96 && (
                      <div className="p-3 rounded-md bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-200 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          96/96 blocks validated successfully. Contiguity verified.
                        </span>
                        <Button
                          onClick={handleCommitToDatabase}
                          variant="primary"
                          size="sm"
                          disabled={isCommitting}
                          className="text-xs gap-1.5"
                        >
                          {isCommitting ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Committing...
                            </>
                          ) : (
                            'Commit to Database'
                          )}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Subtab 2: Site Operational Parameters Form */}
      {activeSubTab === 'site' && (
        <Card variant="default">
          <CardHeader>
            <div>
              <CardTitle className="text-slate-100">Site Electrical Configuration</CardTitle>
              <CardDescription>
                Parameters defining the utility metering and scheduling boundary for {currentSite.name}.
              </CardDescription>
            </div>
          </CardHeader>

          {siteFeedback && (
            <div
              className={`p-3 mx-6 rounded-md text-xs flex items-center gap-2 ${
                siteFeedback.type === 'success'
                  ? 'bg-emerald-950/50 border border-emerald-800 text-emerald-200'
                  : 'bg-rose-950/50 border border-rose-800 text-rose-200'
              }`}
            >
              {siteFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{siteFeedback.message}</span>
            </div>
          )}

          <form onSubmit={handleSaveSiteParameters} className="space-y-4 p-6 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Site Name"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
              />
              <Select
                label="State Jurisdiction"
                options={INDIAN_STATES.map((s) => ({ value: s.name, label: s.name }))}
                value={siteState}
                onChange={(e) => setSiteState(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Operating DISCOM"
                value={siteDiscom}
                onChange={(e) => setSiteDiscom(e.target.value)}
              />
              <Select
                label="Voltage Category"
                options={VOLTAGE_CATEGORIES.map((v) => ({ value: v, label: v }))}
                value={siteVoltage}
                onChange={(e) => setSiteVoltage(e.target.value)}
              />
              <Input
                label="Sanctioned Contract Demand (kVA)"
                type="number"
                value={siteContractDemand}
                onChange={(e) => setSiteContractDemand(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Metering Point Reference"
                value={siteMeteringPoint}
                onChange={(e) => setSiteMeteringPoint(e.target.value)}
              />
              <Select
                label="Load Class"
                options={LOAD_CLASSES.map((c) => ({ value: c, label: c }))}
                value={siteLoadClass}
                onChange={(e) => setSiteLoadClass(e.target.value)}
              />
            </div>

            <div className="pt-2 flex justify-end">
              <Button type="submit" variant="primary" size="sm" disabled={isSavingSite}>
                {isSavingSite ? 'Saving...' : 'Save Site Parameters'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Subtab 3: Data Readiness Checklist */}
      {activeSubTab === 'readiness' && (
        <Card variant="default">
          <CardHeader>
            <div>
              <CardTitle className="text-teal-400">Module Data Readiness Checklist</CardTitle>
              <CardDescription>
                Prerequisites required before operational monitoring can transition to ACTIVE.
              </CardDescription>
            </div>
            <Badge variant={readiness.isReadyForMonitoring ? 'success' : 'warning'}>
              {readiness.readinessPct}% Ready
            </Badge>
          </CardHeader>

          <div className="space-y-3 p-6 pt-0">
            {readiness.items.map((item) => (
              <div
                key={item.key}
                className="p-3.5 rounded-md bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={item.category === 'REQUIRED' ? 'danger' : item.category === 'RECOMMENDED' ? 'warning' : 'outline'}>
                      {item.category}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-200">{item.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Current value: <strong className="text-slate-300">{item.currentValue}</strong>
                  </p>
                  {!item.isSatisfied && (
                    <p className="text-[11px] text-amber-400">
                      Remediation: {item.remediationAction}
                    </p>
                  )}
                </div>

                <div>
                  {item.isSatisfied ? (
                    <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                      <Check className="w-4 h-4" />
                      Satisfied
                    </span>
                  ) : (
                    <Button
                      onClick={() => setActiveSubTab(item.key.includes('load') ? 'upload' : 'site')}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                    >
                      Configure
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
