import React from 'react';
import { ShieldCheck, Info } from 'lucide-react';

export interface ProvenanceProps {
  sourceTimestamp?: string;
  sourceType?: string;
  completenessPct?: number;
  modelVersion: string;
  modelGenerationTime: string;
  tariffVersion?: string;
  ruleVersion?: string;
}

export function ProvenanceFooter({
  sourceTimestamp = new Date().toISOString(),
  sourceType = 'AMR Interval Data (Demo)',
  completenessPct = 100.0,
  modelVersion,
  modelGenerationTime,
  tariffVersion = 'MERC_MYT_2024_DEMO',
  ruleVersion = 'CERC_DSM_2024_DEMO',
}: ProvenanceProps) {
  return (
    <div className="mt-8 pt-4 border-t border-slate-800 text-xs text-slate-400 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 text-slate-400">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-slate-300">Calculation Provenance:</span>
          <span>Model: <strong className="text-slate-200">{modelVersion}</strong></span>
          <span>• Generated: <span className="text-slate-200">{new Date(modelGenerationTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST</span></span>
        </div>
        <div className="flex items-center gap-3">
          <span>Source: <strong className="text-slate-200">{sourceType}</strong></span>
          <span>• Completeness: <strong className="text-slate-200">{completenessPct}%</strong></span>
          <span>• Tariff: <strong className="text-slate-200">{tariffVersion}</strong></span>
        </div>
      </div>
      <div className="flex items-start gap-1.5 text-slate-400 text-xs leading-relaxed">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
        <span>
          <strong>Advisory Decision Support Disclaimer:</strong> Outputs are algorithmic models for operational planning.
          This platform does not issue automated exchange bids, SLDC schedules, physical plant dispatch, or legal opinions.
        </span>
      </div>
    </div>
  );
}
