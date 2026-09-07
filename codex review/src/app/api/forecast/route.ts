import { NextRequest, NextResponse } from 'next/server';
import { fetchGridForecast } from '@/lib/analytics/client';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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

    // 1. Call FastAPI analytics microservice
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
      console.warn('Analytics microservice unavailable, returning fallback demo structure:', apiErr);
      return NextResponse.json(
        { error: 'Analytics service error', details: apiErr instanceof Error ? apiErr.message : String(apiErr) },
        { status: 502 }
      );
    }

    // 2. Persist to PostgreSQL if authenticated / configured
    const supabase = createServerSupabaseClient();
    try {
      const { data: run, error: runError } = await supabase
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

      if (run && forecastResult.blocks && Array.isArray(forecastResult.blocks)) {
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

        await supabase.from('grid_forecast_blocks').upsert(blockRows, {
          onConflict: 'run_id,block_index',
        });
      }
    } catch (dbErr) {
      console.warn('Failed to persist forecast to database:', dbErr);
    }

    return NextResponse.json(forecastResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to generate forecast', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
