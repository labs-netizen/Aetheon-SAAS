import { createAdminClient } from '@/lib/supabase/admin';
import { finiteNumber, validDate } from '@/lib/analytics/domain-safety';

export interface ApplicableRegulatoryParams {
  state: string; discom: string; voltageCategory: string; operatingDate: string;
  throughDate?: string; isDemo?: boolean;
}
export interface RegulatoryResolutionResult {
  hasApprovedData: boolean; applicableSource: any | null; approvedSources: any[];
  applicableCharge: any | null; applicableTariff: any | null;
  status: 'RESOLVED' | 'DATA_GAP' | 'CONFIG_REQUIRED'; gapReason?: string;
}

export function sourceApplies(s: any, p: ApplicableRegulatoryParams): boolean {
  const end = p.throughDate || p.operatingDate;
  if (!s || !['APPROVED','PUBLISHED'].includes(s.status) || s.is_demo !== (p.isDemo === true) ||
      !s.id || !s.version || !/^https?:\/\//.test(s.source_url || '') || !s.approved_by ||
      !Number.isFinite(Date.parse(s.approved_at)) || Date.parse(s.approved_at) > Date.now() ||
      !validDate(s.document_date) || !validDate(s.effective_date) ||
      s.document_date > p.operatingDate || s.effective_date > p.operatingDate ||
      (s.expiry_date !== null && (!validDate(s.expiry_date) || s.expiry_date < end))) return false;
  const national = ['CERC','CEA','National'].includes(s.jurisdiction);
  return (s.state === p.state || ((!s.state || s.state === 'National') && national)) &&
    (!s.discom || s.discom === p.discom) && (national || s.jurisdiction === p.state);
}

export async function resolveApplicableRegulatoryParameters(p: ApplicableRegulatoryParams): Promise<RegulatoryResolutionResult> {
  const gap = (reason: string): RegulatoryResolutionResult => ({ hasApprovedData: false, applicableSource: null,
    approvedSources: [], applicableCharge: null, applicableTariff: null, status: 'DATA_GAP', gapReason: reason });
  const end = p.throughDate || p.operatingDate;
  if (!p.state || !p.discom || !p.voltageCategory || !validDate(p.operatingDate) || !validDate(end) || end < p.operatingDate)
    return gap('Site jurisdiction, voltage and valid operating period are required.');
  const db = createAdminClient();
  // Query every overlapping record: a newer overlapping version is an ambiguity, not a silent override.
  const results = await Promise.all(['open_access_charges','discom_tariffs'].map(table => db.from(table)
    .select('*, regulatory_sources!inner(*)').eq('state',p.state).eq('discom',p.discom)
    .eq('voltage_category',p.voltageCategory).lte('effective_from',end)
    .or(`effective_until.is.null,effective_until.gte.${p.operatingDate}`)));
  if (results.some(r => r.error)) return gap('Regulatory evidence could not be verified.');
  const chosen: any[] = [];
  for (let i=0; i<results.length; i++) {
    const candidates = (results[i].data || []).filter((r: any) => {
      const s = r.regulatory_sources;
      return r.state === p.state && r.discom === p.discom && r.voltage_category === p.voltageCategory &&
        r.is_demo === (p.isDemo === true) && r.regulatory_source_id === s?.id &&
        ['APPROVED','PUBLISHED'].includes(s?.status) && s.is_demo === (p.isDemo === true) &&
        s.regulatory_domain === (i === 0 ? 'OPEN_ACCESS' : 'TARIFF') &&
        validDate(r.effective_from) && r.effective_from <= end && (!r.effective_until || r.effective_until >= p.operatingDate);
    });
    if (candidates.length !== 1) return gap('Missing or overlapping approved versions for the requested voltage and period.');
    const r = candidates[0];
    if (!sourceApplies(r.regulatory_sources,p) || r.effective_from > p.operatingDate ||
        (r.effective_until !== null && (!validDate(r.effective_until) || r.effective_until < end)))
      return gap('Source approval or effective dates do not establish authority for the entire period.');
    const fields = i === 0 ? ['cross_subsidy_surcharge_inr_per_kwh','additional_surcharge_inr_per_kwh',
      'wheeling_charge_inr_per_kwh','transmission_charge_inr_per_kwh','banking_charge_pct'] :
      ['energy_charge_normal_inr_per_kwh','fixed_charge_inr_per_kva_month'];
    if (!fields.every(k => finiteNumber(r[k]) && Number(r[k]) >= 0) || (i === 0 && Number(r.banking_charge_pct)>100))
      return gap('Approved numerical parameters are incomplete or invalid.');
    chosen.push(r);
  }
  const sources = Array.from(new Map(chosen.map(r => [r.regulatory_source_id,r.regulatory_sources])).values());
  return { hasApprovedData: true, applicableSource: chosen[0].regulatory_sources, approvedSources: sources,
    applicableCharge: chosen[0], applicableTariff: chosen[1], status: 'RESOLVED' };
}

export function applicableObligations(rows: any[], resolution: RegulatoryResolutionResult, p: ApplicableRegulatoryParams): any[] {
  if (resolution.status !== 'RESOLVED') return [];
  const sources = new Map(resolution.approvedSources.map(s => [s.id,s]));
  // Obligations have no voltage field; only a source bound to the resolved voltage can establish applicability.
  return rows.filter(r => r.is_demo === (p.isDemo === true) && r.state === p.state &&
    (!r.discom || r.discom === p.discom) && ['PENDING','IN_PROGRESS','COMPLETED'].includes(r.status) &&
    validDate(r.deadline_date) && r.deadline_date >= p.operatingDate &&
    sourceApplies(sources.get(r.regulatory_source_id), { ...p, operatingDate: r.deadline_date, throughDate: r.deadline_date }));
}
