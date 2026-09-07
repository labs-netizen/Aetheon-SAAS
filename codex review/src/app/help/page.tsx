'use client';

import React from 'react';
import { HelpCircle, BookOpen, Scale, FileText, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export default function HelpPage() {
  const articles = [
    {
      title: 'Understanding Indian 15-Minute Electricity Blocks (1 to 96)',
      category: 'Grid Operations',
      summary:
        'Under Indian grid code standards, each 24-hour operating day is partitioned into exactly 96 uniform 15-minute time blocks starting from Block 1 (00:00 - 00:15) through Block 96 (23:45 - 24:00) IST. All Day-Ahead Market bids, SLDC schedules, and smart meter recordings operate on this canonical 96-block index.',
    },
    {
      title: 'Commercial Subscription vs. Operational Activation Status',
      category: 'Account & Billing',
      summary:
        'A subscription grants commercial entitlement to a module, but operational monitoring is independently governed by data readiness: CONFIGURED (parameters saved) → AWAITING_DATA (waiting for meter data) → CALIBRATING (7-day baseline training) → ACTIVE (live intelligence). If data stops flowing, monitoring degrades to DEGRADED while commercial subscription remains intact.',
    },
    {
      title: 'Formatting and Uploading 15-Minute AMR Load Data (CSV)',
      category: 'Data Gateway',
      summary:
        'Upload files in standard CSV format with headers: operating_date, block_index, start_time, end_time, load_kw. Exactly 96 contiguous rows must be present per day. Negative load values or non-contiguous blocks will cause the ingestion validator to reject the file with row-level error reporting.',
    },
    {
      title: 'DSM Risk Bands & Incident Grouping',
      category: 'Deviation Settlement',
      summary:
        'Deviation is calculated as Actual Drawal minus SLDC Scheduled Drawal. Deviations < 4% are classified as NORMAL. Between 4% and 8% is WATCH. Between 8% and 12% is HIGH. Deviations > 12% trigger CRITICAL alerts and maximum penalty exposure. Adjacent non-normal blocks are grouped into persistent operational incidents to prevent alert fatigue.',
    },
    {
      title: 'BESS Arbitrage Opportunity Windows & Safety Interlocks',
      category: 'Battery Storage',
      summary:
        'BESS signals provide advisory opportunity windows recommending optimal charging (low tariff/solar surplus) and discharging (evening peak ToD tariff) while accounting for cell degradation costs. The platform does NOT dispatch hardware directly. Signals are automatically suppressed if telemetry is stale, SOC is out of bounds, or maintenance lock is active.',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-teal-400" />
          Knowledge Base & Operational Guidance
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Operational documentation, time block standards, and regulatory governance policies.
        </p>
      </div>

      {/* Decision Support & Legal Notice Card */}
      <div className="p-5 rounded-lg border border-teal-900/60 bg-teal-950/20 space-y-2">
        <div className="flex items-center gap-2 text-teal-300 font-semibold text-xs">
          <Scale className="w-4 h-4" />
          Statutory Decision Support Disclaimer
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          The Aetheon Energy Intelligence Platform produces algorithmic decision support for commercial and industrial electricity consumers in India.
          The platform does not execute automated exchange bids, submit binding SLDC schedules, dispatch physical plant equipment, or provide formal legal advice.
          Commercial savings and deviation figures are modeled estimates based on configured tariffs and historical interval telemetry.
        </p>
      </div>

      {/* Articles */}
      <div className="space-y-4">
        {articles.map((art, idx) => (
          <Card key={idx} variant="default">
            <div className="flex items-center justify-between mb-1.5">
              <Badge variant="outline">{art.category}</Badge>
            </div>
            <h3 className="text-sm font-bold text-slate-100 mb-2">{art.title}</h3>
            <p className="text-xs text-slate-300 leading-relaxed">{art.summary}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
