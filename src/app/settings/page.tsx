'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Settings,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Check,
  RefreshCw,
  CreditCard,
  ShieldCheck,
  Calendar,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';
import { generateCsvTemplate, type ParseResult } from '@/features/ingestion/csvParser';
import { prepareCsvImport } from '@/features/ingestion/normalizer';
import type { CsvSchemaMapping, SchemaDetectionResult } from '@/features/ingestion/mappingTypes';
import { evaluateGridReadiness } from '@/features/onboarding/readiness';
import { INDIAN_STATES, VOLTAGE_CATEGORIES, LOAD_CLASSES } from '@/lib/constants';

function SettingsContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') === 'billing' ? 'billing' : 'upload';

  const { currentSite, activeRole, refreshSites } = useSite();
  const [activeSubTab, setActiveSubTab] = useState<'upload' | 'site' | 'readiness' | 'billing'>(initialTab);

  // CSV Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [schemaDetection, setSchemaDetection] = useState<SchemaDetectionResult | null>(null);
  const [schemaMapping, setSchemaMapping] = useState<CsvSchemaMapping>({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [mappingErrors, setMappingErrors] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<Array<{ operating_date: string; block_index: number; load_kw: number }>>([]);

  // Commit State
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitFeedback, setCommitFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Site Parameters Form State
  const [siteName, setSiteName] = useState(currentSite?.name || '');
  const [siteState, setSiteState] = useState(currentSite?.state || 'Maharashtra');
  const [siteDiscom, setSiteDiscom] = useState(currentSite?.discom || 'MSEDCL');
  const [siteVoltage, setSiteVoltage] = useState(currentSite?.voltage_category || '33kV');
  const [siteContractDemand, setSiteContractDemand] = useState(String(currentSite?.contract_demand_value || 1000));
  const [siteMeteringPoint, setSiteMeteringPoint] = useState(currentSite?.metering_point || 'Main Substation');
  const [siteLoadClass, setSiteLoadClass] = useState(currentSite?.load_class || 'Continuous Process Industrial');
  const [isSavingSite, setIsSavingSite] = useState(false);
  const [siteFeedback, setSiteFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Billing State
  interface BillingData {
    billingMode: 'MOCK_DEVELOPMENT' | 'RAZORPAY_TEST' | 'RAZORPAY_LIVE';
    subscriptions: any[];
    entitlements: any[];
    invoices: any[];
    userRole: string;
  }
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [isLoadingBilling, setIsLoadingBilling] = useState(false);
  const [billingActionLoading, setBillingActionLoading] = useState(false);
  const [billingFeedback, setBillingFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (searchParams.get('tab') === 'billing') {
      setActiveSubTab('billing');
    }
  }, [searchParams]);

  useEffect(() => {
    if (currentSite) {
      setSiteName(currentSite.name);
      setSiteState(currentSite.state);
      setSiteDiscom(currentSite.discom);
      setSiteVoltage(currentSite.voltage_category);
      setSiteContractDemand(String(currentSite.contract_demand_value));
      setSiteMeteringPoint(currentSite.metering_point);
      setSiteLoadClass(currentSite.load_class);
    }
  }, [currentSite]);

  const loadBillingData = async () => {
    setIsLoadingBilling(true);
    setBillingFeedback(null);
    try {
      const res = await fetch('/api/billing');
      if (res.ok) {
        const data = await res.json();
        setBillingData(data);
      }
    } catch {
      // Ignored
    } finally {
      setIsLoadingBilling(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'billing') {
      loadBillingData();
    }
  }, [activeSubTab]);

  const handleCancelSubscription = async (subscriptionId: string) => {
    if (activeRole !== 'ORGANISATION_ADMIN') {
      setBillingFeedback({ type: 'error', message: 'Only ORGANISATION_ADMIN can cancel subscriptions.' });
      return;
    }

    setBillingActionLoading(true);
    setBillingFeedback(null);
    try {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel subscription');
      }
      setBillingFeedback({ type: 'success', message: data.message || 'Subscription cancelled at period end.' });
      await loadBillingData();
    } catch (err) {
      setBillingFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error cancelling subscription',
      });
    } finally {
      setBillingActionLoading(false);
    }
  };

  if (!currentSite) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p>No site selected or available. Please configure an industrial facility first.</p>
      </div>
    );
  }

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

    setSelectedFile(file);
    setFileName(file.name);
    setCommitFeedback(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setFileContent(content);
      const prepared = prepareCsvImport(content, currentSite.id);
      setSchemaDetection(prepared.detection);
      setSchemaMapping(prepared.mapping);
      setMappingConfirmed(!prepared.detection.requiresConfirmation);
      setMappingErrors(prepared.normalizationErrors.map((error) => error.reason));
      setSampleRows(prepared.sampleRows);
      setParseResult(prepared.validation);
    };
    reader.readAsText(file);
  };

  const applySchemaMapping = (patch: Partial<CsvSchemaMapping>, confirmed = true) => {
    const next = { ...schemaMapping, ...patch };
    const prepared = prepareCsvImport(fileContent, currentSite.id, next, confirmed);
    setSchemaMapping(prepared.mapping);
    setSchemaDetection(prepared.detection);
    setMappingConfirmed(confirmed);
    setMappingErrors(prepared.normalizationErrors.map((error) => error.reason));
    setSampleRows(prepared.sampleRows);
    setParseResult(prepared.validation);
    setCommitFeedback(null);
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
    if (!currentSite?.id) return;
    setIsCommitting(true);
    setCommitFeedback(null);

    try {
      const formData = new FormData();
      formData.append('siteId', currentSite.id);
      if (selectedFile) {
        formData.append('file', selectedFile);
        formData.append('filename', selectedFile.name);
      } else if (fileContent) {
        const blob = new Blob([fileContent], { type: 'text/csv' });
        formData.append('file', blob, fileName || 'amr_data.csv');
        formData.append('filename', fileName || 'amr_data.csv');
      } else {
        throw new Error('No CSV file selected for upload.');
      }
      formData.append('mapping', JSON.stringify(schemaMapping));
      formData.append('mappingConfirmed', String(mappingConfirmed));

      const res = await fetch('/api/ingestion/commit', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to commit data');
      }

      setCommitFeedback({
        type: 'success',
        message: `Successfully committed ${data.validBlocks || data.totalBlocks} interval blocks across ${data.validDays || 1} operating day(s) (Run ID: ${data.run_id}).`,
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
            Manage site electrical boundaries, ingest 15-minute AMR meter data, and track subscription entitlements.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
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
          <Button
            variant={activeSubTab === 'billing' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab('billing')}
            className="text-xs gap-1.5"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Billing & Subscriptions
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
                  Upload one or more complete 96-block operating days. Enforces per-day 15-minute contiguity and SHA-256 duplicate prevention.
                </CardDescription>
              </div>
              <Button onClick={handleDownloadTemplate} variant="outline" size="sm" className="text-xs gap-1.5">
                <Download className="w-3.5 h-3.5" />
                Download CSV Template
              </Button>
            </CardHeader>

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
                  Supported format: one or more complete 96-block 15-minute AMR days in a CSV (Max 25MB).
                </p>
              </div>
            </div>

            {schemaDetection && (
              <div className="mt-6 space-y-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4" data-testid="csv-mapping-preview">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">Column mapping preview</h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Delimiter: {schemaDetection.delimiter === '\t' ? 'tab' : schemaDetection.delimiter} · Date: {schemaMapping.dateFormat || 'confirmation required'} · Interval: {schemaDetection.detectedIntervalMinutes ? `${schemaDetection.detectedIntervalMinutes} minutes` : 'not detected'} · Unit: {schemaMapping.measurementUnit || 'confirmation required'}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {([
                    ['Date', 'dateColumn'], ['Timestamp', 'timestampColumn'], ['Time', 'timeColumn'],
                    ['Block', 'blockColumn'], ['Load / energy', 'measurementColumn'], ['Unit column', 'unitColumn'],
                  ] as const).map(([label, key]) => (
                    <label key={key} className="text-[11px] text-slate-400">
                      {label}
                      <select
                        data-testid={`csv-mapping-${key}`}
                        value={schemaMapping[key] || ''}
                        onChange={(event) => applySchemaMapping({ [key]: event.target.value || undefined })}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200"
                      >
                        <option value="">Not mapped</option>
                        {schemaDetection.columns.map((column) => <option key={column} value={column}>{column}</option>)}
                      </select>
                    </label>
                  ))}
                  <label className="text-[11px] text-slate-400">
                    Date format
                    <select
                      value={schemaMapping.dateFormat || ''}
                      onChange={(event) => applySchemaMapping({ dateFormat: (event.target.value || undefined) as CsvSchemaMapping['dateFormat'] })}
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200"
                    >
                      <option value="">Not confirmed</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                      <option value="ISO-8601">ISO-8601</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="DD-MM-YYYY">DD-MM-YYYY</option>
                    </select>
                  </label>
                  <label className="text-[11px] text-slate-400">
                    Measurement unit
                    <select
                      value={schemaMapping.measurementUnit || ''}
                      onChange={(event) => applySchemaMapping({ measurementUnit: (event.target.value || undefined) as CsvSchemaMapping['measurementUnit'] })}
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200"
                    >
                      <option value="">Not confirmed</option>
                      {['kW', 'MW', 'kVA', 'MVA', 'kWh', 'MWh'].map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                  </label>
                </div>
                {(schemaMapping.measurementUnit === 'kWh' || schemaMapping.measurementUnit === 'MWh') && (
                  <label className="flex items-start gap-2 text-xs text-amber-200">
                    <input
                      type="checkbox"
                      checked={schemaMapping.confirmEnergyToPower === true}
                      onChange={(event) => applySchemaMapping({ confirmEnergyToPower: event.target.checked })}
                    />
                    Convert interval energy to average power using the confirmed 15-minute interval (explicit confirmation required).
                  </label>
                )}
                {schemaDetection.proposedMappings.length > 0 && (
                  <div className="grid gap-1 text-[11px] text-slate-400">
                    {schemaDetection.proposedMappings.map((mapping, index) => (
                      <div key={`${mapping.targetField}-${index}`}>
                        {mapping.sourceColumn} → {mapping.targetField} · <span className={mapping.confidence === 'high' ? 'text-emerald-400' : 'text-amber-300'}>{mapping.confidence}</span> · {mapping.reason}
                      </div>
                    ))}
                  </div>
                )}
                {schemaDetection.warnings.length > 0 && (
                  <div className="rounded border border-amber-800 bg-amber-950/30 p-3 text-[11px] text-amber-200" data-testid="csv-mapping-warnings">
                    {schemaDetection.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                    {!mappingConfirmed && (
                      <Button onClick={() => applySchemaMapping({}, true)} variant="outline" size="sm" className="mt-3 text-xs">
                        Confirm reviewed mapping
                      </Button>
                    )}
                  </div>
                )}
                {mappingErrors.length > 0 && (
                  <div className="rounded border border-rose-900 bg-rose-950/20 p-3 text-[11px] text-rose-200">
                    {mappingErrors.slice(0, 5).map((error, index) => <div key={`${error}-${index}`}>{error}</div>)}
                  </div>
                )}
                {sampleRows.length > 0 && (
                  <div className="overflow-x-auto">
                    <div className="mb-1 text-[11px] font-semibold text-slate-300">Normalized sample</div>
                    <table className="w-full text-left text-[11px] text-slate-400">
                      <thead><tr><th>Date</th><th>Block</th><th>Load kW</th></tr></thead>
                      <tbody>{sampleRows.map((row, index) => <tr key={index}><td>{row.operating_date}</td><td>{row.block_index}</td><td>{row.load_kw}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

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
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-3 rounded bg-slate-950 border border-slate-800">
                        <span className="text-xs text-slate-400 block mb-1">Total Rows</span>
                        <div className="text-lg font-bold font-mono text-slate-200">{parseResult.totalRows}</div>
                      </div>
                      <div className="p-3 rounded bg-emerald-950/30 border border-emerald-800/60">
                        <span className="text-xs text-emerald-300 block mb-1">Valid Days / Blocks</span>
                        <div className="text-lg font-bold font-mono text-emerald-400">{parseResult.validDays} / {parseResult.validBlocks}</div>
                      </div>
                      <div className="p-3 rounded bg-rose-950/30 border border-rose-800/60">
                        <span className="text-xs text-rose-300 block mb-1">Invalid Days / Rows</span>
                        <div className="text-lg font-bold font-mono text-rose-400">{parseResult.invalidDays} / {parseResult.invalidRows}</div>
                      </div>
                      <div className="p-3 rounded bg-slate-950 border border-slate-800">
                        <span className="text-xs text-slate-400 block mb-1">Days Detected</span>
                        <div className="text-lg font-bold font-mono text-slate-200">{parseResult.daysDetected}</div>
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

                    {parseResult.errors.length === 0 && parseResult.validDays > 0 && (
                      <div className="p-3 rounded-md bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-200 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          {parseResult.validBlocks} blocks across {parseResult.validDays} day(s) validated successfully.
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

      {/* Subtab 4: Real Billing & Subscription Management */}
      {activeSubTab === 'billing' && (
        <div className="space-y-6">
          <Card variant="industrial">
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <div>
                  <CardTitle className="text-teal-400 flex items-center gap-2">
                    <CreditCard className="w-5 h-5" />
                    Subscription, Entitlements & Invoices
                  </CardTitle>
                  <CardDescription>
                    Manage enterprise tier subscriptions, active product entitlements, and payment provenance.
                  </CardDescription>
                </div>
                {billingData && (
                  <Badge
                    variant={
                      billingData.billingMode === 'RAZORPAY_LIVE'
                        ? 'success'
                        : billingData.billingMode === 'RAZORPAY_TEST'
                        ? 'warning'
                        : 'outline'
                    }
                  >
                    Provider Mode: {billingData.billingMode}
                  </Badge>
                )}
              </div>
            </CardHeader>

            <div className="p-6 pt-0 space-y-6">
              {billingFeedback && (
                <div
                  className={`p-3 rounded-md text-xs flex items-center gap-2 ${
                    billingFeedback.type === 'success'
                      ? 'bg-emerald-950/50 border border-emerald-800 text-emerald-200'
                      : 'bg-rose-950/50 border border-rose-800 text-rose-200'
                  }`}
                >
                  {billingFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{billingFeedback.message}</span>
                </div>
              )}

              {isLoadingBilling ? (
                <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
                  Loading subscription records...
                </div>
              ) : (
                <>
                  {/* Section 1: Active Subscriptions */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Active SaaS Subscriptions
                    </h3>
                    {!billingData?.subscriptions || billingData.subscriptions.length === 0 ? (
                      <div className="p-4 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-400">
                        No active commercial subscription currently on file. Platform operates under registered evaluation entitlement.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {billingData.subscriptions.map((sub: any) => (
                          <div
                            key={sub.id}
                            className="p-4 rounded-md bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-200 text-sm">
                                  {sub.product_id ? sub.product_id.replace(/_/g, ' ') : 'Enterprise Platform'}
                                </span>
                                <Badge
                                  variant={
                                    sub.status === 'ACTIVE'
                                      ? 'success'
                                      : sub.status === 'CANCELLED'
                                      ? 'danger'
                                      : 'warning'
                                  }
                                >
                                  {sub.status}
                                </Badge>
                                {sub.cancel_at_period_end && (
                                  <Badge variant="warning">Cancels At Period End</Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 flex items-center gap-3">
                                <span>Period: {sub.current_period_start?.substring(0, 10) || 'N/A'} to {sub.current_period_end?.substring(0, 10) || 'N/A'}</span>
                                {sub.amount_paise && (
                                  <span>Amount: ₹{(sub.amount_paise / 100).toLocaleString('en-IN')}/mo</span>
                                )}
                              </p>
                            </div>

                            <div>
                              {activeRole === 'ORGANISATION_ADMIN' ? (
                                !sub.cancel_at_period_end && sub.status === 'ACTIVE' ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={billingActionLoading}
                                    onClick={() => handleCancelSubscription(sub.id)}
                                    className="text-xs border-rose-800 text-rose-300 hover:bg-rose-950/40"
                                  >
                                    {billingActionLoading ? 'Cancelling...' : 'Cancel at Period End'}
                                  </Button>
                                ) : (
                                  <span className="text-[11px] text-slate-500 italic">No actions available</span>
                                )
                              ) : (
                                <span className="text-[11px] text-slate-500 italic">Admin role required</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Section 2: Module Entitlements */}
                  <div className="space-y-3 pt-4 border-t border-slate-800">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Authorised Module Entitlements
                    </h3>
                    {!billingData?.entitlements || billingData.entitlements.length === 0 ? (
                      <p className="text-xs text-slate-400">No active entitlements discovered.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {billingData.entitlements.map((ent: any) => (
                          <div
                            key={ent.id}
                            className="p-3 rounded-md bg-slate-950 border border-slate-800 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4 text-teal-400" />
                              <span className="text-xs font-semibold text-slate-200">
                                {ent.product_id.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <Badge variant={ent.is_active ? 'success' : 'outline'}>
                              {ent.is_active ? 'Entitled' : 'Revoked'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Section 3: Invoices & Payment Provenance */}
                  <div className="space-y-3 pt-4 border-t border-slate-800">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Tax Invoices & Payment Records
                    </h3>
                    {!billingData?.invoices || billingData.invoices.length === 0 ? (
                      <div className="p-4 rounded-md bg-slate-950/50 border border-slate-800/80 text-xs text-slate-500 italic">
                        No invoices recorded yet for this organization. Invoices generated from recurring cycles will appear here.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {billingData.invoices.map((inv: any) => (
                          <div
                            key={inv.id}
                            className="p-3 rounded-md bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                          >
                            <div>
                              <span className="font-semibold text-slate-200">{inv.invoice_number || inv.id}</span>
                              <span className="text-slate-500 ml-2">{inv.created_at?.substring(0, 10)}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-slate-200">₹{((inv.amount_paise || 0) / 100).toLocaleString('en-IN')}</span>
                              <Badge variant={inv.status === 'PAID' ? 'success' : 'warning'}>{inv.status}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-slate-500">Loading settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
