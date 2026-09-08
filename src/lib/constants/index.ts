/**
 * Global domain constants for Aetheon Energy Intelligence Platform.
 */

export const PRODUCTS = {
  GRID_INTELLIGENCE: {
    id: 'GRID_INTELLIGENCE',
    name: 'Grid Intelligence Monitor',
    basePricePaise: 1990000, // ₹19,900
    displayPrice: '₹19,900/site/month',
    description: '96-block price & demand forecast, Daily Grid Brief, and landed cost optimization.',
    availabilityStatus: 'INTERNAL_VALIDATION',
  },
  OA_COMPLIANCE: {
    id: 'OA_COMPLIANCE',
    name: 'Open Access Compliance Sentinel',
    basePricePaise: 1490000, // ₹14,900
    displayPrice: '₹14,900/state/site/month',
    description: 'Statutory compliance tracking, DISCOM charges (CSS, AS, Wheeling), and SLDC calendar.',
    availabilityStatus: 'SPECIALIST_REVIEW_REQUIRED',
  },
  DSM_RISK: {
    id: 'DSM_RISK',
    name: 'DSM Risk Monitor',
    basePricePaise: 2990000, // ₹29,900
    displayPrice: '₹29,900/site/month',
    description: '15-minute deviation monitoring, risk bands, and penalty exposure under CERC/SERC DSM.',
    availabilityStatus: 'INTERNAL_VALIDATION',
  },
  BESS_ARBITRAGE: {
    id: 'BESS_ARBITRAGE',
    name: 'BESS Arbitrage Signals',
    basePricePaise: 4990000, // ₹49,900
    displayPrice: '₹49,900/site/month',
    description: 'Advisory charge/discharge opportunity window recommendations for C&I batteries.',
    availabilityStatus: 'SPECIALIST_REVIEW_REQUIRED',
  },
  RENEWABLE_PORTFOLIO: {
    id: 'RENEWABLE_PORTFOLIO',
    name: 'Renewable Portfolio Monitor',
    basePricePaise: 2490000, // ₹24,900
    displayPrice: '₹24,900/site/month',
    description: 'Solar reconciliation (measured/modelled/estimated) and carbon avoidance ledger.',
    availabilityStatus: 'DEMO',
  },
} as const;

export const INDIAN_STATES = [
  { name: 'Maharashtra', discoms: ['MSEDCL', 'Tata Power (Mumbai)', 'Adani Electricity'] },
  { name: 'Gujarat', discoms: ['UGVCL', 'DGVCL', 'MGVCL', 'PGVCL', 'Torrent Power'] },
  { name: 'Uttar Pradesh', discoms: ['PVVNL', 'MVVNL', 'DVVNL', 'PuVVNL', 'KESCO'] },
  { name: 'Karnataka', discoms: ['BESCOM', 'MESCOM', 'HESCOM', 'CESC'] },
  { name: 'Tamil Nadu', discoms: ['TANGEDCO'] },
  { name: 'Rajasthan', discoms: ['JVVNL', 'AVVNL', 'JdVVNL'] },
  { name: 'Haryana', discoms: ['DHBVN', 'UHBVN'] },
] as const;

export const VOLTAGE_CATEGORIES = ['11kV', '22kV', '33kV', '66kV', '110kV', '132kV', '220kV'] as const;

export const LOAD_CLASSES = [
  'Continuous Process Industrial (Chemical, Cement, Steel)',
  'Batch Manufacturing & Engineering',
  'Automotive & Ancillary',
  'Textiles & Spinning',
  'Commercial IT Park / Data Center',
  'Cold Storage & Agro Processing',
] as const;

export { CANONICAL_ROLES, ROLE_ALIASES, reconcileRole, isInternalAetheonRole, isCustomerRole } from '../auth/roles';

