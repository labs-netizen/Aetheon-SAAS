import React from 'react';
import { Skeleton } from './Skeleton';

export interface LoadingStateProps {
  label?: string;
  rows?: number;
}

export function LoadingState({ label = 'Loading operational telemetry...', rows = 4 }: LoadingStateProps) {
  return (
    <div className="space-y-4 p-6 rounded-lg border border-slate-800 bg-slate-950/40">
      <div className="flex items-center gap-3">
        <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
        <p className="text-xs font-medium text-slate-400">{label}</p>
      </div>
      <div className="space-y-2 pt-2">
        {Array.from({ length: rows }).map((_, idx) => (
          <Skeleton key={idx} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
