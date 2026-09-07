'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  Calendar,
  FileCheck,
  AlertTriangle,
  Scale,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useSite } from '@/components/layout/SiteContext';
import { ProvenanceFooter } from '@/components/shared/ProvenanceFooter';
import { ModuleGate } from '@/components/shared/ModuleGate';

export default function CompliancePage() {
  const { currentSite, isEntitled } = useSite();
  const [filterState, setFilterState] = useState('ALL');

  const regulatorySources = [
    {
      id: 'reg-01',
      title: 'MSEDCL Multi-Year Tariff (MYT) Order FY 2024-25',
      jurisdiction: 'MERC',
      state: 'Maharashtra',
      effectiveDate: '2024-04-01',
      version: 'MERC_MYT_2024_VALIDATED',
      status: 'APPROVED',
      isDemo: false,
    },
    {
      id: 'reg-02',
      title: 'Draft Green Energy Open Access (GEOA) Regulations 2024',
      jurisdiction: 'MERC',
      state: 'Maharashtra',
      effectiveDate: '2024-10-01',
      version: 'MERC_GEOA_DRAFT_2024',
      status: 'REVIEW_PENDING',
      isDemo: true,
    },
    {
      id: 'reg-03',
      title: 'CERC Deviation Settlement Mechanism 2nd Amendment',
      jurisdiction: 'CERC',
      state: 'National',
      effectiveDate: '2024-02-15',
      version: 'CERC_DSM_AMEND2_2024',
      status: 'APPROVED',
      isDemo: false,
    },
  ];

  const complianceCalendar = [
    {
      deadline: '2026-09-15',
      obligation: 'Monthly Banking Energy Reconciliation with MSEDCL',
      type: 'DISCOM Filing',
      status: 'IN_PROGRESS',
      owner: 'Vikram Desai (Energy Manager)',
    },
    {
      deadline: '2026-09-25',
      obligation: 'Quarterly SLDC Open Access Scheduling Agreement Renewal',
      type: 'SLDC Statutory',
      status: 'NOT_STARTED',
      owner: 'Rajesh Sharma (Admin)',
    },
    {
      deadline: '2026-10-05',
      obligation: 'Filing of RE Captive Shareholding Self-Certification',
      type: 'Regulatory Compliance',
      status: 'NOT_STARTED',
      owner: 'Anita Roy (Finance Viewer)',
    },
  ];

  return (
    <ModuleGate
      productId="OPEN_ACCESS_COMPLIANCE"
      productName="Open Access Compliance Sentinel"
      description="Automated statutory tracking, DISCOM landed open access charges, and regulatory approval pipeline."
      basePricePaise={4000000}
      isEntitled={isEntitled('OPEN_ACCESS_COMPLIANCE')}
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
              <Badge variant="warning">SPECIALIST_REVIEW_REQUIRED</Badge>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Automated statutory tracking, DISCOM charges, and regulatory approval pipeline.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="info">MERC Jurisdiction</Badge>
          </div>
        </div>

        {/* Statutory Disclaimer Alert */}
        <div className="p-4 rounded-md border border-amber-900/50 bg-amber-950/20 text-xs text-amber-200/90 flex items-start gap-3">
          <Scale className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Decision Support & Compliance Notice:</strong> Content and calculations provided in this module are algorithmic estimates for planning purposes.
            This platform does NOT provide formal legal opinions or represent official regulatory clearance from CERC, SERC, or SLDC.
          </p>
        </div>

        {/* DISCOM Landed Charges Tracker */}
        <Card variant="industrial">
          <CardHeader>
            <div>
              <CardTitle className="text-sky-400">
                Open Access Landed Charges Tracker - {currentSite?.state || 'Maharashtra'} ({currentSite?.discom || 'MSEDCL'})
              </CardTitle>
              <CardDescription>
                Applicable tariff components per unit for 33kV industrial connection.
              </CardDescription>
            </div>
            <Badge variant="outline">Effective: FY 2024-25</Badge>
          </CardHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-2">
            <div className="p-3 bg-slate-950 rounded border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">Cross-Subsidy Surcharge (CSS)</span>
              <div className="text-lg font-bold font-mono text-slate-200">₹1.48 / kWh</div>
              <span className="text-[10px] text-amber-400">Waived for GEOA Solar</span>
            </div>

            <div className="p-3 bg-slate-950 rounded border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">Additional Surcharge (AS)</span>
              <div className="text-lg font-bold font-mono text-slate-200">₹1.15 / kWh</div>
              <span className="text-[10px] text-slate-500">Subject to DISCOM backing down</span>
            </div>

            <div className="p-3 bg-slate-950 rounded border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">Wheeling Charge</span>
              <div className="text-lg font-bold font-mono text-slate-200">₹0.64 / kWh</div>
              <span className="text-[10px] text-slate-500">33kV network level</span>
            </div>

            <div className="p-3 bg-slate-950 rounded border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">State Transmission Loss</span>
              <div className="text-lg font-bold font-mono text-slate-200">3.18%</div>
              <span className="text-[10px] text-slate-500">In-kind energy deduction</span>
            </div>

            <div className="p-3 bg-slate-950 rounded border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">Banking Surcharge</span>
              <div className="text-lg font-bold font-mono text-slate-200">₹0.20 / kWh</div>
              <span className="text-[10px] text-teal-400">Monthly settlement cycle</span>
            </div>
          </div>
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
            {complianceCalendar.map((item, idx) => (
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
            ))}
          </div>
        </Card>

        {/* Regulatory Source Register & Approval Pipeline */}
        <Card variant="default">
          <CardHeader>
            <div>
              <CardTitle className="text-slate-200">
                <FileCheck className="w-4 h-4 text-sky-400" />
                Regulatory Source Register & Review Workflow
              </CardTitle>
              <CardDescription>
                Multi-stage governance pipeline: CAPTURED → EXTRACTED → REVIEW_PENDING → APPROVED → PUBLISHED.
              </CardDescription>
            </div>
          </CardHeader>

          <div className="space-y-3">
            {regulatorySources.map((source) => {
              const isApproved = source.status === 'APPROVED';
              return (
                <div
                  key={source.id}
                  className="p-4 rounded-md bg-slate-950 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h5 className="text-xs font-semibold text-slate-200">{source.title}</h5>
                      <Badge variant={isApproved ? 'success' : 'warning'}>
                        {source.status}
                      </Badge>
                      {source.isDemo && <Badge variant="demo">DEMO</Badge>}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Jurisdiction: <strong className="text-slate-300">{source.jurisdiction}</strong> • Effective: {source.effectiveDate} • Version: {source.version}
                    </p>
                  </div>

                  <div>
                    {isApproved ? (
                      <span className="text-[11px] text-emerald-400 font-medium">
                        ✓ Published & Approved for Customer Use
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-400 font-medium">
                        ⚠ Blocked from Customer View (Pending Reviewer Sign-off)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Provenance Footer */}
        <ProvenanceFooter
          modelVersion="OA_COMPLIANCE_ENGINE_v1.0"
          modelGenerationTime="2026-09-07T00:00:00Z"
          tariffVersion="MERC_MYT_2024_VALIDATED"
        />
      </div>
    </ModuleGate>
  );
}
