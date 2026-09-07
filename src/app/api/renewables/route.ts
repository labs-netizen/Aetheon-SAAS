import { NextRequest, NextResponse } from 'next/server';
import { fetchRenewableReconciliation } from '@/lib/analytics/client';
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
      productId: 'RENEWABLE_PORTFOLIO',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();
    const { data: asset } = await adminClient
      .from('renewable_assets')
      .select('*')
      .eq('site_id', siteId)
      .eq('is_active', true)
      .maybeSingle();

    const { data: ledger } = await adminClient
      .from('renewable_generation_ledger')
      .select('*')
      .eq('site_id', siteId)
      .eq('operating_date', operatingDate)
      .maybeSingle();

    return NextResponse.json({
      siteId,
      operatingDate,
      asset: asset || null,
      ledger: ledger || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error fetching renewable data' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      siteId,
      operatingDate,
      installedCapacityKw: inputCapacity,
      measuredGenerationKwh: inputMeasured,
      gridEmissionFactorTco2ePerMwh,
      tariffVersion,
      emissionFactorVersion,
    } = body;

    if (!siteId || !operatingDate) {
      return NextResponse.json(
        { error: 'Missing required parameters: siteId and operatingDate are mandatory' },
        { status: 400 }
      );
    }

    // 1. Authorize: User Authentication, Org Membership, Site Access, Product Entitlement
    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'RENEWABLE_PORTFOLIO',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // Resolve installedCapacityKw from renewable_assets if not passed
    let effectiveCapacity = inputCapacity;
    if (!effectiveCapacity) {
      const { data: asset } = await adminClient
        .from('renewable_assets')
        .select('installed_capacity_kw')
        .eq('site_id', siteId)
        .maybeSingle();
      if (asset?.installed_capacity_kw) {
        effectiveCapacity = Number(asset.installed_capacity_kw);
      }
    }

    if (!effectiveCapacity) {
      return NextResponse.json(
        { error: 'installedCapacityKw is required or must be configured on site renewable asset' },
        { status: 400 }
      );
    }

    // Resolve 96-block measured generation
    let blocks96: number[] = [];
    if (Array.isArray(inputMeasured) && inputMeasured.length === 96) {
      blocks96 = inputMeasured.map(Number);
    } else {
      // Query interval_data_96 for measured solar generation
      const { data: intervals } = await adminClient
        .from('interval_data_96')
        .select('block_index, generation_solar_kw')
        .eq('site_id', siteId)
        .eq('operating_date', operatingDate)
        .order('block_index', { ascending: true });

      if (intervals && intervals.length === 96) {
        blocks96 = intervals.map((i) => Number(i.generation_solar_kw || 0));
      } else if (typeof inputMeasured === 'number') {
        // Synthesize 96 blocks from daily scalar for demo/preview compatibility
        const peakKw = (inputMeasured / 5.0); // 5 effective solar hours
        blocks96 = Array.from({ length: 96 }, (_, b) => {
          if (b >= 24 && b <= 72) {
            const t = (b - 24) / 48.0;
            return Math.max(0, Number((peakKw * Math.sin(t * Math.PI) * 0.25).toFixed(2)));
          }
          return 0;
        });
      } else {
        return NextResponse.json(
          {
            error: 'MISSING_DATA',
            message: '96-block measured solar generation data is required. Ingest AMR intervals or supply 96-element measuredGenerationKwh array.',
          },
          { status: 422 }
        );
      }
    }

    // 2. Call FastAPI analytics microservice
    let reconciliationResult: any;
    try {
      reconciliationResult = await fetchRenewableReconciliation({
        siteId,
        operatingDate,
        installedCapacityKw: effectiveCapacity,
        measuredGenerationKwh: blocks96,
        gridEmissionFactorTco2ePerMwh: gridEmissionFactorTco2ePerMwh || 0.716,
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

    // 3. Section 13: Ensure data classification metadata is explicitly attached
    reconciliationResult.classification = {
      generation: 'MEASURED',
      modelled_expected: 'MODELLED',
      avoided_emissions: 'ESTIMATED',
      tariff_version: tariffVersion || 'MERC_GEOA_2024_DEMO',
      emission_factor_version: emissionFactorVersion || 'CEA_CO2_BASELINE_v19',
    };

    // 4. Persist reconciliation to renewable_generation_ledger and record quality gate evaluation via admin client
    try {
      const { error: ledgerError } = await adminClient
        .from('renewable_generation_ledger')
        .upsert(
          {
            site_id: siteId,
            operating_date: operatingDate,
            total_measured_generation_kwh: reconciliationResult.total_measured_generation_kwh,
            total_modelled_generation_kwh: reconciliationResult.total_modelled_generation_kwh,
            performance_ratio_pct: reconciliationResult.performance_ratio_pct,
            avoided_emissions_tco2e: reconciliationResult.avoided_emissions_tco2e,
            emission_factor_source: reconciliationResult.emission_factor_source || 'CEA_CO2_BASELINE_DB_v19_DEMO',
            reconciliation_status: reconciliationResult.reconciliation_status || 'RECONCILED',
          },
          { onConflict: 'site_id,operating_date' }
        );

      if (ledgerError) {
        throw new Error(ledgerError.message);
      }

      reconciliationResult.persisted = true;
    } catch (dbErr) {
      console.error('CRITICAL: Renewable persistence failure:', dbErr);
      return NextResponse.json(
        {
          error: 'PERSISTENCE_FAILED',
          message: 'Renewable reconciliation computed but database persistence failed; output cannot be published.',
          details: dbErr instanceof Error ? dbErr.message : String(dbErr),
        },
        { status: 500 }
      );
    }

    return NextResponse.json(reconciliationResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to reconcile renewable generation', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
