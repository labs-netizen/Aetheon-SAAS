import React from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface QualityGateBlockProps {
  reason: string;
  remediationAdvice?: string;
  onRemediate?: () => void;
}

export function QualityGateBlock({
  reason,
  remediationAdvice,
  onRemediate,
}: QualityGateBlockProps) {
  return (
    <div className="flex flex-col items-center justify-center p-10 text-center rounded-lg border border-rose-900/60 bg-rose-950/20 backdrop-blur-sm">
      <div className="p-3 mb-4 rounded-full bg-rose-900/40 border border-rose-800/80">
        <AlertOctagon className="w-8 h-8 text-rose-400" />
      </div>
      <h3 className="text-base font-semibold text-rose-200 mb-1">
        Actionable Recommendations Hard-Suppressed
      </h3>
      <p className="text-xs text-rose-300 max-w-md mb-4 leading-relaxed font-medium">
        {reason}
      </p>
      {remediationAdvice && (
        <div className="p-3 mb-6 rounded-md bg-slate-900/90 border border-slate-800 text-xs text-slate-300 max-w-md text-left">
          <strong className="text-emerald-400 block mb-1">Remediation Required:</strong>
          {remediationAdvice}
        </div>
      )}
      {onRemediate && (
        <Button onClick={onRemediate} variant="primary" size="sm" className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" />
          Upload Current Data
        </Button>
      )}
    </div>
  );
}
