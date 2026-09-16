import type { BESSBehindMeterResponseContract } from '@/types/analytics-contracts';

export const BESS_SIMULATION_LABEL = 'BEHIND-THE-METER BESS ENERGY-SHIFT SIMULATION';
export const BESS_COMPONENT_LABEL = 'INDICATIVE IEX DAM ENERGY COMPONENT';

export function groupBessDispatch(result: BESSBehindMeterResponseContract) {
  const groups: Array<{ action: 'CHARGE' | 'DISCHARGE'; start_block: number; end_block: number; energy_kwh: number; peak_power_kw: number }> = [];
  result.charge_kw.forEach((charge, index) => {
    const discharge = result.discharge_kw[index];
    const action = charge > 1e-6 ? 'CHARGE' : discharge > 1e-6 ? 'DISCHARGE' : null;
    if (!action) return;
    const power = action === 'CHARGE' ? charge : discharge;
    const previous = groups.at(-1);
    if (previous?.action === action && previous.end_block === index) {
      previous.end_block = index + 1;
      previous.energy_kwh += power * 0.25;
      previous.peak_power_kw = Math.max(previous.peak_power_kw, power);
    } else {
      groups.push({ action, start_block: index + 1, end_block: index + 1, energy_kwh: power * 0.25, peak_power_kw: power });
    }
  });
  return groups;
}
