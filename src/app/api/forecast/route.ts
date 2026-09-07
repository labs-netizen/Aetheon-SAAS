import { NextRequest, NextResponse } from 'next/server';
import { fetchGridForecast } from '@/lib/analytics/client';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, operatingDate, contractDemandKw, historicalLoadKw, seed } = body;

    if (!siteId || !operatingDate || !contractDemandKw) {
      return NextResponse.json(
        { error: 'siteId, operatingDate, and contractDemandKw are required' },
        { status: 400 }
      );
    }

    // 1. Authorize: User Authentication, Org Membership, Site Access, Product Entitlement
    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'GRID_INTELLIGENCE',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    // 2. Call FastAPI analytics microservice
    let forecastResult: any;
    try {
      forecastResult = await fetchGridForecast({
        siteId,
        operatingDate,
        contractDemandKw,
        historicalLoadKw,
        seed,
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

    // 3. Persist run and blocks safely via trusted service client
    const adminClient = createAdminClient();
    try {
      const { data: run, error: runError } = await adminClient
        .from('grid_forecast_runs')
        .upsert(
          {
            site_id: siteId,
            operating_date: operatingDate,
            model_version: forecastResult.model_version || 'FORECAST_DEMO_v1.0',
            model_generation_time: new Date().toISOString(),
            average_price_inr_per_mwh: forecastResult.summary?.average_price_inr_per_mwh || 4500,
            peak_demand_kw: forecastResult.summary?.peak_demand_kw || 2200,
            peak_demand_block: forecastResult.summary?.peak_demand_block || 74,
            quality_status: forecastResult.summary?.quality_status || 'PASSED',
            freshness_status: forecastResult.summary?.freshness_status || 'RECENT',
          },
          { onConflict: 'site_id,operating_date' }
        )
        .select()
        .single();

      if (runError || !run) {
        throw new Error(runError?.message || 'Failed to upsert grid_forecast_runs');
      }

      if (forecastResult.blocks && Array.isArray(forecastResult.blocks)) {
        const blockRows = forecastResult.blocks.map((b: any) => ({
          run_id: run.id,
          block_index: b.block_index,
          start_time: b.start_time,
          end_time: b.end_time,
          forecast_demand_kw: b.forecast_demand_kw,
          forecast_price_inr_per_mwh: b.forecast_price_inr_per_mwh,
          confidence_lower_kw: b.confidence_lower_kw,
          confidence_upper_kw: b.confidence_upper_kw,
          is_high_cost_window: b.is_high_cost_window,
        }));

        const { error: blockError } = await adminClient
          .from('grid_forecast_blocks')
          .upsert(blockRows, {
            onConflict: 'run_id,block_index',
          });

        if (blockError) {
          throw new Error(blockError.message);
        }
      }

      // Attach persisted run id to response for verification
      forecastResult.run_id = run.id;
      forecastResult.persisted = true;
    } catch (dbErr) {
      console.error('CRITICAL: Forecast persistence failure:', dbErr);
      // Section 28: Fail safely if required persistence/provenance failed
      return NextResponse.json(
        {
          error: 'PERSISTENCE_FAILED',
          message: 'Forecast computation succeeded but persistence failed; output cannot be published.',
          details: dbErr instanceof Error ? dbErr.message : String(dbErr),
        },
        { status: 500 }
      );
    }

    return NextResponse.json(forecastResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to generate forecast', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
