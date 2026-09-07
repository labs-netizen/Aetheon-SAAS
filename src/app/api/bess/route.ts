import { NextRequest, NextResponse } from 'next/server';
import { fetchBESSAdvisory } from '@/lib/analytics/client';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json({ error: 'siteId query parameter is required' }, { status: 400 });
    }

    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'BESS_ARBITRAGE',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();
    const { data: asset, error: assetErr } = await adminClient
      .from('bess_assets')
      .select('*')
      .eq('site_id', siteId)
      .eq('is_active', true)
      .maybeSingle();

    if (assetErr) {
      return NextResponse.json({ error: assetErr.message }, { status: 500 });
    }

    const operatingDate = searchParams.get('operatingDate') || new Date().toISOString().substring(0, 10);
    let run = null;
    if (asset) {
      const { data: runData } = await adminClient
        .from('bess_signal_runs')
        .select('*')
        .eq('battery_id', asset.id)
        .eq('operating_date', operatingDate)
        .maybeSingle();
      run = runData;
    }

    return NextResponse.json({
      siteId,
      asset: asset || null,
      run: run || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error fetching BESS status' },
      { status: 500 }
    );
  }
}

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

    if (!siteId || !operatingDate || !pricesInrPerMwh) {
      return NextResponse.json(
        { error: 'Missing required BESS optimization parameters (siteId, operatingDate, pricesInrPerMwh)' },
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

    const adminClient = createAdminClient();

    // Resolve real asset UUID if not passed or passed placeholder
    let effectiveBatteryId = batteryId;
    let actualAsset: any = null;
    if (!effectiveBatteryId || effectiveBatteryId === 'bess_01' || !/^[0-9a-fA-F-]{36}$/.test(effectiveBatteryId)) {
      const { data: asset } = await adminClient
        .from('bess_assets')
        .select('*')
        .eq('site_id', siteId)
        .maybeSingle();

      if (asset) {
        effectiveBatteryId = asset.id;
        actualAsset = asset;
      }
    }

    const capKwh = usableCapacityKwh || actualAsset?.usable_capacity_kwh || 1000.0;
    const pRating = powerRatingKw || actualAsset?.power_rating_kw || 500.0;
    const soc = initialSocPct !== undefined && initialSocPct !== null ? initialSocPct : actualAsset?.current_soc_pct ?? 50.0;
    const isMaintenance = maintenanceLockActive !== undefined ? maintenanceLockActive : Boolean(actualAsset?.maintenance_lock);

    // 2. Section 12: Backend Safety Interlock & Suppression Enforcement
    if (soc === null || soc === undefined || soc < 0 || soc > 100) {
      return NextResponse.json({
        battery_id: effectiveBatteryId,
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

    if (isMaintenance === true) {
      return NextResponse.json({
        battery_id: effectiveBatteryId,
        operating_date: operatingDate,
        is_suppressed: true,
        suppression_reason: 'SAFETY_INTERLOCK: Asset is under physical maintenance lock. Automatic optimization prohibited.',
        gross_arbitrage_inr: 0,
        degradation_cost_inr: 0,
        net_opportunity_inr: 0,
        equivalent_cycles: 0,
        schedule_blocks: [],
      });
    }

    if (telemetryStale === true) {
      return NextResponse.json({
        battery_id: effectiveBatteryId,
        operating_date: operatingDate,
        is_suppressed: true,
        suppression_reason: 'SAFETY_INTERLOCK: BMS telemetry is stale (>30 minutes). Re-establishing telemetry handshake.',
        gross_arbitrage_inr: 0,
        degradation_cost_inr: 0,
        net_opportunity_inr: 0,
        equivalent_cycles: 0,
        schedule_blocks: [],
      });
    }

    if (interconnectionRestricted === true) {
      return NextResponse.json({
        battery_id: effectiveBatteryId,
        operating_date: operatingDate,
        is_suppressed: true,
        suppression_reason: 'SAFETY_INTERLOCK: Grid interconnect feeder capacity constrained by DISCOM SLDC order.',
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
        batteryId: effectiveBatteryId || 'e0000000-0000-0000-0000-000000000001',
        siteId,
        operatingDate,
        usableCapacityKwh: capKwh,
        powerRatingKw: pRating,
        initialSocPct: soc,
        minSocPct: minSocPct || actualAsset?.min_soc_pct || 10.0,
        maxSocPct: maxSocPct || actualAsset?.max_soc_pct || 90.0,
        chargeEfficiency: chargeEfficiency || actualAsset?.charge_efficiency || 0.92,
        dischargeEfficiency: dischargeEfficiency || actualAsset?.discharge_efficiency || 0.92,
        degradationCostPerCycleInr: degradationCostPerCycleInr || actualAsset?.degradation_cost_per_cycle_inr || 1500.0,
        pricesInrPerMwh,
        maintenanceLockActive: isMaintenance,
        telemetryStale: telemetryStale || false,
        interconnectionRestricted: interconnectionRestricted || false,
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

    // 4. Persist to bess_signal_runs safely via service client if real UUID exists
    if (effectiveBatteryId && /^[0-9a-fA-F-]{36}$/.test(effectiveBatteryId)) {
      try {
        const grossArbitrage = advisoryResult.gross_arbitrage_value_inr ?? advisoryResult.gross_arbitrage_inr ?? 0;
        const degradationCost = advisoryResult.estimated_degradation_cost_inr ?? advisoryResult.degradation_cost_inr ?? 0;
        const netOpportunity = advisoryResult.net_opportunity_value_inr ?? advisoryResult.net_opportunity_inr ?? 0;
        const cyclesEquivalent = advisoryResult.cycles_equivalent ?? advisoryResult.equivalent_cycles ?? 0;

        const { error: persistError } = await adminClient
          .from('bess_signal_runs')
          .upsert(
            {
              battery_id: effectiveBatteryId,
              operating_date: operatingDate,
              solver_version: advisoryResult.solver_version || 'BESS_ADVISORY_SOLVER_v1.0',
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
        advisoryResult.net_opportunity_inr = netOpportunity;
        advisoryResult.net_opportunity_value_inr = netOpportunity;
        advisoryResult.cycles_equivalent = cyclesEquivalent;
        advisoryResult.persisted = true;
      } catch (dbErr) {
        console.error('CRITICAL: BESS signal run persistence failure:', dbErr);
        return NextResponse.json(
          {
            error: 'PERSISTENCE_FAILED',
            message: 'BESS advisory computed but persistence to bess_signal_runs failed; output cannot be published.',
            details: dbErr instanceof Error ? dbErr.message : String(dbErr),
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(advisoryResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to generate BESS advisory signals', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
