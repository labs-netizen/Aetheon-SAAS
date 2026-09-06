'use client';

import React, { useState } from 'react';
import { Bell, AlertTriangle, AlertCircle, CheckCircle2, Info, Filter } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSite } from '@/components/layout/SiteContext';
import type { AlertSeverity } from '@/types';

interface AlertItem {
  id: string;
  module: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  triggeredAt: string;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  affectedWindow?: string;
}

export default function AlertsPage() {
  const { currentSite } = useSite();
  const [filter, setFilter] = useState<'ALL' | AlertSeverity>('ALL');
  const [alerts, setAlerts] = useState<AlertItem[]>([
    {
      id: 'alt-01',
      module: 'GRID',
      severity: 'HIGH',
      title: 'High-Cost Window Ahead (Tomorrow Evening)',
      description: 'Projected Day-Ahead Market clearing price exceeds ₹7,800/MWh between 18:30 and 21:00 IST.',
      triggeredAt: '10 minutes ago',
      status: 'ACTIVE',
      affectedWindow: '18:30 - 21:00 IST',
    },
    {
      id: 'alt-02',
      module: 'DSM',
      severity: 'CRITICAL',
      title: 'DSM Drawal Deviation Exceeded (+15.0%)',
      description: 'Chakan plant actual drawal exceeded SLDC schedule by 180 kW across 5 consecutive blocks.',
      triggeredAt: '45 minutes ago',
      status: 'ACTIVE',
      affectedWindow: '13:15 - 14:30 IST',
    },
    {
      id: 'alt-03',
      module: 'COMPLIANCE',
      severity: 'WARNING',
      title: 'Monthly Banking Reconciliation Deadline Approaching',
      description: 'MSEDCL banking energy filing must be submitted within 7 days to avoid energy lapse.',
      triggeredAt: '2 hours ago',
      status: 'ACTIVE',
    },
    {
      id: 'alt-04',
      module: 'BESS',
      severity: 'INFO',
      title: 'Optimal Charge Window Commenced',
      description: 'Off-peak solar valley tariff active. Recommended battery charge window open.',
      triggeredAt: '5 hours ago',
      status: 'ACKNOWLEDGED',
      affectedWindow: '11:30 - 14:00 IST',
    },
  ]);

  const handleAcknowledge = (id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'ACKNOWLEDGED' } : a))
    );
  };

  const filteredAlerts = alerts.filter((a) => (filter === 'ALL' ? true : a.severity === filter));

  const severityBadge = (sev: AlertSeverity) => {
    const variants: Record<AlertSeverity, 'danger' | 'warning' | 'info'> = {
      CRITICAL: 'danger',
      HIGH: 'danger',
      WARNING: 'warning',
      INFO: 'info',
    };
    return <Badge variant={variants[sev]}>{sev}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Bell className="w-5 h-5 text-teal-400" />
            Alerts & Incident Hub
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Proactive operational alerts, peak tariff warnings, and deviation notifications.
          </p>
        </div>

        {/* Severity Filters */}
        <div className="flex items-center gap-2">
          {(['ALL', 'CRITICAL', 'HIGH', 'WARNING', 'INFO'] as const).map((sev) => (
            <Button
              key={sev}
              variant={filter === sev ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilter(sev)}
              className="text-xs px-2.5 py-1"
            >
              {sev}
            </Button>
          ))}
        </div>
      </div>

      {/* Alerts List */}
      <div className="space-y-3">
        {filteredAlerts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 rounded-lg border border-slate-800 bg-slate-950">
            No alerts matching the selected severity filter.
          </div>
        ) : (
          filteredAlerts.map((alert) => (
            <Card key={alert.id} variant="default" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  {severityBadge(alert.severity)}
                  <Badge variant="outline">{alert.module}</Badge>
                  <span className="text-xs font-semibold text-slate-200">{alert.title}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">{alert.description}</p>
                <div className="flex items-center gap-4 text-[11px] text-slate-500">
                  <span>Triggered: {alert.triggeredAt}</span>
                  {alert.affectedWindow && <span>Affected Window: <strong className="text-slate-400">{alert.affectedWindow}</strong></span>}
                </div>
              </div>

              <div>
                {alert.status === 'ACKNOWLEDGED' ? (
                  <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" />
                    Acknowledged
                  </span>
                ) : (
                  <Button
                    onClick={() => handleAcknowledge(alert.id)}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Acknowledge
                  </Button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
