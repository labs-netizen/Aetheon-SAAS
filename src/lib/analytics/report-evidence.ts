import crypto from 'node:crypto';
import { resolveApplicableRegulatoryParameters } from '@/features/compliance/regulatoryResolver';
import { verifiedDSMRuns } from './dsm-evidence';

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function regulatoryFingerprint(resolution: any): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonical({ tariff:resolution.applicableTariff, charge:resolution.applicableCharge }))).digest('hex');
}
export async function reportEvidenceValid(db: any, report: any, site: any): Promise<boolean> {
  const modules: Record<string,string> = { GRID_DAILY_BRIEF:'GRID', GRID_MONTHLY_REPORT:'GRID', DAILY_DISPATCH:'GRID',
    DSM_MONTHLY_REVIEW:'DSM', BESS_PERFORMANCE_REPORT:'BESS', COMPLIANCE_AUDIT:'COMPLIANCE', RENEWABLES_RECONCILIATION:'RENEWABLE' };
  const reportModule = Object.hasOwn(modules,report.report_type) ? modules[report.report_type] : undefined;
  if (!reportModule || report.module !== reportModule || !site || report.site_id !== site.id ||
      report.summary?.domain_safety_version !== 'PASS2_V1' || report.summary.is_demo !== (site.is_demo === true) ||
      report.summary.isSuppressed || report.summary.status === 'REPORT_DATA_GAP') return false;
  const expectedQuality = reportModule === 'DSM' ? 'TECHNICAL_ONLY' : site.is_demo === true ? 'DEMO_UNVERIFIED' : 'REVIEWED_PARAMETERS';
  if (report.quality_status !== expectedQuality || report.summary.qualityGateStatus !== expectedQuality) return false;
  if (['GRID','BESS','RENEWABLE'].includes(reportModule)) return site.is_demo === true;
  if (reportModule === 'DSM') {
    const runs = await verifiedDSMRuns(db,site.id,report.period_start,report.period_end,site.is_demo === true);
    return !!runs && JSON.stringify(canonical(runs.map(r=>({ id:r.id,date:r.operating_date,calculatedAt:r.calculation_timestamp,inputChecksum:r.input_checksum })))) ===
      JSON.stringify(canonical(report.summary.provenance));
  }
  const resolution = await resolveApplicableRegulatoryParameters({ state:site.state,discom:site.discom,voltageCategory:site.voltage_category,
    operatingDate:report.period_start,throughDate:report.period_end,isDemo:site.is_demo === true });
  return resolution.status === 'RESOLVED' && regulatoryFingerprint(resolution) === report.summary.regulatoryFingerprint;
}
