import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import CompliancePage from '@/app/compliance/page';

const state=vi.hoisted(()=>({site:{id:'demo-site',is_demo:true,state:'Maharashtra',discom:'MSEDCL',voltage_category:'33kV'}}));
vi.mock('@/components/layout/SiteContext',()=>({useSite:()=>({currentSite:state.site,isEntitled:()=>true})}));
vi.mock('@/components/shared/ModuleGate',()=>({ModuleGate:({children}:any)=><>{children}</>}));
vi.mock('@/components/shared/ProvenanceFooter',()=>({ProvenanceFooter:()=>null}));

it('never displays prior demo evidence under a live site after its request fails',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const fetchMock=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({
    sources:[{id:'prior',document_title:'PRIOR DEMO RULE',jurisdiction:'Maharashtra',state:'Maharashtra',effective_date:'2026-01-01',version:'DEMO',status:'APPROVED'}],
    calendar:[],hasApprovedData:true,charges:null,is_data_gap:true,
  })}).mockRejectedValueOnce(new Error('Live evidence unavailable'));
  vi.stubGlobal('fetch',fetchMock);
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  try {
    const demoSite = state.site;
    state.site = null as any;
    await act(async()=>{root.render(<CompliancePage/>);});
    state.site = demoSite;
    await act(async()=>{root.render(<CompliancePage/>);});
    expect(container.textContent).toContain('PRIOR DEMO RULE');
    state.site={...state.site,id:'live-site',is_demo:false};
    await act(async()=>{root.render(<CompliancePage/>);});
    expect(fetchMock).toHaveBeenLastCalledWith('/api/compliance?siteId=live-site');
    expect(container.textContent).not.toContain('PRIOR DEMO RULE');
    expect(container.textContent).not.toContain('APPROVED RECORDS LOADED');
    expect(container.textContent).toContain('Live evidence unavailable');
  } finally {
    await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();
  }
});
