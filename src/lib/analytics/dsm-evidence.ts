import { DSM_MODEL, inputHash, validDSM, validDate, validIntervals } from './domain-safety';

export function dsmIncidents(blocks: any[], isDemo: boolean): any[] {
  const incidents: any[] = [];
  let current: any = null;
  const flush = () => { if (current) { for (const k of ['max_deviation_pct','total_excess_energy_kwh','estimated_exposure_inr']) {
    if (current[k] !== null) current[k] = Math.round(current[k]*100)/100;
  } incidents.push(current); current = null; } };
  for (const b of blocks) {
    if (b.risk_level === 'NORMAL') { flush(); continue; }
    if (!current) current = { start_block: b.block_index, end_block: b.block_index, severity: b.risk_level,
      max_deviation_pct: 0, total_excess_energy_kwh: 0, estimated_exposure_inr: isDemo ? 0 : null, root_cause_tag: 'SCHEDULE_DRIFT' };
    current.end_block = b.block_index;
    if (b.risk_level === 'CRITICAL' || (b.risk_level === 'HIGH' && current.severity !== 'CRITICAL')) current.severity = b.risk_level;
    current.max_deviation_pct = b.deviation_pct === null || current.max_deviation_pct === null ? null : Math.max(current.max_deviation_pct,Math.abs(b.deviation_pct));
    current.total_excess_energy_kwh += Math.max(0,b.actual_drawal_kw-b.scheduled_drawal_kw)*0.25;
    if (isDemo) current.estimated_exposure_inr += b.estimated_penalty_inr;
    if (b.deviation_pct === null) current.root_cause_tag = 'ZERO_SCHEDULE_DRAWAL';
  }
  flush(); return incidents;
}

export async function verifiedDSMRuns(db: any, siteId: string, start: string, end: string, isDemo: boolean): Promise<any[] | null> {
  if (!validDate(start) || !validDate(end) || end < start) return null;
  const days = (Date.parse(end)-Date.parse(start))/86400000+1;
  if (days > 366) return null;
  const { data: runs, error } = await db.from('dsm_evaluation_runs').select('*').eq('site_id',siteId)
    .gte('operating_date',start).lte('operating_date',end).order('operating_date',{ ascending:true });
  if (error || !runs || runs.length !== days) return null;
  for (let i=0; i<runs.length; i++) {
    const run = runs[i], snapshot = run.result_snapshot;
    const date = new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10);
    if (run.site_id !== siteId || run.operating_date !== date || run.model_version !== DSM_MODEL ||
        run.validation_status !== 'PASSED' || snapshot?.provenance?.is_demo !== isDemo ||
        !Array.isArray(snapshot.input_rows) || snapshot.input_rows.length !== 96) return null;
    const rows = snapshot.input_rows;
    if (!isDemo && !validIntervals(rows,date,['scheduled_drawal_kw','actual_drawal_kw'])) return null;
    if (!validDSM(snapshot,siteId,date,rows.map((r: any)=>Number(r.scheduled_drawal_kw)),rows.map((r: any)=>Number(r.actual_drawal_kw))) ||
        run.input_checksum !== inputHash(rows)) return null;
    if (!isDemo) {
      const { data: current, error: inputError } = await db.from('interval_data_96')
        .select('block_index,operating_date,timestamp_utc,scheduled_drawal_kw,actual_drawal_kw')
        .eq('site_id',siteId).eq('operating_date',date).order('block_index',{ ascending:true });
      if (inputError || !current || !validIntervals(current,date,['scheduled_drawal_kw','actual_drawal_kw']) || inputHash(current) !== run.input_checksum) return null;
    }
    // Incident evidence is rebuilt from the validated numerical snapshot, never from stale windows.
    snapshot.incidents = dsmIncidents(snapshot.blocks,isDemo).map(inc => ({ ...inc, operating_date: date }));
  }
  return runs;
}
