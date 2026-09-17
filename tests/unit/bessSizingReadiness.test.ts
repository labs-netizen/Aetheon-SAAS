import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({profile:vi.fn(),input:vi.fn(),history:vi.fn(),valid:vi.fn()}));
vi.mock('@/lib/analytics/bess-simulation',()=>({loadBessProfile:mocks.profile}));
vi.mock('@/lib/analytics/grid-input-evidence',()=>({resolveGridInputEvidence:mocks.input,loadGridHistoricalInput:mocks.history}));
vi.mock('@/lib/analytics/domain-safety',()=>({operatingToday:()=> '2026-09-16',validGridAnalyticsResponse:mocks.valid}));
import {evaluateHistoricalBessSizingReadiness} from '@/lib/analytics/bess-sizing-evidence';
import {runSequentialSizing,selectableBessSizingDates} from '@/lib/analytics/bess-multiday';

const siteId='site-1',targetDate='2026-05-01';
const prices=Array.from({length:96},(_,index)=>({block_index:index+1,mcp_rs_per_mwh:5000,source_reference:'IEX',source_file_hash:'hash',
  provenance_status:'OFFICIAL_SOURCE_CONFIRMED',verification_status:'VERIFIED'}));
const priceClient=(rows=prices)=>{const chain:any={select:vi.fn(()=>chain),eq:vi.fn(()=>chain),order:vi.fn().mockResolvedValue({data:rows,error:null})};return {from:vi.fn(()=>chain)} as any;};
const forecast=(overrides:Record<string,unknown>={})=>({forecast_available:true,latest_input_date:'2026-04-30',forecast_target_date:targetDate,
  validation_status:'VALIDATED',model_status:'VALIDATED',blocks:Array(96).fill({}),...overrides}) as any;
const args=(forecastLoader=vi.fn().mockResolvedValue(forecast()))=>({client:{} as any,priceClient:priceClient(),siteId,organisationId:'org-1',targetDate,
  contractDemandKw:1500,forecastLoader});

describe('canonical historical BESS sizing readiness',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.profile.mockResolvedValue({site_id:siteId});mocks.input.mockResolvedValue({is_complete:true,quality_status:'PASSED'});
    mocks.history.mockResolvedValue({complete_days:Array.from({length:42},(_,index)=>({operating_date:index===41?'2026-04-30':`2026-03-${String(index+1).padStart(2,'0')}`})),
      latest_observed_date:'2026-04-30',latest_observed_complete:true});mocks.valid.mockReturnValue(true);});
  it('marks a date ready only after the actual forecast predicate succeeds',async()=>{const result=await evaluateHistoricalBessSizingReadiness(args());
    expect(result).toMatchObject({date:targetDate,price_verified:true,price_blocks:96,forecast_ready:true,sizing_ready:true,readiness_status:'READY'});});
  it('does not treat verified IEX evidence as sizing readiness when forecasting fails',async()=>{const loader=vi.fn().mockRejectedValue(new Error('analytics failed'));
    const result=await evaluateHistoricalBessSizingReadiness(args(loader));expect(result).toMatchObject({price_verified:true,forecast_ready:false,sizing_ready:false,
      forecast_validation_status:'ANALYTICS_ERROR',reason_if_ineligible:'FORECAST_UNAVAILABLE'});});
  it('excludes the known 2025-11-05 weighted-ensemble refit failure from the selectable set',async()=>{
    mocks.history.mockResolvedValue({complete_days:Array.from({length:42},(_,index)=>({operating_date:index===41?'2025-11-04':`2025-09-${String(index+1).padStart(2,'0')}`})),
      latest_observed_date:'2025-11-04',latest_observed_complete:true});
    const loader=vi.fn().mockRejectedValue(new Error("KeyError: 'PREVIOUS_DAY_SAME_BLOCK'"));
    const result=await evaluateHistoricalBessSizingReadiness({...args(loader),targetDate:'2025-11-05'});
    expect(result).toMatchObject({price_verified:true,sizing_ready:false,reason_if_ineligible:'FORECAST_UNAVAILABLE'});
  });
  it('retains the forecast validation failure reason',async()=>{const loader=vi.fn().mockResolvedValue(forecast({forecast_available:false,blocks:[],suppression_reason:'MODEL_VALIDATION_THRESHOLDS_NOT_MET'}));
    const result=await evaluateHistoricalBessSizingReadiness(args(loader));expect(result).toMatchObject({price_verified:true,sizing_ready:false,
      reason_if_ineligible:'FORECAST_VALIDATION_FAILED'});});
  it('rejects incomplete exact-date IEX evidence before invoking forecasting',async()=>{const loader=vi.fn();const value=args(loader);value.priceClient=priceClient(prices.slice(0,95));
    const result=await evaluateHistoricalBessSizingReadiness(value);expect(result).toMatchObject({price_blocks:95,sizing_ready:false,reason_if_ineligible:'IEX_PRICE_INCOMPLETE'});
    expect(loader).not.toHaveBeenCalled();});
  it('reduces the production-shaped 12-date inventory to 8 READY dates and an 8/0 run',async()=>{
    const dates=['2025-07-02','2025-07-06','2025-09-03','2025-09-07','2025-11-05','2025-11-09','2026-01-07','2026-01-11','2026-03-04','2026-03-08','2026-04-12','2026-05-01'];
    const failures=new Map([['2025-11-05',"PREVIOUS_DAY_SAME_BLOCK"],['2025-11-09',"PREVIOUS_DAY_SAME_BLOCK"],['2026-01-11',"PREVIOUS_WEEK_SAME_BLOCK"],['2026-03-08',"PREVIOUS_DAY_SAME_BLOCK"]]);
    mocks.history.mockImplementation(async(_client,_site,_limit,throughDate:string)=>({complete_days:Array.from({length:42},(_,index)=>({operating_date:index===41?throughDate:`history-${index}`})),
      latest_observed_date:throughDate,latest_observed_complete:true}));
    const loader=vi.fn(async(request:{operatingDate:string})=>{const failedFeature=failures.get(request.operatingDate);if(failedFeature)throw new Error(`KeyError: '${failedFeature}'`);
      const latest=new Date(Date.parse(`${request.operatingDate}T00:00:00Z`)-86400000).toISOString().slice(0,10);
      return forecast({latest_input_date:latest,forecast_target_date:request.operatingDate});});
    const evaluated=[];
    for(const date of dates)evaluated.push(await evaluateHistoricalBessSizingReadiness({...args(loader),targetDate:date}));
    const ready=selectableBessSizingDates(evaluated);expect(evaluated).toHaveLength(12);expect(ready).toHaveLength(8);expect(ready).not.toEqual(expect.arrayContaining([...failures.keys()]));
    const outcome=await runSequentialSizing(ready,async date=>date,()=>false);expect(outcome).toMatchObject({cancelled:false,failures:[]});expect(outcome.completed).toHaveLength(8);
  });
});
