/**
 * Tariff & Open Access Landed Cost Calculator
 * Computes multi-component landed energy cost per 15-minute block.
 * Includes fixed charges, energy charges, ToD slabs, CSS, AS, wheeling, transmission, and banking.
 */

export interface TariffSchedule {
  state: string;
  discom: string;
  voltageCategory: string;
  categoryName: string;
  fixedChargePerKvaMonth: number;
  energyChargeNormalPerKwh: number;
  todPeakSurchargePct: number;
  todOffPeakRebatePct: number;
  peakBlocks: number[]; // Block indices 1-96 in peak window
  offPeakBlocks: number[]; // Block indices 1-96 in off-peak window
  effectiveFrom: string;
  effectiveUntil?: string;
  isDemo?: boolean;
}

export interface OpenAccessCharges {
  crossSubsidySurchargePerKwh: number;
  additionalSurchargePerKwh: number;
  wheelingChargePerKwh: number;
  transmissionChargePerKwh: number;
  bankingChargePct: number;
  isDemo?: boolean;
}

export interface BlockCostBreakdown {
  blockIndex: number;
  energyKwh: number;
  baseEnergyCostInr: number;
  todAdjustmentInr: number;
  fixedChargeAllocatedInr: number;
  cssInr: number;
  additionalSurchargeInr: number;
  wheelingInr: number;
  transmissionInr: number;
  bankingCostInr: number;
  totalLandedCostInr: number;
  effectiveRateInrPerKwh: number;
}

/**
 * Default MSEDCL HT-1 Industrial Demo Tariff (FY 2024-25 Synthetic)
 */
export const DEFAULT_MSEDCL_DEMO_TARIFF: TariffSchedule = {
  state: 'Maharashtra',
  discom: 'MSEDCL',
  voltageCategory: '33kV',
  categoryName: 'HT-1 Industrial (Continuous)',
  fixedChargePerKvaMonth: 450.0,
  energyChargeNormalPerKwh: 7.45,
  todPeakSurchargePct: 20.0,
  todOffPeakRebatePct: 15.0,
  peakBlocks: [73, 74, 75, 76, 77, 78, 79, 80, 81, 82], // 18:00 - 20:30 IST
  offPeakBlocks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22], // 00:00 - 05:30 IST
  effectiveFrom: '2024-04-01',
  isDemo: true,
};

export const DEFAULT_OA_DEMO_CHARGES: OpenAccessCharges = {
  crossSubsidySurchargePerKwh: 1.48,
  additionalSurchargePerKwh: 1.15,
  wheelingChargePerKwh: 0.64,
  transmissionChargePerKwh: 0.38,
  bankingChargePct: 8.0,
  isDemo: true,
};

/**
 * Calculate cost breakdown for a specific 15-minute block
 */
export function calculateBlockLandedCost(
  blockIndex: number,
  energyKwh: number,
  contractDemandKva: number,
  tariff: TariffSchedule = DEFAULT_MSEDCL_DEMO_TARIFF,
  oaCharges: OpenAccessCharges = DEFAULT_OA_DEMO_CHARGES,
  isOpenAccess = false
): BlockCostBreakdown {
  const safeKwh = Math.max(0, energyKwh);

  // 1. Base Energy Cost
  const baseEnergyCost = safeKwh * tariff.energyChargeNormalPerKwh;

  // 2. ToD adjustment
  let todAdjustment = 0;
  if (tariff.peakBlocks.includes(blockIndex)) {
    todAdjustment = baseEnergyCost * (tariff.todPeakSurchargePct / 100.0);
  } else if (tariff.offPeakBlocks.includes(blockIndex)) {
    todAdjustment = -baseEnergyCost * (tariff.todOffPeakRebatePct / 100.0);
  }

  // 3. Fixed charge allocation (Monthly charge spread over 30 days * 96 blocks)
  const totalBlocksInMonth = 30 * 96;
  const fixedChargeAllocated = (contractDemandKva * tariff.fixedChargePerKvaMonth) / totalBlocksInMonth;

  // 4. Open Access Landed charges if applicable
  let css = 0;
  let addSurcharge = 0;
  let wheeling = 0;
  let transmission = 0;
  let bankingCost = 0;

  if (isOpenAccess && safeKwh > 0) {
    css = safeKwh * oaCharges.crossSubsidySurchargePerKwh;
    addSurcharge = safeKwh * oaCharges.additionalSurchargePerKwh;
    wheeling = safeKwh * oaCharges.wheelingChargePerKwh;
    transmission = safeKwh * oaCharges.transmissionChargePerKwh;
    bankingCost = safeKwh * (oaCharges.bankingChargePct / 100.0) * tariff.energyChargeNormalPerKwh;
  }

  const totalCost = isOpenAccess
    ? css + addSurcharge + wheeling + transmission + bankingCost + fixedChargeAllocated
    : baseEnergyCost + todAdjustment + fixedChargeAllocated;

  const effectiveRate = safeKwh > 0 ? totalCost / safeKwh : 0;

  return {
    blockIndex,
    energyKwh: safeKwh,
    baseEnergyCostInr: Number(baseEnergyCost.toFixed(2)),
    todAdjustmentInr: Number(todAdjustment.toFixed(2)),
    fixedChargeAllocatedInr: Number(fixedChargeAllocated.toFixed(2)),
    cssInr: Number(css.toFixed(2)),
    additionalSurchargeInr: Number(addSurcharge.toFixed(2)),
    wheelingInr: Number(wheeling.toFixed(2)),
    transmissionInr: Number(transmission.toFixed(2)),
    bankingCostInr: Number(bankingCost.toFixed(2)),
    totalLandedCostInr: Number(totalCost.toFixed(2)),
    effectiveRateInrPerKwh: Number(effectiveRate.toFixed(4)),
  };
}
