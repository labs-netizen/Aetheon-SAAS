import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import RenewablesPage from '@/app/renewables/page';

const state=vi.hoisted(()=>({site:{id:'demo-site',is_demo:true}}));
vi.mock('@/components/layout/SiteContext',()=>({useSite:()=>({currentSite:state.site,isEntitled:()=>true})}));
vi.mock('@/components/shared/ModuleGate',()=>({ModuleGate:({children}:any)=><>{children}</>}));
vi.mock('@/components/shared/ProvenanceFooter',()=>({ProvenanceFooter:()=>null}));

it('removes synthetic renewable outputs when switching to a live site whose request fails',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({persisted:true,total_measured_generation_kwh:4420,
    total_modelled_generation_kwh:4680,avoided_emissions_tco2e:3.16})}).mockResolvedValueOnce({ok:false,json:async()=>({error:'RECONCILIATION_NOT_PUBLISHABLE'})}));
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  try {
    await act(async()=>root.render(<RenewablesPage/>));
    expect(container.textContent).toContain('DB PERSISTED LEDGER');
    state.site={id:'live-site',is_demo:false};
    await act(async()=>root.render(<RenewablesPage/>));
    expect(container.textContent).not.toContain('DB PERSISTED LEDGER');
    expect(container.textContent).not.toContain('Rooftop Solar PV Array 1');
    expect(container.textContent).toContain('Live reconciliation unavailable');
  }finally{
    await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();
  }
});
