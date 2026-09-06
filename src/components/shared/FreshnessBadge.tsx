import React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Radio, Clock, AlertCircle } from 'lucide-react';
import type { FreshnessStatus } from '@/types';

export function FreshnessBadge({ status, className }: { status: FreshnessStatus; className?: string }) {
  const configs = {
    RECENT: { variant: 'success' as const, icon: <Radio className="w-3 h-3 animate-pulse" />, label: 'Freshness: RECENT' },
    DELAYED: { variant: 'warning' as const, icon: <Clock className="w-3 h-3" />, label: 'Freshness: DELAYED' },
    STALE: { variant: 'danger' as const, icon: <AlertCircle className="w-3 h-3" />, label: 'Freshness: STALE (>24h)' },
    UNKNOWN: { variant: 'outline' as const, icon: <Clock className="w-3 h-3" />, label: 'Freshness: UNKNOWN' },
    DEMO: { variant: 'info' as const, icon: <Radio className="w-3 h-3" />, label: 'Freshness: DEMO DATA' },
  };

  const config = configs[status] || configs.DEMO;

  return (
    <Badge variant={config.variant} className={className}>
      {config.icon}
      {config.label}
    </Badge>
  );
}
