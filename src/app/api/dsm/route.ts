import { NextRequest, NextResponse } from 'next/server';
import { fetchDSMCalculation } from '@/lib/analytics/client';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { DSM_MODEL, validDate, operatingToday, finiteNumber, validIntervals, dsmInputRows, inputHash, validDSM } from '@/lib/analytics/domain-safety';
import { dsmIncidents, verifiedDSMRuns } from '@/lib/analytics/dsm-evidence';

const suppressed = (reason: string) => NextResponse.json({ is_suppressed: true, suppression_reason: reason,
  blocks: [], incidents: [], persisted: false, estimated_total_exposure_inr: null });

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams, siteId = q.get('siteId'), date = q.get('operatingDate') || operatingToday();
  if (!siteId || !validDate(date)) return NextResponse.json({ error: 'INVALID_SITE_OR_DATE' }, { status: 400 });
  const auth = await authorizeApiRequest(req,{ siteId, productId:'DSM_RISK' });
  if (!auth.authorized) return auth.response;
  const db = createAdminClient();
  const { data: site } = await db.from('sites').select('is_demo').eq('id',siteId).single();
  if (!site) return NextResponse.json({ error:'SITE_NOT_FOUND' },{ status:404 });
  const runs = await verifiedDSMRuns(db,siteId,date,date,site.is_demo === true);
  if (!runs) return suppressed('STALE_OR_UNVERIFIED_DSM_EVIDENCE: Recalculate using complete aligned interval inputs.');
  const { data: incidents, error } = await db.from('dsm_incidents').select('*').eq('site_id',siteId).eq('operating_date',date).order('start_block',{ ascending:true });
  if (error) return suppressed('INCIDENT_EVIDENCE_UNAVAILABLE');
  const expected = runs[0].result_snapshot.incidents;
  if (!incidents || incidents.length !== expected.length || incidents.some((r,i) =>
    ['start_block','end_block','severity','max_deviation_pct','total_excess_energy_kwh','estimated_exposure_inr','root_cause_tag']
      .some(k => r[k] !== expected[i][k]))) return suppressed('DSM_EVALUATION_CHANGED: Refresh the completed-day snapshot.');
  return NextResponse.json({ ...runs[0].result_snapshot, siteId, operatingDate:date, incidents, persisted:true });
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
    const body = await req.json(), { siteId, operatingDate } = body;
    if (!siteId || !validDate(operatingDate)) return NextResponse.json({ error:'INVALID_SITE_OR_DATE' },{ status:400 });
    const auth = await authorizeApiRequest(req,{ siteId, productId:'DSM_RISK' });
    if (!auth.authorized) return auth.response;
    const db = createAdminClient();
    const { data: site, error } = await db.from('sites').select('id,is_demo,contract_demand_value').eq('id',siteId).single();
    if (error || !site) return NextResponse.json({ error:'SITE_NOT_FOUND' },{ status:404 });
    const isDemo = site.is_demo === true;
    let rows: any[];
    if (isDemo) {
      const valid = (a: any) => Array.isArray(a) && a.length === 96 && a.every(v=>finiteNumber(v) && Number(v)>=0);
      if (!valid(body.scheduledDrawalKw) || !valid(body.actualDrawalKw)) return suppressed('MISSING_DATA: Exactly 96 nonnegative schedule and actual values are required.');
      rows = body.scheduledDrawalKw.map((v: any,i: number)=>({ block_index:i+1, operating_date:operatingDate,
        timestamp_utc:new Date(Date.parse(`${operatingDate}T00:00:00+05:30`)+i*900000).toISOString(),
        scheduled_drawal_kw:Number(v),actual_drawal_kw:Number(body.actualDrawalKw[i]) }));
    } else {
      const { data, error: inputError } = await db.from('interval_data_96')
        .select('block_index,operating_date,timestamp_utc,scheduled_drawal_kw,actual_drawal_kw')
        .eq('site_id',siteId).eq('operating_date',operatingDate).order('block_index',{ ascending:true });
      if (inputError || !data || !validIntervals(data,operatingDate,['scheduled_drawal_kw','actual_drawal_kw']))
        return suppressed('MISSING_OR_MISALIGNED_DATA: Require 96 contiguous completed IST intervals without missing or negative drawal.');
      rows = dsmInputRows(data);
    }
    // Contract demand is not used as a kW regulatory limit; this solver computes technical deviations only.
    const scheduled = rows.map(r=>r.scheduled_drawal_kw), actual = rows.map(r=>r.actual_drawal_kw);
    const result: any = await fetchDSMCalculation({ isDemo, siteId, operatingDate, scheduledDrawalKw:scheduled,
      actualDrawalKw:actual, contractDemandKw:1 });
    if (!validDSM(result,siteId,operatingDate,scheduled,actual)) return suppressed('INVALID_ANALYTICS_CONTRACT: Numerical output failed independent validation.');
    result.rule_version = isDemo ? 'CERC_DSM_2024_DEMO' : null;
    result.rule_status = isDemo ? 'DEMO' : 'REGULATORY_CONFIGURATION_REQUIRED';
    result.product_status = isDemo ? 'DEMO' : 'INTERNAL_VALIDATION';
    result.risk_basis = 'TECHNICAL_HEURISTIC_NOT_REGULATORY';
    result.monetary_exposure_status = isDemo ? 'DEMO_CALCULATION' : 'REGULATORY_CONFIGURATION_REQUIRED';
    if (!isDemo) {
      result.estimated_total_exposure_inr = null;
      result.blocks = result.blocks.map((b: any)=>({ ...b,estimated_penalty_inr:null }));
    }
    const incidents = dsmIncidents(result.blocks,isDemo);
    result.input_rows = rows;
    result.provenance = { is_demo:isDemo, model_version:DSM_MODEL, operating_date:operatingDate,
      input_checksum:inputHash(rows), input_source:isDemo ? 'DEMO_BROWSER' : 'INTERVAL_DATA_96',
      temporal_basis:'COMPLETED_DAY_SNAPSHOT', evaluated_at:new Date().toISOString(), monetary_authority:false };
    const { data: saved, error: persistError } = await db.rpc('commit_dsm_evaluation_atomic',{
      p_site_id:siteId, p_org_id:auth.organisationId, p_actor_id:auth.user.id, p_date:operatingDate,
      p_input_rows:rows, p_input_checksum:inputHash(rows), p_result:result, p_incidents:incidents });
    if (persistError) return NextResponse.json({ error:'PERSISTENCE_FAILED', message:'DSM inputs changed or atomic publication failed.' },{ status:409 });
    return NextResponse.json({ ...saved,persisted:true });
  } catch (err) {
    return NextResponse.json({ error:'DSM_UNAVAILABLE', details:err instanceof Error ? err.message : String(err) },{ status:502 });
  }
}
