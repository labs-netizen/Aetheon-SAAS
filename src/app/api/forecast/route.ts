import { NextRequest, NextResponse } from 'next/server';
import { fetchGridForecast } from '@/lib/analytics/client';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const operatingDate = searchParams.get('operatingDate') || new Date().toISOString().substring(0, 10);

    if (!siteId) {
      return NextResponse.json({ error: 'siteId query parameter is required' }, { status: 400 });
    }

    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'GRID_INTELLIGENCE',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // Check if a forecast run already exists for this site and date
    const { data: existingRun } = await adminClient
      .from('grid_forecast_runs')
      .select('*')
      .eq('site_id', siteId)
      .eq('operating_date', operatingDate)
      .maybeSingle();

    if (existingRun) {
      const { data: blocks } = await adminClient
        .from('grid_forecast_blocks')
        .select('*')
        .eq('run_id', existingRun.id)
        .order('block_index', { ascending: true });

      return NextResponse.json({
        run_id: existingRun.id,
        site_id: siteId,
        operating_date: operatingDate,
        model_version: existingRun.model_version,
        model_generation_time: existingRun.model_generation_time,
        average_price_inr_per_mwh: existingRun.average_price_inr_per_mwh,
        peak_demand_kw: existingRun.peak_demand_kw,
        peak_demand_block: existingRun.peak_demand_block,
        data_quality: existingRun.quality_status,
        freshness: existingRun.freshness_status,
        blocks: (blocks || []).map((b) => ({
          block_index: b.block_index,
          start_time: b.start_time,
          end_time: b.end_time,
          forecast_demand_kw: b.forecast_demand_kw,
          forecast_price_inr_per_mwh: b.forecast_price_inr_per_mwh,
          confidence_lower_kw: b.confidence_lower_kw,
          confidence_upper_kw: b.confidence_upper_kw,
          is_high_cost_window: b.is_high_cost_window,
        })),
        persisted: true,
      });
    }

    // If no existing run, fetch site's contract demand and trigger solver
    const { data: site } = await adminClient
      .from('sites')
      .select('contract_demand_value')
      .eq('id', siteId)
      .single();

    const contractDemandKw = site?.contract_demand_value || 1000;

    let forecastResult: any;
    try {
      forecastResult = await fetchGridForecast({
        siteId,
        operatingDate,
        contractDemandKw,
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

    // Persist run
    const { data: run, error: runError } = await adminClient
      .from('grid_forecast_runs')
      .upsert(
        {
          site_id: siteId,
          operating_date: operatingDate,
          model_version: forecastResult.model_version || 'DEMO_BASELINE_v1.0',
          model_generation_time: forecastResult.model_generation_time || new Date().toISOString(),
          average_price_inr_per_mwh: Number(forecastResult.average_price_inr_per_mwh),
          peak_demand_kw: Number(forecastResult.peak_demand_kw),
          peak_demand_block: Number(forecastResult.peak_demand_block),
          quality_status: forecastResult.data_quality || 'PASSED',
          freshness_status: forecastResult.freshness || 'RECENT',
        },
        { onConflict: 'site_id,operating_date' }
      )
      .select()
      .single();

    if (runError || !run) {
      return NextResponse.json(
        { error: 'PERSISTENCE_FAILED', details: runError?.message },
        { status: 500 }
      );
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

      await adminClient.from('grid_forecast_blocks').upsert(blockRows, {
        onConflict: 'run_id,block_index',
      });
    }

    forecastResult.run_id = run.id;
    forecastResult.persisted = true;
    return NextResponse.json(forecastResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to retrieve grid forecast', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

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

    // Validate required contract fields from FastAPI response
    if (
      forecastResult.average_price_inr_per_mwh === undefined ||
      forecastResult.peak_demand_kw === undefined ||
      forecastResult.peak_demand_block === undefined ||
      !Array.isArray(forecastResult.blocks) ||
      forecastResult.blocks.length === 0
    ) {
      return NextResponse.json(
        {
          error: 'INVALID_ANALYTICS_CONTRACT',
          message: 'FastAPI Grid response does not adhere to required GridForecastResponse schema.',
          receivedPayload: forecastResult,
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
            model_version: forecastResult.model_version || 'DEMO_BASELINE_v1.0',
            model_generation_time: forecastResult.model_generation_time || new Date().toISOString(),
            average_price_inr_per_mwh: Number(forecastResult.average_price_inr_per_mwh),
            peak_demand_kw: Number(forecastResult.peak_demand_kw),
            peak_demand_block: Number(forecastResult.peak_demand_block),
            quality_status: forecastResult.data_quality || 'PASSED',
            freshness_status: forecastResult.freshness || 'RECENT',
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
