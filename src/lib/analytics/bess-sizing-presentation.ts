import type { BESSSizingCandidateContract, BESSSizingResponseContract } from '@/types/analytics-contracts';

export const BESS_SIZING_LABEL = 'HISTORICAL BESS SIZING SCREEN';
export const BESS_SIZING_WARNING = 'SINGLE-DAY HISTORICAL SIZING SCREEN — NOT SUFFICIENT FOR INVESTMENT SIZING';

export function sizingCandidate(result: BESSSizingResponseContract, capacity: number, power: number) {
  return result.candidates.find((item) => item.capacity_kwh === capacity && item.power_kw === power) || null;
}

export function sizingHeatmap(result: BESSSizingResponseContract) {
  const maximum = Math.max(0, ...result.candidates.map((item) => item.net_indicative_benefit_inr));
  return result.candidates.map((item) => ({ ...item,
    intensity: maximum > 0 ? Math.max(0, item.net_indicative_benefit_inr) / maximum : 0 }));
}

export function candidateName(candidate: Pick<BESSSizingCandidateContract, 'capacity_kwh'|'power_kw'>) {
  return `${candidate.capacity_kwh.toLocaleString()} kWh / ${candidate.power_kw.toLocaleString()} kW`;
}
