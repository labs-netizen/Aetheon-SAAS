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

    if (!siteId || !operatingDate) {
      return NextResponse.json(
        { error: 'Missing required BESS optimization parameters (siteId, operatingDate)' },
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

    // Authoritative asset resolution - load all safety-critical params from DB for live mode
    const { data: asset } = await adminClient
      .from('bess_assets')
      .select('*')
      .eq('site_id', siteId)
      .eq('is_active', true)
      .maybeSingle();

    let effectiveBatteryId = batteryId;
    let actualAsset: any = null;

    if (asset) {
      effectiveBatteryId = asset.id;
      actualAsset = asset;
    }

    // For live mode, ALL safety-critical parameters come from trusted server-side data
    // Browser-supplied values are ONLY used in demo/test mode
    const isDemoMode = Boolean(authResult.isDemo) || (await adminClient.from('sites').select('is_demo').eq('id', siteId).maybeSingle()).data?.is_demo === true;
    const isLiveMode = !isDemoMode;

    if (isLiveMode && !actualAsset) {
      return NextResponse.json({
        battery_id: null,
        operating_date: operatingDate,
        is_suppressed: true,
        suppression_reason: 'NO_ACTIVE_BESS_ASSET: No active BESS asset registered for site.',
        gross_arbitrage_inr: 0,
        degradation_cost_inr: 0,
        net_opportunity_inr: 0,
        equivalent_cycles: 0,
        schedule_blocks: [],
      });
    }
    
    // Server-authoritative safety parameters
    const capKwh = isLiveMode ? (actualAsset?.usable_capacity_kwh ?? 1000.0) : (usableCapacityKwh || actualAsset?.usable_capacity_kwh || 1000.0);
    const pRating = isLiveMode ? (actualAsset?.power_rating_kw ?? 500.0) : (powerRatingKw || actualAsset?.power_rating_kw || 500.0);
    const minSoc = isLiveMode ? (actualAsset?.min_soc_pct ?? 10.0) : (minSocPct || actualAsset?.min_soc_pct || 10.0);
    const maxSoc = isLiveMode ? (actualAsset?.max_soc_pct ?? 90.0) : (maxSocPct || actualAsset?.max_soc_pct || 90.0);
    const cEff = isLiveMode ? (actualAsset?.charge_efficiency ?? 0.92) : (chargeEfficiency || actualAsset?.charge_efficiency || 0.92);
    const dEff = isLiveMode ? (actualAsset?.discharge_efficiency ?? 0.92) : (dischargeEfficiency || actualAsset?.discharge_efficiency || 0.92);
    const degCost = isLiveMode ? (actualAsset?.degradation_cost_per_cycle_inr ?? 1500.0) : (degradationCostPerCycleInr || actualAsset?.degradation_cost_per_cycle_inr || 1500.0);

    // Server-authoritative safety state - NEVER trust browser for live mode
    let soc: number | null = null;
    let isMaintenance = false;
    let isTelemetryStale = false;
    let isInterconnectionRestricted = false;

    if (isLiveMode && actualAsset) {
      // Current SOC strictly from trusted persisted asset telemetry
      soc = actualAsset.current_soc_pct !== null && actualAsset.current_soc_pct !== undefined
        ? Number(actualAsset.current_soc_pct)
        : null;
      
      // Maintenance lock strictly from persisted asset
      isMaintenance = Boolean(actualAsset.maintenance_lock);
      
      // Telemetry freshness check
      if (actualAsset.last_telemetry_at) {
        const telemetryAgeMs = Date.now() - new Date(actualAsset.last_telemetry_at).getTime();
        isTelemetryStale = telemetryAgeMs > 30 * 60 * 1000; // > 30 minutes
      } else {
        isTelemetryStale = true; // No telemetry = stale
      }
      
      // Interconnection restriction is NOT implemented as a column on bess_assets
      // Documented as NOT_IMPLEMENTED / EXTERNAL_CONFIGURATION_REQUIRED
      isInterconnectionRestricted = false;
    } else {
      // Demo mode: use browser values (with validation)
      soc = initialSocPct !== undefined && initialSocPct !== null ? initialSocPct : (actualAsset?.current_soc_pct ?? null);
      isMaintenance = maintenanceLockActive !== undefined ? maintenanceLockActive : Boolean(actualAsset?.maintenance_lock);
      isTelemetryStale = telemetryStale ?? false;
      isInterconnectionRestricted = interconnectionRestricted ?? false;
    }

    // 2. Section 12: Backend Safety Interlock & Suppression Enforcement (Evaluated First)
    if (!isLiveMode) {
      if (
        soc === null || soc === undefined || !Number.isFinite(Number(soc)) || soc < 0 || soc > 100 ||
        (initialSocPct !== undefined && initialSocPct !== null && (initialSocPct < 0 || initialSocPct > 100))
      ) {
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
    } else {
      // Live mode: validate trusted persisted SOC against [minSoc, maxSoc]
      // Completely ignore request.initialSocPct (even if -999 or malformed)
      if (soc === null || soc === undefined || !Number.isFinite(Number(soc))) {
        return NextResponse.json({
          battery_id: effectiveBatteryId,
          operating_date: operatingDate,
          is_suppressed: true,
          suppression_reason: 'SAFETY_INTERLOCK: State of Charge (SOC) unknown or invalid in telemetry. Advisory signals hard-inhibited.',
          gross_arbitrage_inr: 0,
          degradation_cost_inr: 0,
          net_opportunity_inr: 0,
          equivalent_cycles: 0,
          schedule_blocks: [],
        });
      }

      if (soc < minSoc || soc > maxSoc) {
        return NextResponse.json({
          battery_id: effectiveBatteryId,
          operating_date: operatingDate,
          is_suppressed: true,
          suppression_reason: `SAFETY_INTERLOCK: Battery SOC (${soc}%) is outside operational limits [${minSoc}%, ${maxSoc}%]. Advisory signals hard-inhibited.`,
          gross_arbitrage_inr: 0,
          degradation_cost_inr: 0,
          net_opportunity_inr: 0,
          equivalent_cycles: 0,
          schedule_blocks: [],
        });
      }
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

    if (isTelemetryStale === true) {
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

    if (isInterconnectionRestricted === true) {
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

    // Resolve prices: Load 96-block price curve from grid_forecast_blocks for the requested operatingDate
    let effectivePrices: number[] = [];
    
    // For live mode, server MUST resolve authoritative price series from persisted grid forecast
    // For demo mode only, client may provide pricesInrPerMwh
    if (isDemoMode && Array.isArray(pricesInrPerMwh) && pricesInrPerMwh.length === 96) {
      effectivePrices = pricesInrPerMwh;
    } else {
      // Load the grid forecast run for the SPECIFIC operatingDate
      const { data: run } = await adminClient
        .from('grid_forecast_runs')
        .select('id')
        .eq('site_id', siteId)
        .eq('operating_date', operatingDate)
        .maybeSingle();

      if (run) {
        const { data: blocks } = await adminClient
          .from('grid_forecast_blocks')
          .select('block_index, forecast_price_inr_per_mwh')
          .eq('run_id', run.id)
          .order('block_index', { ascending: true });

        if (blocks && blocks.length === 96) {
          const rawPrices = blocks.map((b) => b.forecast_price_inr_per_mwh);
          const allValid = rawPrices.every((p) => p !== null && p !== undefined && Number.isFinite(Number(p)));
          if (allValid) {
            effectivePrices = rawPrices.map(Number);
          }
        }
      }
    }

    if (effectivePrices.length !== 96) {
      return NextResponse.json({
        battery_id: effectiveBatteryId,
        operating_date: operatingDate,
        is_suppressed: true,
        suppression_reason: 'DATA_GAP: Authoritative 96-block price curve unavailable or incomplete for site operating date. Advisory suppressed.',
        gross_arbitrage_inr: 0,
        degradation_cost_inr: 0,
        net_opportunity_inr: 0,
        equivalent_cycles: 0,
        schedule_blocks: [],
      });
    }

    // 3. Call FastAPI analytics microservice with verified effectivePrices and server-authoritative safety params
    let advisoryResult: any;
    try {
      advisoryResult = await fetchBESSAdvisory({
        batteryId: effectiveBatteryId || 'e0000000-0000-0000-0000-000000000001',
        siteId,
        operatingDate,
        usableCapacityKwh: capKwh,
        powerRatingKw: pRating,
        initialSocPct: soc,
        minSocPct: minSoc,
        maxSocPct: maxSoc,
        chargeEfficiency: cEff,
        dischargeEfficiency: dEff,
        degradationCostPerCycleInr: degCost,
        pricesInrPerMwh: effectivePrices,
        maintenanceLockActive: isMaintenance,
        telemetryStale: isTelemetryStale,
        interconnectionRestricted: isInterconnectionRestricted,
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

    const effectiveSolverVersion = isLiveMode
      ? 'BESS_ARBITRAGE_INTERNAL_VALIDATION_v1.0'
      : (advisoryResult.solver_version || 'BESS_ADVISORY_HEURISTIC_DEMO_v1.0');
    advisoryResult.solver_version = effectiveSolverVersion;

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
              solver_version: effectiveSolverVersion,
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
