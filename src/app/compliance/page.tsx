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

export default function CompliancePage() {
  const { currentSite } = useSite();
  const [filterState, setFilterState] = useState('ALL');

  const regulatorySources = [
    {
      id: 'reg-01',
      title: 'MSEDCL Multi-Year Tariff (MYT) Order FY 2024-25',
      jurisdiction: 'MERC',
      state: 'Maharashtra',
      effectiveDate: '2024-04-01',
      version: 'MERC_MYT_2024_DEMO',
      status: 'APPROVED',
      isDemo: true,
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
      isDemo: true,
    },
  ];

  const complianceCalendar = [
    {
      deadline: '2026-09-15',
      obligation: 'Monthly Banking Energy Reconciliation with MSEDCL',
      type: 'DISCOM Filing',
      status: 'IN_PROGRESS',
      owner: 'Vikram Desai (Demo Energy Manager)',
    },
    {
      deadline: '2026-09-25',
      obligation: 'Quarterly SLDC Open Access Scheduling Agreement Renewal',
      type: 'SLDC Statutory',
      status: 'NOT_STARTED',
      owner: 'Rajesh Sharma (Demo Admin)',
    },
    {
      deadline: '2026-10-05',
      obligation: 'Filing of RE Captive Shareholding Self-Certification',
      type: 'Regulatory Compliance',
      status: 'NOT_STARTED',
      owner: 'Anita Roy (Demo Finance Viewer)',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-sky-400" />
              Open Access Compliance Sentinel
            </h1>
            <Badge variant="demo">DEMO / UNVERIFIED</Badge>
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
              Open Access Landed Charges Tracker - {currentSite.state} ({currentSite.discom})
            </CardTitle>
            <CardDescription>
              Applicable tariff components per unit for 33kV industrial connection (DEMO SYNTHETIC).
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
            <span className="text-[10px] text-slate-500">MSEDCL HT Network</span>
          </div>

          <div className="p-3 bg-slate-950 rounded border border-slate-800">
            <span className="text-xs text-slate-400 block mb-1">Transmission Charge</span>
            <div className="text-lg font-bold font-mono text-slate-200">₹0.38 / kWh</div>
            <span className="text-[10px] text-slate-500">State Transmission Utility (STU)</span>
          </div>

          <div className="p-3 bg-slate-950 rounded border border-slate-800">
            <span className="text-xs text-slate-400 block mb-1">Banking Energy Charges</span>
            <div className="text-lg font-bold font-mono text-slate-200">8.0%</div>
            <span className="text-[10px] text-slate-500">In-kind energy deduction</span>
          </div>
        </div>
      </Card>

      {/* Compliance Calendar & Deadlines */}
      <Card variant="default">
        <CardHeader>
          <div>
            <CardTitle className="text-slate-200">
              <Calendar className="w-4 h-4 text-teal-400" />
              Statutory Compliance Calendar
            </CardTitle>
            <CardDescription>
              Upcoming operational deadlines for SLDC filings, banking reconciliations, and captive compliance.
            </CardDescription>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="p-3">Deadline</th>
                <th className="p-3">Compliance Obligation</th>
                <th className="p-3">Category</th>
                <th className="p-3">Responsible Owner</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {complianceCalendar.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-900/40">
                  <td className="p-3 font-mono font-bold text-slate-200">{item.deadline}</td>
                  <td className="p-3 font-medium text-slate-100">{item.obligation}</td>
                  <td className="p-3 text-slate-400">{item.type}</td>
                  <td className="p-3 text-slate-400">{item.owner}</td>
                  <td className="p-3 text-center">
                    <Badge variant={item.status === 'IN_PROGRESS' ? 'warning' : 'outline'}>
                      {item.status.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        modelGenerationTime="2026-09-06T18:00:00Z"
        tariffVersion="MERC_MYT_2024_DEMO"
      />
    </div>
  );
}
