'use client';
import { useEffect, useMemo, useState } from 'react';
import { BatteryCharging } from 'lucide-react';
import { useSite } from '@/components/layout/SiteContext';
import { ModuleGate } from '@/components/shared/ModuleGate';
import { createClient } from '@/lib/supabase/client';
import { PRODUCTS } from '@/lib/constants';
import { BessSimulationPanel } from '@/features/bess/BessSimulationPanel';
import type { BESSBehindMeterResponseContract } from '@/types/analytics-contracts';

type Simulation = BESSBehindMeterResponseContract | { status: string; suppression_reason?: string | null };

export default function BESSPage() {
  const { currentSite,isEntitled }=useSite();
  const [result,setResult]=useState<Simulation|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const supabase=useMemo(()=>createClient(),[]);
  useEffect(()=>{let active=true;if(!currentSite?.id)return;setLoading(true);setError(null);void(async()=>{try{const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('AUTHENTICATED_SESSION_REQUIRED');const response=await fetch(`/api/bess/simulation?site_id=${encodeURIComponent(currentSite.id)}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.details||body.error||`HTTP ${response.status}`);if(active)setResult(body.simulation);}catch(failure){if(active)setError(failure instanceof Error?failure.message:String(failure));}finally{if(active)setLoading(false);}})();return()=>{active=false;};},[currentSite?.id,supabase]);
  return <ModuleGate productId="BESS_ARBITRAGE" productName="BESS Arbitrage Signals" description="Behind-the-meter battery energy-shift simulations using explicit site limits and verified evidence." basePricePaise={PRODUCTS.BESS_ARBITRAGE.basePricePaise} isEntitled={isEntitled('BESS_ARBITRAGE')}><div className="space-y-6"><header><h1 className="flex items-center gap-2 text-xl font-bold"><BatteryCharging className="h-5 w-5 text-purple-400"/>BESS Arbitrage Signals (Battery Energy Storage)</h1><p className="mt-1 text-xs text-slate-400">BEHIND-THE-METER BESS ENERGY-SHIFT SIMULATION · advisory only · zero plant control.</p></header><div className="rounded border border-purple-800 p-4 text-xs text-purple-200"><strong>Advisory boundary:</strong> Aetheon does not dispatch a battery, control BMS/SCADA, place bids, enable export, or represent simulated values as guaranteed bill savings.</div>{loading&&<div className="text-sm text-slate-300">Loading verified forecast, exact-date IEX DAM evidence and explicit BESS profile…</div>}{error&&<div role="alert" className="rounded border border-rose-700 p-3 text-sm text-rose-300">BESS simulation unavailable: {error}</div>}{result&&<BessSimulationPanel result={result}/>}</div></ModuleGate>;
}
