import { NextRequest,NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { operatingToday } from '@/lib/analytics/domain-safety';
import { loadGridHistoricalInput } from '@/lib/analytics/grid-input-evidence';
import { loadBessProfile } from '@/lib/analytics/bess-simulation';
import { buildBessSizingEvidenceCatalog,loadBessSizingPriceEvidence } from '@/lib/analytics/bess-sizing-evidence';

export async function GET(req:NextRequest){
  if(!req.headers.get('authorization')?.startsWith('Bearer '))return NextResponse.json({error:'AUTHENTICATED_SESSION_REQUIRED'},{status:401});
  const siteId=new URL(req.url).searchParams.get('site_id');if(!siteId)return NextResponse.json({error:'SITE_ID_REQUIRED'},{status:400});
  const auth=await authorizeApiRequest(req,{siteId,productId:'BESS_ARBITRAGE',requireBearer:true});if(!auth.authorized)return auth.response;
  if(!auth.authenticatedClient||auth.isDemo||!auth.site||auth.site.id!==siteId||auth.site.organisation_id!==auth.organisationId)
    return NextResponse.json({error:'SITE_ACCESS_DENIED'},{status:403});
  try{
    const [history,profile,prices]=await Promise.all([
      loadGridHistoricalInput(auth.authenticatedClient,siteId,426),
      loadBessProfile(auth.authenticatedClient,siteId,auth.organisationId),
      loadBessSizingPriceEvidence(createAdminClient()),
    ]);
    const days=buildBessSizingEvidenceCatalog(history.complete_days,prices,Boolean(profile),operatingToday());
    return NextResponse.json({site_id:siteId,evidence_contract:'FORECAST_BASED_HISTORICAL_SIZING',days,
      eligible_dates:days.filter(day=>day.eligible).map(day=>day.date),generated_at:new Date().toISOString()});
  }catch(error){const details=error instanceof Error?error.message:String(error);const denied=/permission denied|42501/i.test(details);
    console.error('BESS sizing evidence discovery failed',{siteId,error:details});
    return NextResponse.json({error:denied?'BESS_SIZING_EVIDENCE_ACCESS_DENIED':'BESS_SIZING_EVIDENCE_LOOKUP_FAILED'},{status:denied?403:500});}
}
