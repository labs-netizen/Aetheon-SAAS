/**
 * Energy, Power and Physical Unit Formatting Utilities.
 * Strictly prevents ambiguous numeric displays and prevents kW/MW and kWh/MWh confusion.
 */

export function formatPower(kw: number, preferredUnit: 'kW' | 'MW' | 'auto' = 'auto'): string {
  if (isNaN(kw)) return '0 kW';
  if (preferredUnit === 'MW' || (preferredUnit === 'auto' && Math.abs(kw) >= 1000)) {
    return `${(kw / 1000).toFixed(2)} MW`;
  }
  return `${kw.toFixed(1)} kW`;
}

export function formatEnergy(kwh: number, preferredUnit: 'kWh' | 'MWh' | 'auto' = 'auto'): string {
  if (isNaN(kwh)) return '0 kWh';
  if (preferredUnit === 'MWh' || (preferredUnit === 'auto' && Math.abs(kwh) >= 1000)) {
    return `${(kwh / 1000).toFixed(2)} MWh`;
  }
  return `${kwh.toFixed(1)} kWh`;
}

export function formatPercentage(pct: number, decimals = 1): string {
  if (isNaN(pct)) return '0%';
  return `${pct.toFixed(decimals)}%`;
}

export function formatEmissions(tco2e: number): string {
  if (isNaN(tco2e)) return '0 tCO₂e';
  return `${tco2e.toFixed(2)} tCO₂e`;
}

export function formatSoc(socPct: number): string {
  if (isNaN(socPct)) return '0% SOC';
  return `${Math.round(socPct)}% SOC`;
}
