import { NextRequest, NextResponse } from 'next/server';
import { fetchGridForecast } from '@/lib/analytics/client';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { LIVE_GRID_BLOCK, validDate, operatingToday, validGridDemo } from '@/lib/analytics/domain-safety';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const operatingDate = searchParams.get('operatingDate') || operatingToday();

    if (!siteId || !validDate(operatingDate)) {
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

    // 1. Fetch site authoritative configuration
    const { data: site, error: siteErr } = await adminClient
      .from('sites')
      .select('id, name, state, discom, voltage_category, is_demo, activation_status, contract_demand_value')
      .eq('id', siteId)
      .single();

    if (siteErr || !site) {
      return NextResponse.json({ error: 'SITE_NOT_FOUND', message: 'Site not found.' }, { status: 404 });
    }

    // 2. Authoritative Server-side Quality Gate
    if (site.is_demo !== true) {
      return NextResponse.json({ site_id: siteId, operating_date: operatingDate, is_suppressed: true, suppression_reason: LIVE_GRID_BLOCK, blocks: [], persisted: false, data_quality: 'UNVERIFIED', confidence_status: 'UNAVAILABLE', freshness: 'UNKNOWN' });
    }

    // 3. Check if a forecast run already exists for this site and date
    const { data: existingRun } = await adminClient
      .from('grid_forecast_runs')
      .select('*')
      .eq('site_id', siteId)
      .eq('operating_date', operatingDate)
      .maybeSingle();

    if (existingRun) {
      const { data: blocks, error: blocksErr } = await adminClient
        .from('grid_forecast_blocks')
        .select('*')
        .eq('run_id', existingRun.id)
        .order('block_index', { ascending: true });

      if (blocksErr) {
        return NextResponse.json(
          { error: 'DATABASE_ERROR', message: blocksErr.message },
          { status: 500 }
        );
      }

      if (!validGridDemo({ ...existingRun, data_quality: existingRun.quality_status, blocks }, siteId, operatingDate)) {
        return NextResponse.json(
          {
            error: 'DATA_GAP',
            message: 'Incomplete persisted forecast blocks for run. Exactly 96 blocks required.',
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        run_id: existingRun.id,
        site_id: siteId,
        operating_date: operatingDate,
        model_version: existingRun.model_version,
        model_generation_time: existingRun.model_generation_time,
        average_price_inr_per_mwh: existingRun.average_price_inr_per_mwh,
        peak_demand_kw: existingRun.peak_demand_kw,
        peak_demand_block: existingRun.peak_demand_block,
        data_quality: 'DEMO_UNVERIFIED',
        confidence_status: 'DEMO_UNCALIBRATED',
        freshness: existingRun.freshness_status,
        tariff_rate_inr_per_kwh: 7.85,
        tariff_version: 'MSEDCL_HT1_TOD_DEMO',
        blocks: blocks.map((b) => ({
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

    // 4. Trigger solver using authoritative site contract demand
    const contractDemandKw = site.contract_demand_value || 1000;

    let forecastResult: any;
    try {
      forecastResult = await fetchGridForecast({
        isDemo: true,
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

    if (!validGridDemo(forecastResult, siteId, operatingDate)) {
      return NextResponse.json(
        {
          error: 'INVALID_ANALYTICS_CONTRACT',
          message: 'Solver did not return exactly 96 forecast blocks.',
        },
        { status: 502 }
      );
    }

    // 5. Persist run & blocks fail-closed

    const { data: run, error: runError } = await adminClient
      .from('grid_forecast_runs')
      .upsert(
        {
          site_id: siteId,
          operating_date: operatingDate,
          model_version: forecastResult.model_version,
          model_generation_time: forecastResult.model_generation_time || new Date().toISOString(),
          average_price_inr_per_mwh: Number(forecastResult.average_price_inr_per_mwh),
          peak_demand_kw: Number(forecastResult.peak_demand_kw),
          peak_demand_block: Number(forecastResult.peak_demand_block),
          quality_status: 'DEMO_UNVERIFIED',
          freshness_status: 'DEMO',
        },
        { onConflict: 'site_id,operating_date' }
      )
      .select()
      .single();

    if (runError || !run) {
      return NextResponse.json(
        { error: 'PERSISTENCE_FAILED', message: 'Failed to persist grid_forecast_runs', details: runError?.message },
        { status: 500 }
      );
    }

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
      return NextResponse.json(
        { error: 'PERSISTENCE_FAILED', message: 'Failed to persist grid_forecast_blocks', details: blockError.message },
        { status: 500 }
      );
    }

    forecastResult.run_id = run.id;
    forecastResult.persisted = true;
    forecastResult.data_quality = 'DEMO_UNVERIFIED';
    forecastResult.freshness = 'DEMO';
    forecastResult.tariff_rate_inr_per_kwh = 7.85;
    forecastResult.tariff_version = 'MSEDCL_HT1_TOD_DEMO';
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
    const { siteId, operatingDate, seed } = body;

    if (!siteId || !validDate(operatingDate)) {
      return NextResponse.json(
        { error: 'siteId and operatingDate are required' },
        { status: 400 }
      );
    }

    // 1. Authorize: User Authentication, Org Membership, Site Access, Product Entitlement
    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'GRID_INTELLIGENCE',
      requiredRoles: ['ORGANISATION_ADMIN', 'ENERGY_MANAGER'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // 2. Fetch authoritative site configuration
    const { data: site, error: siteErr } = await adminClient
      .from('sites')
      .select('id, name, state, discom, voltage_category, is_demo, activation_status, contract_demand_value')
      .eq('id', siteId)
      .single();

    if (siteErr || !site) {
      return NextResponse.json({ error: 'SITE_NOT_FOUND', message: 'Site not found.' }, { status: 404 });
    }

    // 3. Server-authoritative Quality Gate
    if (site.is_demo !== true) {
      return NextResponse.json({ site_id: siteId, operating_date: operatingDate, is_suppressed: true, suppression_reason: LIVE_GRID_BLOCK, blocks: [], persisted: false, data_quality: 'UNVERIFIED', confidence_status: 'UNAVAILABLE', freshness: 'UNKNOWN' });
    }

    // 4. Resolve authoritative contract demand and historical load
    const effectiveContractDemand = site.is_demo
      ? (body.contractDemandKw || site.contract_demand_value || 1000)
      : (site.contract_demand_value || 1000);

    // 5. Call FastAPI analytics microservice
    const effectiveSeed = site.is_demo ? seed : undefined;
    let forecastResult: any;
    try {
      forecastResult = await fetchGridForecast({
        isDemo: true,
        siteId,
        operatingDate,
        contractDemandKw: effectiveContractDemand,
        seed: effectiveSeed,
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

    if (!validGridDemo(forecastResult, siteId, operatingDate)) {
      return NextResponse.json(
        {
          error: 'INVALID_ANALYTICS_CONTRACT',
          message: 'FastAPI Grid response does not adhere to required 96-block GridForecastResponse schema.',
          receivedPayload: forecastResult,
        },
        { status: 502 }
      );
    }

    // 6. Persist run and blocks safely fail-closed

    try {
      const { data: run, error: runError } = await adminClient
        .from('grid_forecast_runs')
        .upsert(
          {
            site_id: siteId,
            operating_date: operatingDate,
            model_version: forecastResult.model_version,
            model_generation_time: forecastResult.model_generation_time || new Date().toISOString(),
            average_price_inr_per_mwh: Number(forecastResult.average_price_inr_per_mwh),
            peak_demand_kw: Number(forecastResult.peak_demand_kw),
            peak_demand_block: Number(forecastResult.peak_demand_block),
            quality_status: 'DEMO_UNVERIFIED',
            freshness_status: 'DEMO',
          },
          { onConflict: 'site_id,operating_date' }
        )
        .select()
        .single();

      if (runError || !run) {
        throw new Error(runError?.message || 'Failed to upsert grid_forecast_runs');
      }

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
        throw new Error(`Failed to upsert grid_forecast_blocks: ${blockError.message}`);
      }

      forecastResult.run_id = run.id;
      forecastResult.persisted = true;
      forecastResult.data_quality = 'DEMO_UNVERIFIED';
      forecastResult.freshness = 'DEMO';
      forecastResult.tariff_rate_inr_per_kwh = 7.85;
      forecastResult.tariff_version = 'MSEDCL_HT1_TOD_DEMO';
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
