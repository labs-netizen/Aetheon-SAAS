import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'token'}}})}})}));
vi.mock('@/lib/analytics/bess-multiday',async(importOriginal)=>({...await importOriginal<Record<string,unknown>>(),aggregateMultiDaySizing:()=>null}));
import {MultiDayBessSizingPanel} from '@/features/bess/MultiDayBessSizingPanel';

const readyDates=['2025-07-02','2025-07-06','2025-09-03','2025-09-07','2026-01-07','2026-03-04','2026-04-12','2026-05-01'];
const rejectedDates=['2025-11-05','2025-11-09','2026-01-11','2026-03-08'];
const day=(date:string,ready:boolean)=>({date,eligible:ready,price_verified:true,forecast_ready:ready,price_blocks:96,price_verification:'VERIFIED',
  forecast_validation_status:ready?'VALIDATED':'ANALYTICS_ERROR',sizing_ready:ready,readiness_status:ready?'READY':'FORECAST_UNAVAILABLE',
  reason_if_ineligible:ready?null:'FORECAST_UNAVAILABLE'});

describe('MultiDayBessSizingPanel evidence presentation',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('separates 8 READY dates from 4 diagnostics and executes only the READY selection',async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>String(input).includes('/api/bess/sizing/evidence')
      ?{ok:true,json:async()=>({days:readyDates.map(date=>day(date,true)),eligible_dates:readyDates,
        diagnostic_days:[...readyDates.map(date=>day(date,true)),...rejectedDates.map(date=>day(date,false))]})}
      :{ok:true,json:async()=>({result:{}})});
    vi.stubGlobal('fetch',fetchMock);const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    await act(async()=>{root.render(<MultiDayBessSizingPanel siteId="site-1"/>);await new Promise(resolve=>setTimeout(resolve,0));});
    const readySection=container.querySelector('[data-testid="bess-ready-days"]')!;
    const diagnosticSection=container.querySelector('[data-testid="bess-unavailable-days"]')!;
    expect(readySection.querySelectorAll('[data-testid="bess-ready-day"]')).toHaveLength(8);
    expect(diagnosticSection.querySelectorAll('[data-testid="bess-unavailable-day"]')).toHaveLength(4);
    for(const date of rejectedDates){expect(readySection.textContent).not.toContain(date);expect(diagnosticSection.textContent).toContain(`${date} · FORECAST_UNAVAILABLE`);}
    expect(diagnosticSection.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    const selectAll=[...readySection.querySelectorAll('button')].find(button=>button.textContent?.includes('Select all'))!;
    await act(async()=>Simulate.click(selectAll));expect(readySection.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(8);
    const run=[...container.querySelectorAll('button')].find(button=>button.textContent?.includes('RUN MULTI-DAY'))!;
    await act(async()=>{Simulate.click(run);await new Promise(resolve=>setTimeout(resolve,0));});
    const sizingCalls=fetchMock.mock.calls.filter(([input])=>String(input)==='/api/bess/sizing');expect(sizingCalls).toHaveLength(8);
    const requested=sizingCalls.map(([,init])=>JSON.parse(String(init?.body)).target_date);expect(requested.sort()).toEqual([...readyDates].sort());
    expect(requested).not.toEqual(expect.arrayContaining(rejectedDates));await act(async()=>root.unmount());container.remove();
  });
});
