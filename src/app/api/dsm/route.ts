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

    // Use atomic RPC for acknowledgement + audit
    const { data: result, error: rpcError } = await adminClient.rpc('acknowledge_dsm_incident_atomic', {
      p_incident_id: incidentId,
      p_site_id: siteId,
      p_user_id: authResult.user.id,
      p_user_role: authResult.role,
      p_org_id: authResult.organisationId,
    });

    if (rpcError) {
      return NextResponse.json({ error: 'RPC_FAILED', message: rpcError.message }, { status: 500 });
    }

    // Fetch updated incident for response
    const { data: updated, error: fetchErr } = await adminClient
      .from('dsm_incidents')
      .select('*')
      .eq('id', incidentId)
      .eq('site_id', siteId)
      .single();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
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

    if (!siteId || !operatingDate) {
      return NextResponse.json(
        { error: 'siteId and operatingDate are required' },
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

    const adminClient = createAdminClient();

    // 2. Fetch authoritative site configuration
    const { data: site } = await adminClient
      .from('sites')
      .select('id, is_demo, contract_demand_value')
      .eq('id', siteId)
      .single();

    const isDemo = Boolean(site?.is_demo);
    const effectiveContractDemand = site?.contract_demand_value || contractDemandKw || 1000;

    // 3. For LIVE mode, server MUST load 96-block schedule/actual from persisted interval_data_96
    // Browser arrays are DEMO/TEST ONLY
    let effectiveScheduled: number[];
    let effectiveActual: number[];

    if (isDemo) {
      // Demo mode: allow browser-supplied arrays (with validation)
      effectiveScheduled = scheduledDrawalKw;
      effectiveActual = actualDrawalKw;

      if (!effectiveScheduled || !effectiveActual || !Array.isArray(effectiveScheduled) || !Array.isArray(effectiveActual) || effectiveScheduled.length !== 96 || effectiveActual.length !== 96) {
        return NextResponse.json(
          {
            is_suppressed: true,
            suppression_reason: 'MISSING_DATA: Demo mode requires 96-block schedule and actual drawal arrays.',
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
    } else {
      // Live mode: ALWAYS load from persisted interval_data_96 for the requested operatingDate
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

      // Check for NULL or non-finite values: Zero is legitimate, NULL is missing data
      const hasNullScheduled = intervals.some(
        (r) => r.scheduled_drawal_kw === null || r.scheduled_drawal_kw === undefined || !Number.isFinite(Number(r.scheduled_drawal_kw))
      );
      const hasNullActual = intervals.some(
        (r) => r.actual_drawal_kw === null || r.actual_drawal_kw === undefined || !Number.isFinite(Number(r.actual_drawal_kw))
      );

      if (hasNullScheduled || hasNullActual) {
        return NextResponse.json(
          {
            is_suppressed: true,
            suppression_reason: 'MISSING_DATA: Persisted interval data contains null or non-finite scheduled/actual drawal values. Zero cannot be substituted for missing data.',
            summary: {
              total_deviation_kwh: 0,
              estimated_penalty_inr: 0,
              high_risk_blocks_count: 0,
              quality_status: 'BLOCKED_MISSING_DATA',
            },
            blocks: [],
            incidents: [],
          },
          { status: 200 }
        );
      }

      effectiveScheduled = intervals.map((row) => Number(row.scheduled_drawal_kw));
      effectiveActual = intervals.map((row) => Number(row.actual_drawal_kw));
    }

    // 4. Call FastAPI analytics microservice
    let calculationResult: any;
    try {
      calculationResult = await fetchDSMCalculation({
        siteId,
        operatingDate,
        scheduledDrawalKw: effectiveScheduled,
        actualDrawalKw: effectiveActual,
        contractDemandKw: effectiveContractDemand,
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

    // 5. DSM Rule Approval Gate - Resolve persisted approved/applicable DSM rule version
    let ruleVersion = 'UNKNOWN';
    let ruleStatus = 'UNKNOWN';
    let ruleEffectiveDate = null;
    
    if (!isDemo) {
      // In live customer mode, monetary exposure requires explicit approved regulatory rule
      const { data: rule } = await adminClient
        .from('regulatory_sources')
        .select('version, status, effective_date')
        .eq('jurisdiction', 'CERC')
        .eq('category', 'DSM')
        .eq('status', 'APPROVED')
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (rule) {
        ruleVersion = rule.version;
        ruleStatus = rule.status;
        ruleEffectiveDate = rule.effective_date;
      } else {
        ruleVersion = 'NO_APPROVED_RULE';
        ruleStatus = 'MISSING';
      }
      
      calculationResult.rule_version = ruleVersion;
      calculationResult.rule_status = ruleStatus;
      calculationResult.rule_effective_date = ruleEffectiveDate;
      calculationResult.product_status = 'INTERNAL_VALIDATION';
      
      // If no approved monetary rule exists, suppress monetary penalty/compliance exposure
      if (ruleStatus !== 'APPROVED') {
        calculationResult.estimated_total_exposure_inr = 0;
        calculationResult.blocks = calculationResult.blocks?.map((b: any) => ({
          ...b,
          estimated_penalty_inr: 0,
        })) || [];
      }
    } else {
      calculationResult.rule_version = 'CERC_DSM_2024_DEMO';
      calculationResult.rule_status = 'DEMO';
      calculationResult.product_status = 'INTERNAL_VALIDATION';
    }

    // 6. Derive incident groupings from returned deviation blocks
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

    // 7. Persist incidents idempotently preserving acknowledgement history
    try {
      if (incidents.length > 0) {
        // Fetch existing incidents to preserve acknowledgements
        const { data: existingIncidents } = await adminClient
          .from('dsm_incidents')
          .select('id, start_block, end_block, acknowledged, acknowledged_by, acknowledged_at')
          .eq('site_id', siteId)
          .eq('operating_date', operatingDate);

        const ackMap = new Map<string, any>();
        if (existingIncidents) {
          for (const ex of existingIncidents) {
            ackMap.set(`${ex.start_block}-${ex.end_block}`, ex);
          }
        }

        const incidentRows = incidents.map((inc) => {
          const key = `${inc.start_block}-${inc.end_block}`;
          const existing = ackMap.get(key);
          return {
            site_id: siteId,
            operating_date: operatingDate,
            start_block: inc.start_block,
            end_block: inc.end_block,
            severity: inc.severity,
            max_deviation_pct: inc.max_deviation_pct,
            total_excess_energy_kwh: inc.total_excess_energy_kwh,
            estimated_exposure_inr: inc.estimated_exposure_inr,
            root_cause_tag: inc.root_cause_tag,
            acknowledged: existing ? existing.acknowledged : false,
            acknowledged_by: existing ? existing.acknowledged_by : null,
            acknowledged_at: existing ? existing.acknowledged_at : null,
          };
        });

        const { data: upsertedRows, error: incError } = await adminClient
          .from('dsm_incidents')
          .upsert(incidentRows, {
            onConflict: 'site_id,operating_date,start_block,end_block',
          })
          .select();

        if (incError) {
          throw new Error(incError.message);
        }
        calculationResult.incidents = upsertedRows || incidents;
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
