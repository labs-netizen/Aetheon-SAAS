import { NextRequest, NextResponse } from 'next/server';
import { fetchRenewableReconciliation } from '@/lib/analytics/client';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

const LIVE_RENEWABLE_BLOCK = 'LIVE_RENEWABLE_MODEL_AND_FACTOR_AUTHORITY_REQUIRED';

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
    const { data: site, error: siteError } = await adminClient.from('sites').select('is_demo').eq('id',siteId).single();
    if (siteError || !site) return NextResponse.json({error:'SITE_NOT_FOUND'},{status:404});
    if (site.is_demo !== true) return NextResponse.json({siteId,operatingDate,asset:null,ledger:null,
      is_suppressed:true,suppression_reason:LIVE_RENEWABLE_BLOCK});
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
      tariffVersion,
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
      requiredRoles: ['ORGANISATION_ADMIN', 'ENERGY_MANAGER'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // 2. Fetch authoritative site configuration
    const { data: siteRecord, error: siteErr } = await adminClient
      .from('sites')
      .select('id, is_demo')
      .eq('id', siteId)
      .single();

    if (siteErr || !siteRecord) {
      return NextResponse.json({ error: 'SITE_NOT_FOUND', message: 'Site not found.' }, { status: 404 });
    }

    const isDemo = Boolean(siteRecord.is_demo);
    if (!isDemo) return NextResponse.json({error:'RECONCILIATION_NOT_PUBLISHABLE',is_suppressed:true,
      suppression_reason:LIVE_RENEWABLE_BLOCK,persisted:false},{status:422});

    // 3. Resolve installedCapacityKw
    let effectiveCapacity = inputCapacity;
    if (!effectiveCapacity || !isDemo) {
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

    // 4. Resolve 96-block measured generation
    let blocks96: number[] = [];
    if (!isDemo) {
      // In live customer mode, ignore browser-provided measured arrays; load from interval_data_96
      const { data: intervals, error: intErr } = await adminClient
        .from('interval_data_96')
        .select('block_index, generation_solar_kw')
        .eq('site_id', siteId)
        .eq('operating_date', operatingDate)
        .order('block_index', { ascending: true });

      if (intErr || !intervals || intervals.length !== 96) {
        return NextResponse.json(
          {
            error: 'DATA_GAP',
            message: 'Live mode requires exactly 96 persisted generation intervals in interval_data_96. Telemetry missing or incomplete.',
          },
          { status: 422 }
        );
      }

      const hasNullGen = intervals.some(
        (i) => i.generation_solar_kw === null || i.generation_solar_kw === undefined || !Number.isFinite(Number(i.generation_solar_kw))
      );

      if (hasNullGen) {
        return NextResponse.json(
          {
            error: 'DATA_GAP',
            message: 'Persisted generation intervals contain null or invalid values. Complete 96-block series required.',
          },
          { status: 422 }
        );
      }

      blocks96 = intervals.map((i) => Number(i.generation_solar_kw));
    } else {
      // Demo mode: accept client array or synthesize
      if (Array.isArray(inputMeasured) && inputMeasured.length === 96) {
        blocks96 = inputMeasured.map(Number);
      } else if (typeof inputMeasured === 'number') {
        const peakKw = inputMeasured / 5.0;
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
            message: '96-block measured solar generation data is required.',
          },
          { status: 422 }
        );
      }
    }

    // 5. Resolve verified emission factor from database
    const operatingYear = parseInt(operatingDate.substring(0, 4), 10) || 2026;
    const { data: efRecord } = await adminClient
      .from('emission_factors')
      .select('*')
      .eq('is_verified', true)
      .lte('effective_year', operatingYear)
      .order('effective_year', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!isDemo && !efRecord) {
      return NextResponse.json(
        {
          error: 'DATA_GAP',
          message: 'DATA GAP: No verified emission factor record found in database for operating period.',
        },
        { status: 422 }
      );
    }

    const gridEmissionFactor = efRecord ? Number(efRecord.factor_value_tco2e_per_mwh) : (isDemo ? 0.716 : 0.716);
    const efSource = efRecord?.source_name || (isDemo ? 'Central Electricity Authority (CEA) CO2 Baseline Database' : 'UNVERIFIED_SOURCE');
    const efVersion = efRecord?.source_version || (isDemo ? 'v19.0' : 'UNVERIFIED');

    // 6. Call FastAPI analytics microservice
    let reconciliationResult: any;
    try {
      reconciliationResult = await fetchRenewableReconciliation({
        siteId,
        operatingDate,
        installedCapacityKw: effectiveCapacity,
        measuredGenerationKwh: blocks96,
        gridEmissionFactorTco2ePerMwh: gridEmissionFactor,
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

    // 7. Attach authoritative classification metadata
    reconciliationResult.classification = {
      generation: 'MEASURED',
      modelled_expected: 'MODELLED',
      avoided_emissions: 'ESTIMATED',
      tariff_version: tariffVersion || 'MERC_GEOA_2024_DEMO',
      emission_factor_source: efSource,
      emission_factor_version: efVersion,
      emission_factor_value: gridEmissionFactor,
      operating_period: operatingDate,
    };

    // 8. Persist reconciliation to renewable_generation_ledger safely fail-closed
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
            emission_factor_source: `${efSource} (${efVersion})`,
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
