import { describe,it,expect } from 'vitest';
import { reportEvidenceValid } from '@/lib/analytics/report-evidence';

const site={id:'site-a',is_demo:true};
const report={site_id:site.id,module:'RENEWABLE',report_type:'RENEWABLES_RECONCILIATION',quality_status:'DEMO_UNVERIFIED',
  summary:{domain_safety_version:'PASS2_V1',is_demo:true,qualityGateStatus:'DEMO_UNVERIFIED'}};
describe('Pass 3 report publication authority',()=>{
  it('permits explicitly labelled demo evidence only within its own site',async()=>{
    expect(await reportEvidenceValid({},report,site)).toBe(true);
    expect(await reportEvidenceValid({},report,{...site,id:'site-b'})).toBe(false);
    expect(await reportEvidenceValid({},report,{...site,is_demo:false})).toBe(false);
  });
  it.each(['QUALITY_UNKNOWN','DATA_GAP','BLOCKED_STALE_DATA',null])('rejects %s quality even with a safety marker',async quality=>{
    expect(await reportEvidenceValid({},{...report,quality_status:quality,summary:{...report.summary,qualityGateStatus:quality}},site)).toBe(false);
  });
  it.each(['UNRECOGNIZED','constructor','__proto__'])('rejects unknown report type %s',async report_type=>{
    expect(await reportEvidenceValid({},{...report,report_type},site)).toBe(false);
  });
  it('requires matching module, provenance marker and quality claims',async()=>{
    for(const invalid of [{...report,module:'GRID'},{...report,summary:{}},
      {...report,summary:{...report.summary,qualityGateStatus:'PUBLISHABLE'}},
      {...report,summary:{...report.summary,isSuppressed:true}}]) {
      expect(await reportEvidenceValid({},invalid,site)).toBe(false);
    }
  });
  it('does not upgrade synthetic renewable rows into live evidence by relabelling their mode',async()=>{
    expect(await reportEvidenceValid({},{...report,quality_status:'REVIEWED_PARAMETERS',
      summary:{...report.summary,is_demo:false,qualityGateStatus:'REVIEWED_PARAMETERS'}},{...site,is_demo:false})).toBe(false);
  });
});
