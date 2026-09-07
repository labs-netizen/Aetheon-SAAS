import { NextRequest, NextResponse } from 'next/server';
import { fetchDSMCalculation } from '@/lib/analytics/client';
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
      productId: 'DSM_RISK',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();
    const { data: incidents, error } = await adminClient
      .from('dsm_incidents')
      .select('*')
      .eq('site_id', siteId)
      .eq('operating_date', operatingDate)
      .order('start_block', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      siteId,
      operatingDate,
      incidents: incidents || [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error fetching DSM incidents' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { incidentId, siteId } = body;

    if (!incidentId || !siteId) {
      return NextResponse.json({ error: 'incidentId and siteId are required' }, { status: 400 });
    }

    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'DSM_RISK',
      requiredRoles: ['ORGANISATION_ADMIN', 'ENERGY_MANAGER', 'OPERATOR'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();
    const { data: updated, error } = await adminClient
      .from('dsm_incidents')
      .update({
        acknowledged: true,
        acknowledged_by: authResult.user.id,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', incidentId)
      .eq('site_id', siteId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'DSM incident acknowledgement persisted to database',
      incident: updated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error updating incident' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, operatingDate, scheduledDrawalKw, actualDrawalKw, contractDemandKw } = body;

    if (!siteId || !operatingDate || !contractDemandKw) {
      return NextResponse.json(
        { error: 'siteId, operatingDate, and contractDemandKw are required' },
        { status: 400 }
      );
    }

    // 1. Authorize: User Authentication, Org Membership, Site Access, Product Entitlement
    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'DSM_RISK',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    // 2. Fetch or validate 96-block schedule and actual drawal
    const adminClient = createAdminClient();
    let effectiveScheduled = scheduledDrawalKw;
    let effectiveActual = actualDrawalKw;

    // In live mode, if schedule or actual not supplied or incomplete, load directly from persisted interval_data_96
    if (!effectiveScheduled || !effectiveActual || !Array.isArray(effectiveScheduled) || !Array.isArray(effectiveActual) || effectiveScheduled.length !== 96 || effectiveActual.length !== 96) {
      const { data: intervals, error: intErr } = await adminClient
        .from('interval_data_96')
        .select('block_index, scheduled_drawal_kw, actual_drawal_kw')
        .eq('site_id', siteId)
        .eq('operating_date', operatingDate)
        .order('block_index', { ascending: true });

      if (intErr || !intervals || intervals.length !== 96) {
        return NextResponse.json(
          {
            is_suppressed: true,
            suppression_reason: 'MISSING_DATA: Missing approved 96-block schedule or actual meter interval data for operating date.',
            summary: {
              total_deviation_kwh: 0,
              estimated_penalty_inr: 0,
              high_risk_blocks_count: 0,
              quality_status: 'BLOCKED_MISSING_INPUT',
            },
            blocks: [],
            incidents: [],
          },
          { status: 200 }
        );
      }

      effectiveScheduled = intervals.map((row) => Number(row.scheduled_drawal_kw || 0));
      effectiveActual = intervals.map((row) => Number(row.actual_drawal_kw || 0));
    }

    // 3. Call FastAPI analytics microservice
    let calculationResult: any;
    try {
      calculationResult = await fetchDSMCalculation({
        siteId,
        operatingDate,
        scheduledDrawalKw: effectiveScheduled,
        actualDrawalKw: effectiveActual,
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

    // 4. Derive incident groupings from returned deviation blocks
    const incidents: any[] = [];
    if (Array.isArray(calculationResult.blocks) && calculationResult.blocks.length > 0) {
      let currentIncident: any = null;

      for (const block of calculationResult.blocks) {
        if (block.risk_level && block.risk_level !== 'NORMAL') {
          const excessKwh = Math.max(0, (block.actual_drawal_kw || 0) - (block.scheduled_drawal_kw || 0)) * 0.25;
          const devPct = Math.abs(block.deviation_pct || 0);

          if (!currentIncident) {
            currentIncident = {
              start_block: block.block_index,
              end_block: block.block_index,
              severity: block.risk_level,
              max_deviation_pct: Number(devPct.toFixed(2)),
              total_excess_energy_kwh: Number(excessKwh.toFixed(2)),
              estimated_exposure_inr: Number((block.estimated_penalty_inr || 0).toFixed(2)),
              root_cause_tag: devPct > 15 ? 'UNSCHEDULED_SURGE' : 'SCHEDULE_DRIFT',
            };
          } else {
            currentIncident.end_block = block.block_index;
            if (block.risk_level === 'CRITICAL' || (block.risk_level === 'HIGH' && currentIncident.severity !== 'CRITICAL')) {
              currentIncident.severity = block.risk_level;
            }
            currentIncident.max_deviation_pct = Number(Math.max(currentIncident.max_deviation_pct, devPct).toFixed(2));
            currentIncident.total_excess_energy_kwh = Number((currentIncident.total_excess_energy_kwh + excessKwh).toFixed(2));
            currentIncident.estimated_exposure_inr = Number((currentIncident.estimated_exposure_inr + (block.estimated_penalty_inr || 0)).toFixed(2));
          }
        } else {
          if (currentIncident) {
            incidents.push(currentIncident);
            currentIncident = null;
          }
        }
      }
      if (currentIncident) {
        incidents.push(currentIncident);
      }
    }

    // 5. Persist identified incidents to dsm_incidents safely via service client
    try {
      if (incidents.length > 0) {
        const incidentRows = incidents.map((inc) => ({
          site_id: siteId,
          operating_date: operatingDate,
          start_block: inc.start_block,
          end_block: inc.end_block,
          severity: inc.severity,
          max_deviation_pct: inc.max_deviation_pct,
          total_excess_energy_kwh: inc.total_excess_energy_kwh,
          estimated_exposure_inr: inc.estimated_exposure_inr,
          root_cause_tag: inc.root_cause_tag,
        }));

        const { data: insertedRows, error: incError } = await adminClient
          .from('dsm_incidents')
          .insert(incidentRows)
          .select();

        if (incError) {
          throw new Error(incError.message);
        }
        calculationResult.incidents = insertedRows || incidents;
      } else {
        calculationResult.incidents = [];
      }
      calculationResult.persisted = true;
    } catch (dbErr) {
      console.error('CRITICAL: DSM incident persistence failure:', dbErr);
      return NextResponse.json(
        {
          error: 'PERSISTENCE_FAILED',
          message: 'DSM evaluation computed but persistence failed; output cannot be published.',
          details: dbErr instanceof Error ? dbErr.message : String(dbErr),
        },
        { status: 500 }
      );
    }

    return NextResponse.json(calculationResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to process DSM calculation', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
