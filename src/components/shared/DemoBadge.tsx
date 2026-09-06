import React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Database } from 'lucide-react';

export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge variant="demo" className={className}>
      <Database className="w-3 h-3 text-slate-950" />
      DEMO DATA / UNVERIFIED
    </Badge>
  );
}
