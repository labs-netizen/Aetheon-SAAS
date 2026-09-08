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
    let qualityEval: any = null;
    let tariff: any = null;
    if (!site.is_demo) {
      const { data: qData } = await adminClient
        .from('data_quality_evaluations')
        .select('*')
        .eq('site_id', siteId)
        .order('evaluation_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      qualityEval = qData;

      const completeness = qualityEval ? Number(qualityEval.completeness_pct) : 0;
      const isCalibrated = site.activation_status === 'ACTIVE';
      
      // Allowlist approach: only explicitly publishable states may proceed
      const publishableStates = ['PUBLISHABLE', 'PUBLISHABLE_WITH_WARNING'];
      const isPublishable = qualityEval && publishableStates.includes(qualityEval.publication_gate_status);
      
      // Authoritatively require conditions for live publication
      const isFresh = qualityEval && qualityEval.freshness_status === 'RECENT';
      const isComplete = completeness >= 95.0;
      const isValidated = qualityEval && qualityEval.validation_status === 'PASSED';

      // Check persisted approved tariff configuration
      const { data: tariffData } = await adminClient
        .from('discom_tariffs')
        .select('id, energy_charge_normal_inr_per_kwh, regulatory_source_id')
        .eq('state', site.state || 'Maharashtra')
        .eq('discom', site.discom || 'MSEDCL')
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      tariff = tariffData;

      if (!qualityEval || !isCalibrated || !isPublishable || !isFresh || !isComplete || !isValidated || !tariff) {
        let suppressionReason = '';
        let gateStatus = qualityEval?.publication_gate_status || 'BLOCKED_MISSING_INPUT';

        if (!tariff) {
          suppressionReason = 'CONFIGURATION_REQUIRED: No approved DISCOM tariff configuration found for live site.';
          gateStatus = 'BLOCKED_INVALID_CONFIGURATION';
        } else if (!isCalibrated) {
          suppressionReason = `CALIBRATING: Site activation status is ${site.activation_status}; active calibration baseline required.`;
        } else if (!qualityEval) {
          suppressionReason = 'MISSING_DATA: No telemetry quality evaluation found for live customer site.';
        } else if (!isComplete) {
          suppressionReason = `DATA_GAP: Telemetry completeness (${completeness.toFixed(1)}%) below 95.0% threshold.`;
          gateStatus = 'BLOCKED_MISSING_INPUT';
        } else if (!isValidated) {
          suppressionReason = `VALIDATION_FAILED: Telemetry validation status is ${qualityEval.validation_status}.`;
          gateStatus = 'BLOCKED_INVALID_CONFIGURATION';
        } else if (!isPublishable) {
          suppressionReason = `QUALITY_GATE_BLOCKED: Telemetry publication gate status is ${qualityEval.publication_gate_status} (not PUBLISHABLE).`;
        } else if (!isFresh) {
          suppressionReason = `STALE_DATA: Telemetry freshness status is ${qualityEval.freshness_status}.`;
          gateStatus = 'BLOCKED_STALE_DATA';
        }

        return NextResponse.json(
          {
            is_suppressed: true,
            suppression_reason: suppressionReason,
            quality_status: gateStatus,
            freshness_status: qualityEval?.freshness_status || 'UNKNOWN',
            completeness_pct: completeness,
            activation_status: site.activation_status,
            validation_status: qualityEval?.validation_status || 'UNKNOWN',
            blocks: [],
            persisted: false,
          },
          { status: 200 }
        );
      }
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

      if (!blocks || blocks.length !== 96) {
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
        data_quality: existingRun.quality_status,
        freshness: existingRun.freshness_status,
        tariff_rate_inr_per_kwh: tariff?.energy_charge_normal_inr_per_kwh ? Number(tariff.energy_charge_normal_inr_per_kwh) : (site.is_demo ? 7.85 : null),
        tariff_version: tariff ? 'APPROVED_DISCOM_TARIFF' : (site.is_demo ? 'MSEDCL_HT1_TOD_DEMO' : null),
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

    if (!forecastResult.blocks || !Array.isArray(forecastResult.blocks) || forecastResult.blocks.length !== 96) {
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
          model_version: site.is_demo ? (forecastResult.model_version || 'DEMO_BASELINE_v1.0') : (forecastResult.model_version || 'INTERNAL_VALIDATION'),
          model_generation_time: forecastResult.model_generation_time || new Date().toISOString(),
          average_price_inr_per_mwh: Number(forecastResult.average_price_inr_per_mwh),
          peak_demand_kw: Number(forecastResult.peak_demand_kw),
          peak_demand_block: Number(forecastResult.peak_demand_block),
          quality_status: site.is_demo ? (forecastResult.data_quality || 'PASSED') : (forecastResult.data_quality || qualityEval?.publication_gate_status || 'QUALITY_UNKNOWN'),
          freshness_status: site.is_demo ? (forecastResult.freshness || 'RECENT') : (forecastResult.freshness || qualityEval?.freshness_status || 'UNKNOWN'),
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
    forecastResult.tariff_rate_inr_per_kwh = tariff?.energy_charge_normal_inr_per_kwh ? Number(tariff.energy_charge_normal_inr_per_kwh) : (site.is_demo ? 7.85 : null);
    forecastResult.tariff_version = tariff ? 'APPROVED_DISCOM_TARIFF' : (site.is_demo ? 'MSEDCL_HT1_TOD_DEMO' : null);
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

    if (!siteId || !operatingDate) {
      return NextResponse.json(
        { error: 'siteId and operatingDate are required' },
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
    let qualityEval: any = null;
    let tariff: any = null;
    if (!site.is_demo) {
      const { data: qData } = await adminClient
        .from('data_quality_evaluations')
        .select('*')
        .eq('site_id', siteId)
        .order('evaluation_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      qualityEval = qData;

      const completeness = qualityEval ? Number(qualityEval.completeness_pct) : 0;
      const isCalibrated = site.activation_status === 'ACTIVE';
      
      // Allowlist approach: only explicitly publishable states may proceed
      const publishableStates = ['PUBLISHABLE', 'PUBLISHABLE_WITH_WARNING'];
      const isPublishable = qualityEval && publishableStates.includes(qualityEval.publication_gate_status);
      
      // Authoritatively require conditions for live publication
      const isFresh = qualityEval && qualityEval.freshness_status === 'RECENT';
      const isComplete = completeness >= 95.0;
      const isValidated = qualityEval && qualityEval.validation_status === 'PASSED';

      // Check persisted approved tariff configuration
      const { data: tariffData } = await adminClient
        .from('discom_tariffs')
        .select('id, energy_charge_normal_inr_per_kwh, regulatory_source_id')
        .eq('state', site.state || 'Maharashtra')
        .eq('discom', site.discom || 'MSEDCL')
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      tariff = tariffData;

      if (!qualityEval || !isCalibrated || !isPublishable || !isFresh || !isComplete || !isValidated || !tariff) {
        let suppressionReason = '';
        let gateStatus = qualityEval?.publication_gate_status || 'BLOCKED_MISSING_INPUT';

        if (!tariff) {
          suppressionReason = 'CONFIGURATION_REQUIRED: No approved DISCOM tariff configuration found for live site.';
          gateStatus = 'BLOCKED_INVALID_CONFIGURATION';
        } else if (!isCalibrated) {
          suppressionReason = `CALIBRATING: Site activation status is ${site.activation_status}; active calibration baseline required.`;
        } else if (!qualityEval) {
          suppressionReason = 'MISSING_DATA: No telemetry quality evaluation found for live customer site.';
        } else if (!isComplete) {
          suppressionReason = `DATA_GAP: Telemetry completeness (${completeness.toFixed(1)}%) below 95.0% threshold.`;
          gateStatus = 'BLOCKED_MISSING_INPUT';
        } else if (!isValidated) {
          suppressionReason = `VALIDATION_FAILED: Telemetry validation status is ${qualityEval.validation_status}.`;
          gateStatus = 'BLOCKED_INVALID_CONFIGURATION';
        } else if (!isPublishable) {
          suppressionReason = `QUALITY_GATE_BLOCKED: Telemetry publication gate status is ${qualityEval.publication_gate_status} (not PUBLISHABLE).`;
        } else if (!isFresh) {
          suppressionReason = `STALE_DATA: Telemetry freshness status is ${qualityEval.freshness_status}.`;
          gateStatus = 'BLOCKED_STALE_DATA';
        }

        return NextResponse.json(
          {
            is_suppressed: true,
            suppression_reason: suppressionReason,
            quality_status: gateStatus,
            freshness_status: qualityEval?.freshness_status || 'UNKNOWN',
            completeness_pct: completeness,
            activation_status: site.activation_status,
            validation_status: qualityEval?.validation_status || 'UNKNOWN',
            blocks: [],
            persisted: false,
          },
          { status: 200 }
        );
      }
    }

    // 4. Resolve authoritative contract demand and historical load
    const effectiveContractDemand = site.is_demo
      ? (body.contractDemandKw || site.contract_demand_value || 1000)
      : (site.contract_demand_value || 1000);

    let historicalLoadKw: number[] | undefined = body.historicalLoadKw;
    if (!site.is_demo) {
      // Server-side historical average from interval_data_96
      const { data: recentIntervals } = await adminClient
        .from('interval_data_96')
        .select('actual_drawal_kw')
        .eq('site_id', siteId)
        .order('created_at', { ascending: false })
        .limit(96);

      if (recentIntervals && recentIntervals.length > 0) {
        const validValues = recentIntervals
          .map((r) => Number(r.actual_drawal_kw))
          .filter((v) => Number.isFinite(v));
        if (validValues.length > 0) {
          historicalLoadKw = validValues;
        }
      }
    }

    // 5. Call FastAPI analytics microservice
    let forecastResult: any;
    try {
      forecastResult = await fetchGridForecast({
        siteId,
        operatingDate,
        contractDemandKw: effectiveContractDemand,
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
      forecastResult.blocks.length !== 96
    ) {
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
            model_version: site.is_demo ? (forecastResult.model_version || 'DEMO_BASELINE_v1.0') : (forecastResult.model_version || 'INTERNAL_VALIDATION'),
            model_generation_time: forecastResult.model_generation_time || new Date().toISOString(),
            average_price_inr_per_mwh: Number(forecastResult.average_price_inr_per_mwh),
            peak_demand_kw: Number(forecastResult.peak_demand_kw),
            peak_demand_block: Number(forecastResult.peak_demand_block),
            quality_status: site.is_demo ? (forecastResult.data_quality || 'PASSED') : (forecastResult.data_quality || qualityEval?.publication_gate_status || 'QUALITY_UNKNOWN'),
            freshness_status: site.is_demo ? (forecastResult.freshness || 'RECENT') : (forecastResult.freshness || qualityEval?.freshness_status || 'UNKNOWN'),
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
      forecastResult.tariff_rate_inr_per_kwh = tariff?.energy_charge_normal_inr_per_kwh ? Number(tariff.energy_charge_normal_inr_per_kwh) : (site.is_demo ? 7.85 : null);
      forecastResult.tariff_version = tariff ? 'APPROVED_DISCOM_TARIFF' : (site.is_demo ? 'MSEDCL_HT1_TOD_DEMO' : null);
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
