import { NextRequest, NextResponse } from 'next/server';
import { fetchBESSAdvisory } from '@/lib/analytics/client';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
    } = body;

    if (!batteryId || !siteId || !operatingDate || !usableCapacityKwh || !powerRatingKw || !pricesInrPerMwh) {
      return NextResponse.json(
        { error: 'Missing required BESS optimization parameters' },
        { status: 400 }
      );
    }

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
        { error: 'Analytics service error', details: apiErr instanceof Error ? apiErr.message : String(apiErr) },
        { status: 502 }
      );
    }

    // Persist to bess_signal_runs
    const supabase = createServerSupabaseClient();
    try {
      await supabase
        .from('bess_signal_runs')
        .upsert(
          {
            battery_id: batteryId,
            operating_date: operatingDate,
            solver_version: advisoryResult.solver_version || 'BESS_ADVISORY_v1.0',
            gross_arbitrage_inr: advisoryResult.gross_arbitrage_inr || 0,
            degradation_cost_inr: advisoryResult.degradation_cost_inr || 0,
            net_opportunity_inr: advisoryResult.net_opportunity_inr || 0,
            equivalent_cycles: advisoryResult.equivalent_cycles || 0,
            is_suppressed: advisoryResult.is_suppressed || false,
            suppression_reason: advisoryResult.suppression_reason || null,
          },
          { onConflict: 'battery_id,operating_date' }
        );
    } catch (dbErr) {
      console.warn('Failed to persist BESS signal run:', dbErr);
    }

    return NextResponse.json(advisoryResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to optimize BESS schedule', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
