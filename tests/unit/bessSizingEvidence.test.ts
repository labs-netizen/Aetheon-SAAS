import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {buildBessSizingEvidenceCatalog} from '@/lib/analytics/bess-sizing-evidence';

const date=(offset:number)=>new Date(Date.parse('2026-01-01T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
const history=Array.from({length:50},(_,index)=>({operating_date:date(index),load_kw:Array(96).fill(1000)}));
const prices=(delivery:string,count=96,verified=true)=>Array.from({length:count},(_,index)=>({delivery_date:delivery,block_index:index+1,
  mcp_rs_per_mwh:5000,verification_status:verified?'VERIFIED':'UNVERIFIED',provenance_status:verified?'OFFICIAL_SOURCE_CONFIRMED':'UNVERIFIED'}));

describe('BESS sizing evidence discovery',()=>{
  it('includes only contiguous-history and exact 96-block verified price days as eligible',()=>{const target=date(50);
    const catalog=buildBessSizingEvidenceCatalog(history,[...prices(target),...prices(date(49),95),...prices(date(48),96,false)],true,'2027-01-01');
    expect(catalog.find(day=>day.date===target)).toMatchObject({eligible:true,forecast_ready:true,price_blocks:96,price_verification:'VERIFIED'});
    expect(catalog.find(day=>day.date===date(49))).toMatchObject({eligible:false,price_blocks:95,reason_if_ineligible:'INCOMPLETE_96_BLOCK_IEX_DAM'});
    expect(catalog.find(day=>day.date===date(48))).toMatchObject({eligible:false,price_verification:'UNVERIFIED',reason_if_ineligible:'UNVERIFIED_IEX_DAM_EVIDENCE'});
  });
  it('excludes insufficient history and missing profiles',()=>{expect(buildBessSizingEvidenceCatalog(history.slice(0,10),prices(date(10)),true,'2027-01-01')[0].reason_if_ineligible).toBe('INSUFFICIENT_OR_NONCONTIGUOUS_FORECAST_HISTORY');
    expect(buildBessSizingEvidenceCatalog(history,prices(date(50)),false,'2027-01-01')[0].reason_if_ineligible).toBe('BESS_PROFILE_REQUIRED');});
});
