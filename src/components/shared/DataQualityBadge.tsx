import React from 'react';
import { Badge } from '@/components/ui/Badge';
import { CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';
import type { ValidationStatus } from '@/types';

export function DataQualityBadge({ status, className }: { status: ValidationStatus; className?: string }) {
  const configs = {
    PASSED: { variant: 'success' as const, icon: <CheckCircle2 className="w-3 h-3" />, label: 'Quality: PASSED' },
    WARNING: { variant: 'warning' as const, icon: <AlertTriangle className="w-3 h-3" />, label: 'Quality: WARNING' },
    FAILED: { variant: 'danger' as const, icon: <XCircle className="w-3 h-3" />, label: 'Quality: FAILED' },
    STALE: { variant: 'danger' as const, icon: <Clock className="w-3 h-3" />, label: 'Quality: STALE' },
  };

  const config = configs[status] || configs.PASSED;

  return (
    <Badge variant={config.variant} className={className}>
      {config.icon}
      {config.label}
    </Badge>
  );
}
