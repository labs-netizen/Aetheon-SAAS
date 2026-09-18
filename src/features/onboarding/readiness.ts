/**
 * Module-aware data readiness evaluator.
 * Required evidence controls operational readiness; recommended and optional
 * configuration remains visible without reducing the required-readiness score.
 */

export type ReadinessEvidenceStatus = 'READY' | 'MISSING' | 'NOT_VERIFIED' | 'STALE' | 'DEMO_UNVERIFIED';

export interface ReadinessItem {
  key: string;
  label: string;
  category: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  isSatisfied: boolean;
  status: ReadinessEvidenceStatus;
  evidenceSource: string;
  currentValue?: string | number;
  remediationAction: string;
}

export interface SiteOperationalConfig {
  state?: string;
  discom?: string;
  contractDemandValue?: number;
  voltageCategory?: string;
  hasHistoricalIntervals?: boolean;
  intervalDaysCount?: number;
  intervalQualityStatus?: 'PASSED' | 'WARNING' | 'FAILED' | 'NO_DATA';
  intervalFreshnessStatus?: 'RECENT' | 'DELAYED' | 'STALE' | 'UNKNOWN';
  latestIntervalValid?: boolean;
  latestIntervalDate?: string | null;
  hasOpenAccessContract?: boolean;
  hasSolarAsset?: boolean;
  hasBessAsset?: boolean;
  hasAlertRecipient?: boolean;
  isDemo?: boolean;
}

export function evaluateGridReadiness(config: SiteOperationalConfig): {
  isReadyForMonitoring: boolean;
  readinessPct: number;
  items: ReadinessItem[];
} {
  const demoEvidence = config.isDemo === true;
  const validIntervalHistory = !demoEvidence && Boolean(
    config.hasHistoricalIntervals &&
    config.intervalDaysCount && config.intervalDaysCount >= 7
  );
  const freshIntervalEvidence = validIntervalHistory && config.latestIntervalValid === true &&
    (config.intervalQualityStatus === 'PASSED' || config.intervalQualityStatus === 'WARNING') &&
    config.intervalFreshnessStatus === 'RECENT';

  const items: ReadinessItem[] = [
    {
      key: 'state_discom',
      label: 'State & DISCOM Jurisdiction',
      category: 'REQUIRED',
      isSatisfied: Boolean(config.state && config.discom),
      status: config.state && config.discom ? 'READY' : 'MISSING',
      evidenceSource: 'sites.state / sites.discom',
      currentValue: config.state && config.discom ? `${config.state} (${config.discom})` : 'Not configured',
      remediationAction: 'Select plant state and operating DISCOM in site settings.',
    },
    {
      key: 'contract_demand',
      label: 'Contract Demand (kVA/MVA)',
      category: 'REQUIRED',
      isSatisfied: Boolean(config.contractDemandValue && config.contractDemandValue > 0),
      status: config.contractDemandValue && config.contractDemandValue > 0 ? 'READY' : 'MISSING',
      evidenceSource: 'sites.contract_demand_value',
      currentValue: config.contractDemandValue ? `${config.contractDemandValue} kVA/MVA` : 'Missing',
      remediationAction: 'Enter sanctioned contract demand from utility bill.',
    },
    {
      key: 'voltage',
      label: 'Supply Voltage Category',
      category: 'REQUIRED',
      isSatisfied: Boolean(config.voltageCategory),
      status: config.voltageCategory ? 'READY' : 'MISSING',
      evidenceSource: 'sites.voltage_category',
      currentValue: config.voltageCategory || 'Not specified',
      remediationAction: 'Select supply voltage level (e.g. 11kV, 33kV, 66kV).',
    },
    {
      key: 'historical_load',
      label: 'Validated 15-Minute Load History (7 Days)',
      category: 'RECOMMENDED',
      isSatisfied: validIntervalHistory,
      status: demoEvidence ? 'DEMO_UNVERIFIED'
        : validIntervalHistory ? 'READY'
        : config.intervalDaysCount ? 'NOT_VERIFIED' : 'MISSING',
      evidenceSource: 'data_quality_evaluations / interval_data_96',
      currentValue: demoEvidence
        ? 'Demo / unverified'
        : `${config.intervalDaysCount || 0} validated complete day(s)${config.latestIntervalDate ? `; latest ${config.latestIntervalDate}` : ''}`,
      remediationAction: 'Upload at least 7 complete, validated 96-block operating days; 30 days is recommended for stronger baselines.',
    },
    {
      key: 'interval_freshness',
      label: 'Current Interval Evidence Freshness',
      category: 'REQUIRED',
      isSatisfied: freshIntervalEvidence,
      status: demoEvidence ? 'DEMO_UNVERIFIED'
        : freshIntervalEvidence ? 'READY'
        : config.intervalFreshnessStatus === 'STALE' || config.intervalFreshnessStatus === 'DELAYED' ? 'STALE'
        : config.intervalDaysCount ? 'NOT_VERIFIED' : 'MISSING',
      evidenceSource: 'data_quality_evaluations.freshness_status',
      currentValue: demoEvidence ? 'Demo / unverified' : config.intervalFreshnessStatus || 'UNKNOWN',
      remediationAction: 'Upload or restore a validated current operating-day feed within the published freshness window.',
    },
    {
      key: 'alert_recipient',
      label: 'Operational Alert Recipient',
      category: 'REQUIRED',
      isSatisfied: !demoEvidence && Boolean(config.hasAlertRecipient),
      status: demoEvidence ? 'DEMO_UNVERIFIED' : config.hasAlertRecipient ? 'READY' : 'MISSING',
      evidenceSource: 'Persisted alert-recipient configuration',
      currentValue: demoEvidence ? 'Demo / unverified' : config.hasAlertRecipient ? 'Configured' : 'No configured recipient',
      remediationAction: 'Add at least one plant operator or energy manager email for alerts.',
    },
    {
      key: 'solar_config',
      label: 'Onsite Solar PV Capacity',
      category: 'OPTIONAL',
      isSatisfied: !demoEvidence && Boolean(config.hasSolarAsset),
      status: demoEvidence ? 'DEMO_UNVERIFIED' : config.hasSolarAsset ? 'READY' : 'MISSING',
      evidenceSource: 'renewable_assets (active site asset)',
      currentValue: demoEvidence ? 'Demo / unverified' : config.hasSolarAsset ? 'Configured' : 'None',
      remediationAction: 'Add rooftop solar plant details to evaluate self-consumption evidence.',
    },
    {
      key: 'bess_config',
      label: 'Battery Storage (BESS) Asset',
      category: 'OPTIONAL',
      isSatisfied: !demoEvidence && Boolean(config.hasBessAsset),
      status: demoEvidence ? 'DEMO_UNVERIFIED' : config.hasBessAsset ? 'READY' : 'MISSING',
      evidenceSource: 'bess_assets (active site asset)',
      currentValue: demoEvidence ? 'Demo / unverified' : config.hasBessAsset ? 'Configured' : 'None',
      remediationAction: 'Configure a physical battery asset to enable operational BESS readiness.',
    },
  ];

  const requiredItems = items.filter((item) => item.category === 'REQUIRED');
  const satisfiedRequiredCount = requiredItems.filter((item) => item.isSatisfied).length;
  return {
    isReadyForMonitoring: requiredItems.every((item) => item.isSatisfied),
    readinessPct: Math.round((satisfiedRequiredCount / requiredItems.length) * 100),
    items,
  };
}
