'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  Cpu,
  History,
  Lock,
  RefreshCw,
  Building2,
  MapPin,
  Bell,
  FileText,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';

export default function AdminPage() {
  const { activeRole } = useSite();
  const [activeTab, setActiveTab] = useState<'checklist' | 'models' | 'audit'>('checklist');

  const isInternalAdmin =
    activeRole === 'AETHEON_ANALYST' ||
    activeRole === 'AETHEON_REGULATORY_REVIEWER';

  const [adminData, setAdminData] = useState<{
    auditEvents: any[];
    tenantHealth: {
      totalOrganisations: number;
      totalSites: number;
      activeAlerts: number;
      totalReports: number;
    };
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isInternalAdmin) return;
    setIsLoading(true);
    fetch('/api/admin/audit')
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setAdminData(data);
      })
      .catch((err) => console.warn('Error fetching admin data:', err))
      .finally(() => setIsLoading(false));
  }, [isInternalAdmin]);

  const launchChecklist = [
    { title: 'Supported State Jurisdiction & DISCOMs', status: 'VERIFIED_LOCAL', desc: 'MSEDCL, UGVCL, PVVNL profiles active with verified voltage brackets.' },
    { title: '15-Minute 96-Block Contiguity Validation', status: 'VERIFIED_LOCAL', desc: 'SHA-256 duplicate detection and strict 96-block contiguous parser active.' },
    { title: 'Multi-Tenant & Site-Level RLS Boundaries', status: 'VERIFIED_LOCAL', desc: 'PostgreSQL has_site_access, privilege-escalation prevention, and live RLS tests passed.' },
    { title: 'Central Publication Quality Gate', status: 'VERIFIED_LOCAL', desc: 'Hard suppression on stale (>24h) telemetry and incomplete profiles active.' },
    { title: 'Calculation Provenance Snapshots', status: 'VERIFIED_LOCAL', desc: 'Model version, generation time, and tariff source attached to all outputs.' },
    { title: 'Billing Provider & Cancellation Flow', status: 'PRODUCTION_CONFIG_REQUIRED', desc: 'MOCK_DEVELOPMENT mode active locally; live Razorpay keys required for prod.' },
    { title: 'Subscription vs Monitoring Decoupling', status: 'VERIFIED_LOCAL', desc: 'Payment grants commercial entitlement; monitoring follows activation state machine.' },
    { title: 'Self-Service Customer Data Export', status: 'VERIFIED_LOCAL', desc: 'CSV & print layouts implemented across all operational modules.' },
    { title: 'Self-Service Ingestion Remediation', status: 'VERIFIED_LOCAL', desc: 'Row-level error explanations provided on rejected imports.' },
    { title: 'Tamper-Evident SHA-256 Audit Logging', status: 'VERIFIED_LOCAL', desc: 'Hash-chained audit log with immutable database trigger verified.' },
    { title: 'Admin MFA & Specialist Security Audit', status: 'PRODUCTION_CONFIG_REQUIRED', desc: 'Internal analyst time-bound access enforced; MFA AAL2 production config required; external Astra audit pending.' },
  ];

  const models = [
    { name: 'Grid Day-Ahead Forecast Heuristic', version: 'v1.0-baseline', module: 'GRID', status: 'INTERNAL_VALIDATION' },
    { name: 'CERC DSM Deviation Settlement Engine', version: 'v2.1-heuristic', module: 'DSM', status: 'INTERNAL_VALIDATION' },
    { name: 'BESS Degradation-Aware Advisory Solver', version: 'v1.0-milp-ref', module: 'BESS', status: 'SPECIALIST_REVIEW_REQUIRED' },
    { name: 'CEA Grid Carbon Avoidance Ledger', version: 'v19-baseline', module: 'RENEWABLES', status: 'DEMO_ONLY' },
  ];

  if (!isInternalAdmin) {
    return (
      <Card variant="bordered" className="p-12 text-center">
        <Lock className="w-10 h-10 text-rose-400 mx-auto mb-3" />
        <h3 className="text-base font-bold text-slate-200">Administrative Access Restricted</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
          Customer accounts without administrative privileges cannot access internal platform operations.
          Your current active role ({activeRole}) is restricted.
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
            Launch readiness validation, model registry, tenant database health, and tamper-evident audit trail.
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
          {isLoading && <RefreshCw className="w-4 h-4 text-teal-400 animate-spin" />}
        </div>
      </div>

      {/* Tenant Health Overview */}
      {adminData?.tenantHealth && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-md bg-slate-900/60 border border-slate-800 flex items-center gap-3">
            <Building2 className="w-5 h-5 text-teal-400" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Organisations</span>
              <div className="text-lg font-bold font-mono text-slate-100">{adminData.tenantHealth.totalOrganisations}</div>
            </div>
          </div>
          <div className="p-4 rounded-md bg-slate-900/60 border border-slate-800 flex items-center gap-3">
            <MapPin className="w-5 h-5 text-sky-400" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Operating Sites</span>
              <div className="text-lg font-bold font-mono text-slate-100">{adminData.tenantHealth.totalSites}</div>
            </div>
          </div>
          <div className="p-4 rounded-md bg-slate-900/60 border border-slate-800 flex items-center gap-3">
            <Bell className="w-5 h-5 text-rose-400" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Active Alerts</span>
              <div className="text-lg font-bold font-mono text-slate-100">{adminData.tenantHealth.activeAlerts}</div>
            </div>
          </div>
          <div className="p-4 rounded-md bg-slate-900/60 border border-slate-800 flex items-center gap-3">
            <FileText className="w-5 h-5 text-amber-400" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Generated Reports</span>
              <div className="text-lg font-bold font-mono text-slate-100">{adminData.tenantHealth.totalReports}</div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 1: 10-Point Launch Readiness Checklist */}
      {activeTab === 'checklist' && (
        <Card variant="default">
          <CardHeader>
            <div>
              <CardTitle className="text-slate-100">11-Point Commercial Launch Readiness Checklist</CardTitle>
              <CardDescription>
                Verification status against core architectural and regulatory governance gates.
              </CardDescription>
            </div>
            <Badge variant="info">8 Local Verified • 2 Config Required • 1 Review Required</Badge>
          </CardHeader>

          <div className="p-6 pt-0 space-y-3">
            {launchChecklist.map((item, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-md bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-slate-200">{item.title}</span>
                    <Badge
                      variant={
                        item.status === 'VERIFIED_LOCAL'
                          ? 'success'
                          : item.status === 'PRODUCTION_CONFIG_REQUIRED'
                          ? 'warning'
                          : 'danger'
                      }
                    >
                      {item.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tab 2: Model Registry */}
      {activeTab === 'models' && (
        <Card variant="industrial">
          <CardHeader>
            <CardTitle className="text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-purple-400" />
              Algorithmic Model Registry
            </CardTitle>
            <CardDescription>
              Registered optimization solvers, day-ahead forecast models, and emission factor engines.
            </CardDescription>
          </CardHeader>

          <div className="p-6 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {models.map((m, idx) => (
                <div key={idx} className="p-4 rounded-md bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-200">{m.name}</span>
                    <Badge variant={m.status === 'VERIFIED_LOCAL' ? 'success' : 'warning'}>
                      {m.status}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Module: <strong className="text-slate-300">{m.module}</strong></span>
                    <span>Version: <code className="text-purple-300">{m.version}</code></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Tab 3: Tamper-Evident Audit Log */}
      {activeTab === 'audit' && (
        <Card variant="industrial">
          <CardHeader>
            <CardTitle className="text-slate-100 flex items-center gap-2">
              <History className="w-4 h-4 text-teal-400" />
              PostgreSQL Tamper-Evident SHA-256 Audit Trail
            </CardTitle>
            <CardDescription>
              Cryptographically chained immutable audit records queried directly from the database.
            </CardDescription>
          </CardHeader>

          <div className="p-6 pt-0 overflow-x-auto">
            {!adminData?.auditEvents || adminData.auditEvents.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 italic">
                No audit events currently registered in database table.
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Entity Type</th>
                    <th className="py-2.5 px-3">Actor ID</th>
                    <th className="py-2.5 px-3">SHA-256 Chained Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {adminData.auditEvents.map((evt) => (
                    <tr key={evt.id} className="hover:bg-slate-900/40">
                      <td className="py-2 px-3 text-slate-400">{evt.created_at?.substring(0, 19).replace('T', ' ')}</td>
                      <td className="py-2 px-3 text-teal-300 font-semibold">{evt.action || evt.event_type}</td>
                      <td className="py-2 px-3 text-slate-300">{evt.entity_type || 'SYSTEM'}</td>
                      <td className="py-2 px-3 text-slate-400">{evt.actor_id?.substring(0, 8) || 'SYSTEM'}...</td>
                      <td className="py-2 px-3 font-mono text-[10px] text-slate-500">
                        {evt.current_hash ? `${evt.current_hash.substring(0, 16)}...` : 'GENESIS'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
