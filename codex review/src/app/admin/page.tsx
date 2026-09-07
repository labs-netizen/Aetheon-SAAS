'use client';

import React, { useState } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  Cpu,
  History,
  Lock,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';

export default function AdminPage() {
  const { activeRole } = useSite();
  const [activeTab, setActiveTab] = useState<'checklist' | 'models' | 'regulatory' | 'audit'>('checklist');

  // Internal platform administration is restricted to Aetheon staff
  const isInternalAdmin = activeRole === 'AETHEON_ANALYST' || activeRole === 'AETHEON_REGULATORY_REVIEWER';
  const hasAccess = isInternalAdmin;

  const launchChecklist = [
    { title: 'Supported State Jurisdiction & DISCOMs', status: 'READY', desc: 'MSEDCL, UGVCL, PVVNL profiles active with verified voltage brackets.' },
    { title: '15-Minute 96-Block Contiguity Validation', status: 'READY', desc: 'SHA-256 duplicate detection and row-level rejection parser active.' },
    { title: 'Central Publication Quality Gate', status: 'READY', desc: 'Hard suppression on stale (>24h) telemetry and incomplete profiles active.' },
    { title: 'Calculation Provenance Snapshots', status: 'READY', desc: 'Model version, generation time, and tariff source attached to all outputs.' },
    { title: 'Billing Provider & Cancellation Flow', status: 'READY', desc: 'Razorpay adapter with HMAC-SHA256 signature verification & mock dev mode.' },
    { title: 'Subscription vs Monitoring Decoupling', status: 'READY', desc: 'Payment grants commercial entitlement; monitoring follows activation state machine.' },
    { title: 'Self-Service Customer Data Export', status: 'READY', desc: 'CSV & print layouts implemented across all operational modules.' },
    { title: 'Self-Service Ingestion Remediation', status: 'READY', desc: 'Row-level error explanations provided on rejected imports.' },
    { title: 'Immutable Audit Logging Subsystem', status: 'READY', desc: 'Append-only audit table recording all tenant, site, role, and ingestion events.' },
    { title: 'Admin MFA & Time-Bounded Analyst Access', status: 'AUDIT_PENDING', desc: 'Analyst sessions enforce 24h expiration; external pentest pending.' },
  ];

  const models = [
    { name: 'Grid Day-Ahead Forecast Heuristic', version: 'v1.0-baseline', module: 'GRID', status: 'ACTIVE_DEMO' },
    { name: 'CERC DSM Deviation Settlement Engine', version: 'v2.1-heuristic', module: 'DSM', status: 'ACTIVE_DEMO' },
    { name: 'BESS Degradation-Aware Advisory Solver', version: 'v1.0-milp-ref', module: 'BESS', status: 'ACTIVE_DEMO' },
    { name: 'CEA Grid Carbon Avoidance Ledger', version: 'v19-baseline', module: 'RENEWABLES', status: 'ACTIVE_DEMO' },
  ];

  const auditEvents = [
    { id: 1, action: 'SITE_CREATED', actor: 'Rajesh Sharma', target: 'Chakan Auto Components Plant 1', time: '2026-09-01 10:00 IST' },
    { id: 2, action: 'SUBSCRIPTION_ACTIVATED', actor: 'SYSTEM', target: 'Grid Intelligence Monitor', time: '2026-09-01 10:05 IST' },
    { id: 3, action: 'DATA_INGESTED', actor: 'Vikram Desai', target: 'chakan_load_august2026.csv (96 blocks)', time: '2026-09-06 18:00 IST' },
    { id: 4, action: 'ALERT_ACKNOWLEDGED', actor: 'Sunil Pawar', target: 'DSM Drawal Deviation Exceeded (+15.0%)', time: '2026-09-06 18:45 IST' },
  ];

  if (!hasAccess) {
    return (
      <Card variant="bordered" className="p-12 text-center">
        <Lock className="w-10 h-10 text-rose-400 mx-auto mb-3" />
        <h3 className="text-base font-bold text-slate-200">Administrative Access Restricted</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
          Customer accounts cannot access internal Aetheon platform administration.
          Your current active role ({activeRole}) is restricted to customer-facing views.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            Platform Operations & Admin Console
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Launch readiness validation, model registry, regulatory approval queue, and audit trail.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === 'checklist' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('checklist')}
            className="text-xs"
          >
            Launch Checklist
          </Button>
          <Button
            variant={activeTab === 'models' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('models')}
            className="text-xs"
          >
            Model Registry
          </Button>
          <Button
            variant={activeTab === 'audit' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('audit')}
            className="text-xs"
          >
            Audit Log
          </Button>
        </div>
      </div>

      {/* Tab 1: 10-Point Launch Readiness Checklist */}
      {activeTab === 'checklist' && (
        <Card variant="default">
          <CardHeader>
            <div>
              <CardTitle className="text-slate-100">10-Point Commercial Launch Readiness Checklist</CardTitle>
              <CardDescription>
                Verification status against core architectural and regulatory governance gates.
              </CardDescription>
            </div>
            <Badge variant="warning">9/10 Verification Ready (Pentest Pending)</Badge>
          </CardHeader>

          <div className="space-y-3">
            {launchChecklist.map((item, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-md bg-slate-950 border border-slate-800 flex items-start justify-between gap-4"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-slate-500">#{idx + 1}</span>
                    <h5 className="text-xs font-semibold text-slate-200">{item.title}</h5>
                  </div>
                  <p className="text-[11px] text-slate-400">{item.desc}</p>
                </div>

                <Badge variant={item.status === 'READY' ? 'success' : 'warning'}>
                  {item.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tab 2: Model Registry */}
      {activeTab === 'models' && (
        <Card variant="default">
          <CardHeader>
            <div>
              <CardTitle className="text-slate-100">
                <Cpu className="w-4 h-4 text-teal-400" />
                Analytical Model Registry
              </CardTitle>
              <CardDescription>
                Active versions of numerical forecasting, deviation settlement, and BESS solvers.
              </CardDescription>
            </div>
          </CardHeader>

          <div className="space-y-3">
            {models.map((m, idx) => (
              <div
                key={idx}
                className="p-4 rounded-md bg-slate-950 border border-slate-800 flex items-center justify-between"
              >
                <div>
                  <h5 className="text-xs font-semibold text-slate-200">{m.name}</h5>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                    Version: {m.version} • Target Module: {m.module}
                  </p>
                </div>
                <Badge variant="demo">{m.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tab 3: System Audit Trail */}
      {activeTab === 'audit' && (
        <Card variant="default">
          <CardHeader>
            <div>
              <CardTitle className="text-slate-100">
                <History className="w-4 h-4 text-sky-400" />
                Immutable System Audit Log
              </CardTitle>
              <CardDescription>
                Append-only log recording tenant modifications, user role changes, and file ingestions.
              </CardDescription>
            </div>
          </CardHeader>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="p-3">ID</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Actor</th>
                  <th className="p-3">Target Entity</th>
                  <th className="p-3">Timestamp (IST)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {auditEvents.map((evt) => (
                  <tr key={evt.id} className="hover:bg-slate-900/40">
                    <td className="p-3 font-mono text-slate-500">#{evt.id}</td>
                    <td className="p-3 font-bold text-teal-300">{evt.action}</td>
                    <td className="p-3 text-slate-200">{evt.actor}</td>
                    <td className="p-3 text-slate-300">{evt.target}</td>
                    <td className="p-3 font-mono text-slate-400">{evt.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
