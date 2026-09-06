/**
 * Currency handling utilities for Indian Rupee (INR).
 * All monetary amounts in database and calculations are stored in integer paise (1 INR = 100 paise)
 * to avoid floating-point rounding errors.
 */

/**
 * Format integer paise into standard Indian Rupee string (e.g. 1990000 -> "₹19,900.00").
 */
export function formatPaiseToInr(paise: number, includeDecimals = false): string {
  if (isNaN(paise)) return '₹0';
  const inr = paise / 100.0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: includeDecimals ? 2 : 0,
    maximumFractionDigits: includeDecimals ? 2 : 0,
  }).format(inr);
}

/**
 * Convert INR floating amount to integer paise.
 */
export function inrToPaise(inr: number): number {
  return Math.round(inr * 100);
}

/**
 * Format raw INR tariff rates (e.g. 7.45 -> "₹7.45/kWh").
 */
export function formatTariffRate(rateInr: number, unit = 'kWh'): string {
  return `₹${rateInr.toFixed(2)}/${unit}`;
}
