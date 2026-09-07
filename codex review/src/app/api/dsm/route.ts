import { NextRequest, NextResponse } from 'next/server';
import { fetchDSMCalculation } from '@/lib/analytics/client';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, operatingDate, scheduledDrawalKw, actualDrawalKw, contractDemandKw } = body;

    if (!siteId || !operatingDate || !scheduledDrawalKw || !actualDrawalKw || !contractDemandKw) {
      return NextResponse.json(
        { error: 'siteId, operatingDate, scheduledDrawalKw, actualDrawalKw, and contractDemandKw are required' },
        { status: 400 }
      );
    }

    let calculationResult: any;
    try {
      calculationResult = await fetchDSMCalculation({
        siteId,
        operatingDate,
        scheduledDrawalKw,
        actualDrawalKw,
        contractDemandKw,
      });
    } catch (apiErr) {
      return NextResponse.json(
        { error: 'Analytics service error', details: apiErr instanceof Error ? apiErr.message : String(apiErr) },
        { status: 502 }
      );
    }

    // Persist identified incidents to dsm_incidents
    const supabase = createServerSupabaseClient();
    try {
      if (calculationResult.incidents && Array.isArray(calculationResult.incidents)) {
        for (const inc of calculationResult.incidents) {
          await supabase.from('dsm_incidents').insert({
            site_id: siteId,
            operating_date: operatingDate,
            start_block: inc.start_block,
            end_block: inc.end_block,
            severity: inc.severity,
            max_deviation_pct: inc.max_deviation_pct,
            total_excess_energy_kwh: inc.total_excess_energy_kwh,
            estimated_exposure_inr: inc.estimated_exposure_inr,
            root_cause_tag: inc.root_cause_tag || 'DEVIATION_SPIKE',
          });
        }
      }
    } catch (dbErr) {
      console.warn('Failed to persist DSM incidents:', dbErr);
    }

    return NextResponse.json(calculationResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to process DSM calculation', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
