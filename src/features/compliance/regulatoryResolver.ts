/**
 * Canonical Regulatory Applicability Resolver
 * 
 * Strict approval gate: Only sources with status 'APPROVED' or 'PUBLISHED' may be returned to customer sessions.
 * Strict voltage & period matching: If no valid record exists for the exact voltage category and effective period,
 * returns null / DATA_GAP. NEVER substitutes an unmatching voltage category.
 */

import { createAdminClient } from '@/lib/supabase/admin';

export interface ApplicableRegulatoryParams {
  state: string;
  discom: string;
  voltageCategory: string;
  operatingDate: string;
}

export interface RegulatoryResolutionResult {
  hasApprovedData: boolean;
  applicableSource: any | null;
  approvedSources: any[];
  applicableCharge: any | null;
  applicableTariff: any | null;
  status: 'RESOLVED' | 'DATA_GAP' | 'CONFIG_REQUIRED';
  gapReason?: string;
}

export async function resolveApplicableRegulatoryParameters(
  params: ApplicableRegulatoryParams
): Promise<RegulatoryResolutionResult> {
  const { state, discom, voltageCategory, operatingDate } = params;
  const adminClient = createAdminClient();

  // 1. Fetch approved regulatory sources for state/discom
  const { data: regSources, error: regError } = await adminClient
    .from('regulatory_sources')
    .select('id, jurisdiction, document_title, version, status, document_date, effective_date')
    .or(`jurisdiction.eq.${state},jurisdiction.eq.CERC,jurisdiction.eq.National`)
    .in('status', ['APPROVED', 'PUBLISHED'])
    .order('document_date', { ascending: false });

  if (regError) {
    console.error('Failed to query regulatory sources:', regError);
  }

  // 2. Fetch applicable Open Access Charges (Strict Approval Gate + Strict Voltage Matching)
  const { data: chargesList, error: chargesErr } = await adminClient
    .from('open_access_charges')
    .select('*, regulatory_sources!inner(id, status)')
    .eq('state', state)
    .eq('discom', discom)
    .in('regulatory_sources.status', ['APPROVED', 'PUBLISHED'])
    .lte('effective_from', operatingDate)
    .order('effective_from', { ascending: false });

  if (chargesErr) {
    console.error('Failed to query open access charges:', chargesErr);
  }

  // Exact voltage match ONLY — zero fallback to chargesList[0]
  const applicableCharge = chargesList?.find(
    (c) =>
      c.voltage_category === voltageCategory &&
      (!c.effective_until || c.effective_until >= operatingDate)
  ) || null;

  // 3. Fetch applicable Retail DISCOM Tariffs (Strict Approval Gate + Strict Voltage Matching)
  const { data: tariffsList, error: tariffErr } = await adminClient
    .from('discom_tariffs')
    .select('*, regulatory_sources!inner(id, status)')
    .eq('state', state)
    .eq('discom', discom)
    .in('regulatory_sources.status', ['APPROVED', 'PUBLISHED'])
    .lte('effective_from', operatingDate)
    .order('effective_from', { ascending: false });

  if (tariffErr) {
    console.error('Failed to query DISCOM tariffs:', tariffErr);
  }

  // Exact voltage match ONLY — zero fallback to tariffsList[0]
  const applicableTariff = tariffsList?.find(
    (t) =>
      t.voltage_category === voltageCategory &&
      (!t.effective_until || t.effective_until >= operatingDate)
  ) || null;

  const hasApprovedSources = Boolean(regSources && regSources.length > 0);
  const isFullyResolved = Boolean(applicableCharge && applicableTariff);

  let status: 'RESOLVED' | 'DATA_GAP' | 'CONFIG_REQUIRED' = 'RESOLVED';
  let gapReason: string | undefined;

  if (!hasApprovedSources) {
    status = 'DATA_GAP';
    gapReason = `No approved regulatory source orders found for jurisdiction ${state} / ${discom}.`;
  } else if (!applicableTariff || !applicableCharge) {
    status = 'DATA_GAP';
    gapReason = `No approved tariff or open access charges found matching voltage ${voltageCategory} for operating date ${operatingDate}.`;
  }

  return {
    hasApprovedData: hasApprovedSources,
    applicableSource: regSources?.[0] || null,
    approvedSources: regSources || [],
    applicableCharge,
    applicableTariff,
    status,
    gapReason,
  };
}
