'use client';

import React from 'react';
import { Lock, ArrowRight, ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatCurrencyFromPaise } from '@/lib/units/currency';

export interface ModuleGateProps {
  productId: string;
  productName: string;
  description: string;
  basePricePaise?: number;
  isEntitled: boolean;
  children: React.ReactNode;
}

export function ModuleGate({
  productName,
  description,
  basePricePaise,
  isEntitled,
  children,
}: ModuleGateProps) {
  if (isEntitled) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-6">
      <Card variant="industrial" className="border-amber-500/30 bg-amber-950/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-amber-900/30 border border-amber-600/40 text-amber-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-amber-200 flex items-center gap-2">
                  {productName} — Subscription Required
                </CardTitle>
                <CardDescription className="text-amber-300/70 mt-0.5">
                  {description}
                </CardDescription>
              </div>
            </div>
            <Badge variant="warning">UNSUBSCRIBED</Badge>
          </div>
        </CardHeader>

        <div className="p-6 pt-0 space-y-4">
          <div className="p-4 rounded-md bg-slate-950 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-300">Commercial Monthly Plan</div>
              {basePricePaise && (
                <div className="text-xl font-bold font-mono text-emerald-400">
                  {formatCurrencyFromPaise(basePricePaise)}
                  <span className="text-xs font-normal text-slate-400 font-sans"> / site / month</span>
                </div>
              )}
              <p className="text-[11px] text-slate-400">
                Includes automated 15-minute evaluations, recurring executive reports, and compliance tracking.
              </p>
            </div>

            <Button
              onClick={() => {
                window.location.href = '/settings?tab=billing';
              }}
              variant="primary"
              size="md"
              className="gap-2 shrink-0"
            >
              Activate Subscription
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Backend API routes and data layers remain cryptographically protected by Row Level Security and entitlement guards.
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
