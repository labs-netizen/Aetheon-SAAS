import { NextRequest, NextResponse } from 'next/server';
import { fetchBESSAdvisory } from '@/lib/analytics/client';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      batteryId,
      siteId,
      operatingDate,
      usableCapacityKwh,
      powerRatingKw,
      initialSocPct,
      minSocPct,
      maxSocPct,
      chargeEfficiency,
      dischargeEfficiency,
      degradationCostPerCycleInr,
      pricesInrPerMwh,
      maintenanceLockActive,
      telemetryStale,
      interconnectionRestricted,
    } = body;

    if (!batteryId || !siteId || !operatingDate || !usableCapacityKwh || !powerRatingKw || !pricesInrPerMwh) {
      return NextResponse.json(
        { error: 'Missing required BESS optimization parameters' },
        { status: 400 }
      );
    }

    // 1. Authorize: User Authentication, Org Membership, Site Access, Product Entitlement
    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'BESS_ARBITRAGE',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    // 2. Section 12: Backend Safety Interlock & Suppression Enforcement
    // Hard-disable recommendation if SOC unknown/invalid, maintenance lock active, telemetry stale, or interconnection conflict
    if (initialSocPct === null || initialSocPct === undefined || initialSocPct < 0 || initialSocPct > 100) {
      return NextResponse.json({
        battery_id: batteryId,
        operating_date: operatingDate,
        is_suppressed: true,
        suppression_reason: 'SAFETY_INTERLOCK: State of Charge (SOC) unknown or invalid. Advisory signals hard-inhibited.',
        gross_arbitrage_inr: 0,
        degradation_cost_inr: 0,
        net_opportunity_inr: 0,
        equivalent_cycles: 0,
        schedule_blocks: [],
      });
    }

    if (maintenanceLockActive === true) {
      return NextResponse.json({
        battery_id: batteryId,
        operating_date: operatingDate,
        is_suppressed: true,
        suppression_reason: 'SAFETY_INTERLOCK: Asset maintenance lock active. Battery dispatch prohibited.',
        gross_arbitrage_inr: 0,
        degradation_cost_inr: 0,
        net_opportunity_inr: 0,
        equivalent_cycles: 0,
        schedule_blocks: [],
      });
    }

    if (telemetryStale === true) {
      return NextResponse.json({
        battery_id: batteryId,
        operating_date: operatingDate,
        is_suppressed: true,
        suppression_reason: 'SAFETY_INTERLOCK: Telemetry stale (> 15 minutes). Signals suppressed.',
        gross_arbitrage_inr: 0,
        degradation_cost_inr: 0,
        net_opportunity_inr: 0,
        equivalent_cycles: 0,
        schedule_blocks: [],
      });
    }

    if (interconnectionRestricted === true) {
      return NextResponse.json({
        battery_id: batteryId,
        operating_date: operatingDate,
        is_suppressed: true,
        suppression_reason: 'SAFETY_INTERLOCK: Interconnection or SLDC export restriction active.',
        gross_arbitrage_inr: 0,
        degradation_cost_inr: 0,
        net_opportunity_inr: 0,
        equivalent_cycles: 0,
        schedule_blocks: [],
      });
    }

    // 3. Call FastAPI analytics microservice
    let advisoryResult: any;
    try {
      advisoryResult = await fetchBESSAdvisory({
        batteryId,
        siteId,
        operatingDate,
        usableCapacityKwh,
        powerRatingKw,
        initialSocPct: initialSocPct ?? 50,
        minSocPct: minSocPct ?? 10,
        maxSocPct: maxSocPct ?? 90,
        chargeEfficiency,
        dischargeEfficiency,
        degradationCostPerCycleInr,
        pricesInrPerMwh,
      });
    } catch (apiErr) {
      return NextResponse.json(
        {
          error: 'ANALYTICS_SERVICE_UNAVAILABLE',
          details: apiErr instanceof Error ? apiErr.message : String(apiErr),
        },
        { status: 502 }
      );
    }

    // 4. Persist to bess_signal_runs safely via service client
    const adminClient = createAdminClient();
    try {
      const grossArbitrage = advisoryResult.gross_arbitrage_value_inr ?? advisoryResult.gross_arbitrage_inr ?? 0;
      const degradationCost = advisoryResult.estimated_degradation_cost_inr ?? advisoryResult.degradation_cost_inr ?? 0;
      const netOpportunity = advisoryResult.net_opportunity_value_inr ?? advisoryResult.net_opportunity_inr ?? 0;
      const cyclesEquivalent = advisoryResult.cycles_equivalent ?? advisoryResult.equivalent_cycles ?? 0;

      const { error: persistError } = await adminClient
        .from('bess_signal_runs')
        .upsert(
          {
            battery_id: batteryId,
            operating_date: operatingDate,
            solver_version: advisoryResult.solver_version || 'BESS_ADVISORY_HEURISTIC_DEMO_v1.0',
            gross_arbitrage_inr: grossArbitrage,
            degradation_cost_inr: degradationCost,
            net_opportunity_inr: netOpportunity,
            equivalent_cycles: cyclesEquivalent,
            is_suppressed: advisoryResult.is_suppressed || false,
            suppression_reason: advisoryResult.suppression_reason || null,
          },
          { onConflict: 'battery_id,operating_date' }
        );

      if (persistError) {
        throw new Error(persistError.message);
      }

      advisoryResult.gross_arbitrage_inr = grossArbitrage;
      advisoryResult.gross_arbitrage_value_inr = grossArbitrage;
      advisoryResult.degradation_cost_inr = degradationCost;
      advisoryResult.estimated_degradation_cost_inr = degradationCost;
      advisoryResult.net_opportunity_inr = netOpportunity;
      advisoryResult.net_opportunity_value_inr = netOpportunity;
      advisoryResult.equivalent_cycles = cyclesEquivalent;
      advisoryResult.cycles_equivalent = cyclesEquivalent;
      advisoryResult.persisted = true;
    } catch (dbErr) {
      console.error('CRITICAL: BESS persistence failure:', dbErr);
      return NextResponse.json(
        {
          error: 'PERSISTENCE_FAILED',
          message: 'BESS optimization computed but persistence failed; output cannot be published.',
          details: dbErr instanceof Error ? dbErr.message : String(dbErr),
        },
        { status: 500 }
      );
    }

    return NextResponse.json(advisoryResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to optimize BESS schedule', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
