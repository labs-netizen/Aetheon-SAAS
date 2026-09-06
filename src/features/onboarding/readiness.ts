/**
 * Module-Aware Data Readiness Evaluator
 * Checks Required, Recommended, and Optional prerequisites per module.
 */

export interface ReadinessItem {
  key: string;
  label: string;
  category: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  isSatisfied: boolean;
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
  hasOpenAccessContract?: boolean;
  hasSolarAsset?: boolean;
  hasBessAsset?: boolean;
  hasAlertRecipient?: boolean;
}

export function evaluateGridReadiness(config: SiteOperationalConfig): {
  isReadyForMonitoring: boolean;
  readinessPct: number;
  items: ReadinessItem[];
} {
  const items: ReadinessItem[] = [
    {
      key: 'state_discom',
      label: 'State & DISCOM Jurisdiction',
      category: 'REQUIRED',
      isSatisfied: !!(config.state && config.discom),
      currentValue: config.state && config.discom ? `${config.state} (${config.discom})` : 'Not configured',
      remediationAction: 'Select plant state and operating DISCOM in site settings.',
    },
    {
      key: 'contract_demand',
      label: 'Contract Demand (kVA/MVA)',
      category: 'REQUIRED',
      isSatisfied: !!(config.contractDemandValue && config.contractDemandValue > 0),
      currentValue: config.contractDemandValue ? `${config.contractDemandValue} kVA` : 'Missing',
      remediationAction: 'Enter sanctioned contract demand from utility bill.',
    },
    {
      key: 'voltage',
      label: 'Supply Voltage Category',
      category: 'REQUIRED',
      isSatisfied: !!config.voltageCategory,
      currentValue: config.voltageCategory || 'Not specified',
      remediationAction: 'Select supply voltage level (e.g. 11kV, 33kV, 66kV).',
    },
    {
      key: 'alert_recipient',
      label: 'Operational Alert Recipient',
      category: 'REQUIRED',
      isSatisfied: !!config.hasAlertRecipient,
      currentValue: config.hasAlertRecipient ? 'Configured' : 'No recipient',
      remediationAction: 'Add at least one plant operator or energy manager email for alerts.',
    },
    {
      key: 'historical_load',
      label: 'Historical 15-Minute Load Data (30 Days)',
      category: 'RECOMMENDED',
      isSatisfied: !!(config.intervalDaysCount && config.intervalDaysCount >= 30),
      currentValue: config.intervalDaysCount ? `${config.intervalDaysCount} days` : '0 days',
      remediationAction: 'Upload 30 days of AMR meter interval data for accurate baseline forecasting.',
    },
    {
      key: 'solar_config',
      label: 'Onsite Solar PV Capacity',
      category: 'OPTIONAL',
      isSatisfied: !!config.hasSolarAsset,
      currentValue: config.hasSolarAsset ? 'Configured' : 'None',
      remediationAction: 'Add rooftop solar plant details to evaluate self-consumption savings.',
    },
    {
      key: 'bess_config',
      label: 'Battery Storage (BESS) Asset',
      category: 'OPTIONAL',
      isSatisfied: !!config.hasBessAsset,
      currentValue: config.hasBessAsset ? 'Configured' : 'None',
      remediationAction: 'Configure battery capacity and C-rate to enable arbitrage optimization.',
    },
  ];

  const requiredItems = items.filter((i) => i.category === 'REQUIRED');
  const isReady = requiredItems.every((i) => i.isSatisfied);

  const satisfiedCount = items.filter((i) => i.isSatisfied).length;
  const readinessPct = Math.round((satisfiedCount / items.length) * 100);

  return {
    isReadyForMonitoring: isReady,
    readinessPct,
    items,
  };
}
