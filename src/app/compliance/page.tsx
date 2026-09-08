'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  Calendar,
  FileCheck,
  AlertTriangle,
  Scale,
  Clock,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useSite } from '@/components/layout/SiteContext';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { ModuleGate } from '@/components/shared/ModuleGate';
import { PRODUCTS } from '@/lib/constants';

export default function CompliancePage() {
  const { currentSite, isEntitled } = useSite();
  const [filterState, setFilterState] = useState('ALL');
  const [complianceData, setComplianceData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentSite?.id) return;
    let isMounted = true;
    setIsLoading(true);
    setComplianceError(null);

    fetch(`/api/compliance?siteId=${currentSite.id}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (isMounted) setComplianceData(data);
      })
      .catch((err) => {
        console.warn('Compliance API query error:', err);
        if (isMounted) setComplianceError(err.message);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentSite?.id]);

  // Approved/Published regulatory sources only
  const regulatorySources = useMemo(() => {
    if (complianceData?.sources && Array.isArray(complianceData.sources) && complianceData.sources.length > 0) {
      return complianceData.sources.map((s: any) => ({
        id: s.id,
        title: s.document_title || 'State Tariff Order',
        jurisdiction: s.jurisdiction,
        state: s.state || 'National',
        effectiveDate: s.effective_date,
        version: s.version,
        status: s.status,
      }));
    }

    if (currentSite?.is_demo) {
      return [
        {
          id: 'reg-01',
          title: 'MSEDCL Multi-Year Tariff (MYT) Order FY 2024-25',
          jurisdiction: 'MERC',
          state: 'Maharashtra',
          effectiveDate: '2024-04-01',
          version: 'MERC_MYT_2024_DEMO',
          status: 'APPROVED',
        },
      ];
    }

    return [];
  }, [complianceData, currentSite?.is_demo]);

  const filteredSources = useMemo(() => {
    if (filterState === 'ALL') return regulatorySources;
    return regulatorySources.filter((s: any) => s.state === filterState || s.state === 'National');
  }, [regulatorySources, filterState]);

  const complianceCalendar = useMemo(() => {
    if (complianceData?.calendar && Array.isArray(complianceData.calendar) && complianceData.calendar.length > 0) {
      return complianceData.calendar.map((c: any) => ({
        deadline: c.deadline_date,
        obligation: c.obligation_title,
        type: c.obligation_type,
        status: c.status,
        owner: c.owner_role ? c.owner_role.replace(/_/g, ' ') : 'Energy Manager',
      }));
    }

    if (currentSite?.is_demo) {
      return [
        {
          deadline: '2026-09-15',
          obligation: 'Monthly Banking Energy Reconciliation with DISCOM',
          type: 'DISCOM Filing',
          status: 'IN_PROGRESS',
          owner: 'Energy Manager',
        },
        {
          deadline: '2026-09-25',
          obligation: 'Quarterly SLDC Open Access Scheduling Agreement Renewal',
          type: 'SLDC Statutory',
          status: 'NOT_STARTED',
          owner: 'Admin',
        },
        {
          deadline: '2026-10-05',
          obligation: 'Filing of RE Captive Shareholding Self-Certification',
          type: 'Regulatory Compliance',
          status: 'NOT_STARTED',
          owner: 'Finance Viewer',
        },
      ];
    }

    return [];
  }, [complianceData, currentSite?.is_demo]);

  const charges = complianceData?.charges;

  return (
    <ModuleGate
      productId="OA_COMPLIANCE"
      productName="Open Access Compliance Sentinel"
      description="Automated statutory tracking, DISCOM landed open access charges, and regulatory approval pipeline."
      basePricePaise={1490000}
      isEntitled={isEntitled('OA_COMPLIANCE')}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-400" />
                Open Access Compliance Sentinel
              </h1>
              <Badge variant="warning">{PRODUCTS.OA_COMPLIANCE.availabilityStatus}</Badge>
              {complianceData?.hasApprovedData && (
                <Badge variant="success">APPROVED RECORDS LOADED</Badge>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Automated statutory tracking, DISCOM landed open access charges, and regulatory approval pipeline.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isLoading && <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />}
            <span className="text-xs text-slate-400 font-mono">Jurisdiction: {currentSite?.state || 'Maharashtra'}</span>
          </div>
        </div>

        {/* Regulatory Disclaimer Banner */}
        <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded flex items-start gap-2.5 text-xs text-amber-200/90">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p>
            <strong>NOT LEGAL ADVICE:</strong> Regulatory parameters and tariff schedules reflect Commission orders approved for algorithmic decision support. Consult legal/regulatory counsel for statutory proceedings before SERC or SLDC.
          </p>
        </div>

        {complianceError && (
          <div className="p-4 rounded bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>Compliance Record Service Error: {complianceError}</span>
          </div>
        )}

        {/* Landed Charges Tracker */}
        <Card variant="industrial">
          <CardHeader>
            <div>
              <CardTitle className="text-sky-400">
                Open Access Landed Charges Tracker - {currentSite?.state || 'Maharashtra'} ({currentSite?.discom || 'MSEDCL'})
              </CardTitle>
              <CardDescription>
                Applicable tariff components per unit for {currentSite?.voltage_category || '33kV'} connection from approved records.
              </CardDescription>
            </div>
            <Badge variant="outline">Effective: FY 2024-25</Badge>
          </CardHeader>

          {charges ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-2">
              <div className="p-3 bg-slate-950 rounded border border-slate-800">
                <span className="text-xs text-slate-400 block mb-1">Cross-Subsidy Surcharge (CSS)</span>
                <div className="text-lg font-bold font-mono text-slate-200">
                  ₹{Number(charges.cross_subsidy_surcharge_inr_per_kwh).toFixed(2)} / kWh
                </div>
                <span className="text-[10px] text-amber-400">Approved Tariff Order</span>
              </div>

              <div className="p-3 bg-slate-950 rounded border border-slate-800">
                <span className="text-xs text-slate-400 block mb-1">Additional Surcharge (AS)</span>
                <div className="text-lg font-bold font-mono text-slate-200">
                  ₹{Number(charges.additional_surcharge_inr_per_kwh).toFixed(2)} / kWh
                </div>
                <span className="text-[10px] text-slate-500">Subject to backing down</span>
              </div>

              <div className="p-3 bg-slate-950 rounded border border-slate-800">
                <span className="text-xs text-slate-400 block mb-1">Wheeling Charge</span>
                <div className="text-lg font-bold font-mono text-slate-200">
                  ₹{Number(charges.wheeling_charge_inr_per_kwh).toFixed(2)} / kWh
                </div>
                <span className="text-[10px] text-slate-500">{currentSite?.voltage_category || '33kV'} level</span>
              </div>

              <div className="p-3 bg-slate-950 rounded border border-slate-800">
                <span className="text-xs text-slate-400 block mb-1">Transmission Charge</span>
                <div className="text-lg font-bold font-mono text-slate-200">
                  ₹{Number(charges.transmission_charge_inr_per_kwh).toFixed(2)} / kWh
                </div>
                <span className="text-[10px] text-slate-500">State grid network</span>
              </div>

              <div className="p-3 bg-slate-950 rounded border border-slate-800">
                <span className="text-xs text-slate-400 block mb-1">Banking Surcharge</span>
                <div className="text-lg font-bold font-mono text-slate-200">
                  {Number(charges.banking_charge_pct).toFixed(1)}%
                </div>
                <span className="text-[10px] text-teal-400">Monthly settlement cycle</span>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-amber-300 bg-amber-950/20 border border-amber-800/40 rounded">
              Regulatory Landed Charges: Data Pending Formal Commission Review / Currently Unavailable for {currentSite?.state || 'Current State'} ({currentSite?.discom || 'DISCOM'}). Aetheon does not manufacture unapproved tariff assumptions.
            </div>
          )}
        </Card>

        {/* Statutory Compliance Calendar */}
        <Card variant="default">
          <CardHeader>
            <div>
              <CardTitle className="text-slate-100 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-sky-400" />
                Statutory Compliance & Filings Calendar
              </CardTitle>
              <CardDescription>
                Upcoming deadlines for DISCOM returns, banking reconciliation, and open access permits.
              </CardDescription>
            </div>
          </CardHeader>

          <div className="space-y-3">
            {complianceCalendar.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 italic bg-slate-950/50 rounded-md border border-slate-900">
                DATA GAP: No published statutory obligations found for this jurisdiction.
              </div>
            ) : (
              complianceCalendar.map((item: any, idx: number) => (
              <div
                key={idx}
                className="p-3.5 rounded-md bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-sky-400">{item.deadline}</span>
                    <Badge variant={item.status === 'IN_PROGRESS' ? 'warning' : 'outline'}>
                      {item.status.replace(/_/g, ' ')}
                    </Badge>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">[{item.type}]</span>
                  </div>
                  <h4 className="text-xs font-semibold text-slate-200">{item.obligation}</h4>
                  <p className="text-[11px] text-slate-400">Assigned: {item.owner}</p>
                </div>

                <Button variant="outline" size="sm" className="text-xs gap-1 self-start sm:self-auto">
                  View Obligation
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </div>
            )))}
          </div>
        </Card>

        {/* Approved Regulatory Repository */}
        <Card variant="industrial">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-slate-100 flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-sky-400" />
                  Commission Approved Regulatory Documents
                </CardTitle>
                <CardDescription>
                  Official orders approved and published by regulatory specialists. Internal draft states (REVIEW_PENDING) are excluded.
                </CardDescription>
              </div>
              <div className="flex gap-1.5">
                {['ALL', 'Maharashtra', 'National'].map((st) => (
                  <Button
                    key={st}
                    variant={filterState === st ? 'primary' : 'outline'}
                    size="sm"
                    className="text-xs"
                    onClick={() => setFilterState(st)}
                  >
                    {st}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>

          <div className="p-6 pt-0 space-y-3">
            {filteredSources.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 italic">
                No approved regulatory orders currently published for this jurisdiction. Internal records remain in review pipeline.
              </div>
            ) : (
              filteredSources.map((doc: any) => (
                <div
                  key={doc.id}
                  className="p-3.5 rounded-md bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="success">{doc.jurisdiction}</Badge>
                      <Badge variant="outline">{doc.state}</Badge>
                      <span className="text-[10px] text-slate-500 font-mono">Effective: {doc.effectiveDate}</span>
                    </div>
                    <h4 className="text-xs font-semibold text-slate-200">{doc.title}</h4>
                    <p className="text-[11px] text-slate-400 font-mono">Version: {doc.version} • Status: {doc.status}</p>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Badge variant="success">APPROVED & VALIDATED</Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Calculation Provenance Footer */}
        <ProvenanceFooter
          modelVersion="REGULATORY_PARSER_v1.0"
          tariffVersion="MERC_MYT_FY2024_25"
          ruleVersion="GEOA_RULES_2022_AMEND"
          sourceType="Maharashtra Electricity Regulatory Commission (MERC)"
        />
      </div>
    </ModuleGate>
  );
}
