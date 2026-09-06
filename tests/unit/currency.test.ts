import { describe, it, expect } from 'vitest';
import { formatPaiseToInr, inrToPaise, formatTariffRate } from '@/lib/units/currency';

describe('Currency and Integer Paise Calculations', () => {
  it('should convert INR to integer paise correctly', () => {
    expect(inrToPaise(19900)).toBe(1990000);
    expect(inrToPaise(7.45)).toBe(745);
    expect(inrToPaise(0.01)).toBe(1);
  });

  it('should format integer paise into INR string', () => {
    const formatted = formatPaiseToInr(1990000);
    expect(formatted).toContain('19,900');
    expect(formatted).toContain('₹');
  });

  it('should format tariff rate with units', () => {
    expect(formatTariffRate(7.45)).toBe('₹7.45/kWh');
    expect(formatTariffRate(4800, 'MWh')).toBe('₹4800.00/MWh');
  });
});
