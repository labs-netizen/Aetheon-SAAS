'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, AlertTriangle, AlertCircle, CheckCircle2, Info, Filter, RefreshCw } from 'lucide-react';
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
  triggered_at: string;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  affected_block_start?: number;
  affected_block_end?: number;
}

export default function AlertsPage() {
  const { currentSite } = useSite();
  const [filter, setFilter] = useState<'ALL' | AlertSeverity>('ALL');
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (!currentSite?.id) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/alerts?siteId=${currentSite.id}`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
      }
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentSite?.id]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleAcknowledge = async (id: string) => {
    setAcknowledgingId(id);
    try {
      const res = await fetch(`/api/alerts/${id}/acknowledge`, {
        method: 'POST',
      });
      if (res.ok) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'ACKNOWLEDGED' } : a))
        );
      }
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    } finally {
      setAcknowledgingId(null);
    }
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
            Persisted operational alerts, peak tariff warnings, and deviation notifications.
          </p>
        </div>

        {/* Severity Filters */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          {(['ALL', 'CRITICAL', 'HIGH', 'WARNING', 'INFO'] as const).map((sev) => (
            <button
              key={sev}
              onClick={() => setFilter(sev)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filter === sev
                  ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="py-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
            Loading persisted alerts from database...
          </div>
        ) : filteredAlerts.length === 0 ? (
          <Card className="py-12 text-center text-xs text-slate-400">
            No active incidents matching the selected filter for {currentSite?.name || 'current site'}.
          </Card>
        ) : (
          filteredAlerts.map((alt) => (
            <Card
              key={alt.id}
              variant="default"
              className={`flex flex-col md:flex-row md:items-center justify-between gap-4 border-l-4 ${
                alt.severity === 'CRITICAL'
                  ? 'border-l-rose-500'
                  : alt.severity === 'HIGH'
                  ? 'border-l-amber-500'
                  : alt.severity === 'WARNING'
                  ? 'border-l-yellow-500'
                  : 'border-l-teal-500'
              }`}
            >
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex items-center gap-2">
                  {severityBadge(alt.severity)}
                  <Badge variant="outline">{alt.module}</Badge>
                  <h4 className="text-xs font-semibold text-slate-200">{alt.title}</h4>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{alt.description}</p>
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span>Triggered: {new Date(alt.triggered_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>
                  {alt.affected_block_start && alt.affected_block_end && (
                    <span>• Affected Blocks: {alt.affected_block_start}–{alt.affected_block_end}</span>
                  )}
                  <span>
                    • Status: <strong className={alt.status === 'ACTIVE' ? 'text-amber-400' : 'text-emerald-400'}>{alt.status}</strong>
                  </span>
                </div>
              </div>

              <div>
                {alt.status === 'ACTIVE' ? (
                  <Button
                    onClick={() => handleAcknowledge(alt.id)}
                    disabled={acknowledgingId === alt.id}
                    variant="outline"
                    size="sm"
                    className="text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                  >
                    {acknowledgingId === alt.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    )}
                    Acknowledge
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2.5 py-1 rounded">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Acknowledged
                  </div>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
