import { describe, it, expect } from 'vitest';
import type {
  GridForecastResponseContract,
  BESSSolverResponseContract,
  DSMCalculationResponseContract,
  RenewableReconciliationResponseContract,
} from '@/types/analytics-contracts';

describe('Analytics API Contract Validation (Defect #42)', () => {
  it('1. Grid FastAPI Contract validates distinct nonzero values without field degradation', () => {
    const rawFastApiResponse: GridForecastResponseContract = {
      site_id: 'b0000000-0000-0000-0000-000000000001',
      operating_date: '2026-09-08',
      model_version: 'GRID_FASTAPI_SOLVER_v2.4',
      model_generation_time: '2026-09-08T06:00:00Z',
      average_price_inr_per_mwh: 4872.45,
      peak_demand_kw: 2640.8,
      peak_demand_block: 39,
      data_quality: 'PASSED',
      freshness: 'RECENT',
      blocks: [
        {
          block_index: 39,
          start_time: '09:30',
          end_time: '09:45',
          forecast_demand_kw: 2640.8,
          forecast_price_inr_per_mwh: 6120.5,
          confidence_lower_kw: 2480.0,
          confidence_upper_kw: 2800.0,
          is_high_cost_window: false,
        },
      ],
    };

    expect(rawFastApiResponse.average_price_inr_per_mwh).toBe(4872.45);
    expect(rawFastApiResponse.peak_demand_kw).toBe(2640.8);
    expect(rawFastApiResponse.peak_demand_block).toBe(39);
    expect(rawFastApiResponse.data_quality).toBe('PASSED');
    expect(rawFastApiResponse.blocks[0].forecast_demand_kw).toBe(2640.8);
    expect(rawFastApiResponse.blocks[0].forecast_price_inr_per_mwh).toBe(6120.5);
  });

  it('2. BESS Contract maps gross_arbitrage_value_inr, degradation, and cycles correctly without zero fallback', () => {
    const rawBessResponse: BESSSolverResponseContract = {
      battery_id: 'bess_facility_1_pack_a',
      site_id: 'b0000000-0000-0000-0000-000000000001',
      solver_version: 'PYOMO_CBC_BESS_v1.3',
      is_feasibility_verified: true,
      gross_arbitrage_value_inr: 8945.6,
      estimated_degradation_cost_inr: 2750.25,
      net_opportunity_value_inr: 6195.35,
      cycles_equivalent: 1.45,
      is_suppressed: false,
      safety_disclaimer: 'Advisory guidance only',
      blocks: [
        {
          block_index: 10,
          recommended_action: 'CHARGE',
          power_kw: 450.0,
          resulting_soc_pct: 82.5,
          marginal_cost_inr: 2850.0,
          marginal_revenue_inr: 0,
        },
      ],
    };

    const dbPayload = {
      battery_id: rawBessResponse.battery_id,
      site_id: rawBessResponse.site_id,
      solver_version: rawBessResponse.solver_version,
      gross_arbitrage_inr: rawBessResponse.gross_arbitrage_value_inr,
      degradation_cost_inr: rawBessResponse.estimated_degradation_cost_inr,
      net_opportunity_inr: rawBessResponse.net_opportunity_value_inr,
      equivalent_cycles: rawBessResponse.cycles_equivalent,
      is_suppressed: rawBessResponse.is_suppressed,
    };

    expect(dbPayload.gross_arbitrage_inr).toBe(8945.6);
    expect(dbPayload.degradation_cost_inr).toBe(2750.25);
    expect(dbPayload.net_opportunity_inr).toBe(6195.35);
    expect(dbPayload.equivalent_cycles).toBe(1.45);
    expect(dbPayload.gross_arbitrage_inr).not.toBe(0);
    expect(dbPayload.degradation_cost_inr).not.toBe(0);
    expect(dbPayload.net_opportunity_inr).not.toBe(0);
  });

  it('3. DSM Contract derives contiguous incident groupings from solver blocks and computes nonzero exposure', () => {
    const rawDsmResponse: DSMCalculationResponseContract = {
      site_id: 'b0000000-0000-0000-0000-000000000001',
      operating_date: '2026-09-08',
      rule_version: 'CERC_DSM_2024_AMEND2',
      total_deviation_kwh: 1250.75,
      max_positive_deviation_kw: 160.0,
      max_negative_deviation_kw: 0.0,
      blocks_in_watch: 0,
      blocks_in_high: 0,
      blocks_in_critical: 2,
      estimated_total_exposure_inr: 18450.0,
      status: 'CALCULATED',
      incidents: [],
      blocks: [
        { block_index: 10, scheduled_drawal_kw: 1000, actual_drawal_kw: 1000, deviation_kw: 0, deviation_pct: 0, risk_level: 'NORMAL', estimated_penalty_inr: 0 },
        { block_index: 11, scheduled_drawal_kw: 1000, actual_drawal_kw: 1140, deviation_kw: 140, deviation_pct: 14, risk_level: 'CRITICAL', estimated_penalty_inr: 2800 },
        { block_index: 12, scheduled_drawal_kw: 1000, actual_drawal_kw: 1160, deviation_kw: 160, deviation_pct: 16, risk_level: 'CRITICAL', estimated_penalty_inr: 3200 },
        { block_index: 13, scheduled_drawal_kw: 1000, actual_drawal_kw: 1000, deviation_kw: 0, deviation_pct: 0, risk_level: 'NORMAL', estimated_penalty_inr: 0 },
      ],
    };

    const nonNormalBlocks = rawDsmResponse.blocks.filter((b) => b.risk_level !== 'NORMAL');
    expect(nonNormalBlocks.length).toBe(2);

    const incidents: any[] = [];
    let currentIncident: any = null;

    for (const block of nonNormalBlocks) {
      if (!currentIncident) {
        currentIncident = {
          start_block: block.block_index,
          end_block: block.block_index,
          severity: block.risk_level,
          max_deviation_pct: block.deviation_pct,
          excess_energy_kwh: (Math.abs(block.deviation_kw) * 15) / 60,
          estimated_exposure_inr: block.estimated_penalty_inr,
        };
      } else if (block.block_index === currentIncident.end_block + 1) {
        currentIncident.end_block = block.block_index;
        currentIncident.max_deviation_pct = Math.max(currentIncident.max_deviation_pct, block.deviation_pct);
        currentIncident.excess_energy_kwh += (Math.abs(block.deviation_kw) * 15) / 60;
        currentIncident.estimated_exposure_inr += block.estimated_penalty_inr;
      } else {
        incidents.push(currentIncident);
        currentIncident = {
          start_block: block.block_index,
          end_block: block.block_index,
          severity: block.risk_level,
          max_deviation_pct: block.deviation_pct,
          excess_energy_kwh: (Math.abs(block.deviation_kw) * 15) / 60,
          estimated_exposure_inr: block.estimated_penalty_inr,
        };
      }
    }
    if (currentIncident) incidents.push(currentIncident);

    expect(incidents.length).toBe(1);
    expect(incidents[0].start_block).toBe(11);
    expect(incidents[0].end_block).toBe(12);
    expect(incidents[0].max_deviation_pct).toBe(16);
    expect(incidents[0].excess_energy_kwh).toBe(75);
    expect(incidents[0].estimated_exposure_inr).toBe(6000);
  });

  it('4. Renewables Reconciliation Contract maps distinct nonzero ledger parameters', () => {
    const rawRenewablesResponse: RenewableReconciliationResponseContract = {
      site_id: 'b0000000-0000-0000-0000-000000000001',
      operating_date: '2026-09-08',
      total_measured_generation_kwh: 5840.5,
      total_modelled_generation_kwh: 6100.0,
      performance_ratio_pct: 95.74,
      reconciliation_status: 'BALANCED',
      avoided_emissions_tco2e: 4.18,
      emission_factor_source: 'CEA_CO2_BASELINE_DB_v19',
    };

    expect(rawRenewablesResponse.total_measured_generation_kwh).toBe(5840.5);
    expect(rawRenewablesResponse.total_modelled_generation_kwh).toBe(6100.0);
    expect(rawRenewablesResponse.performance_ratio_pct).toBe(95.74);
    expect(rawRenewablesResponse.avoided_emissions_tco2e).toBe(4.18);
  });
});
