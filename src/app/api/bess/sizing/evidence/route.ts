import { NextRequest,NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { operatingToday,validDate } from '@/lib/analytics/domain-safety';
import { loadGridHistoricalInput } from '@/lib/analytics/grid-input-evidence';
import { loadBessProfile } from '@/lib/analytics/bess-simulation';
import { buildBessSizingEvidenceCatalog,evaluateHistoricalBessSizingReadiness,loadBessSizingPriceEvidence } from '@/lib/analytics/bess-sizing-evidence';

const exposedDay=({profile:_profile,forecast:_forecast,prices:_prices,...day}:Awaited<ReturnType<typeof evaluateHistoricalBessSizingReadiness>>)=>day;

export async function GET(req:NextRequest){
  if(!req.headers.get('authorization')?.startsWith('Bearer '))return NextResponse.json({error:'AUTHENTICATED_SESSION_REQUIRED'},{status:401});
  const url=new URL(req.url);const siteId=url.searchParams.get('site_id');const targetDate=url.searchParams.get('target_date');
  if(!siteId)return NextResponse.json({error:'SITE_ID_REQUIRED'},{status:400});
  if(targetDate&&(!validDate(targetDate)||targetDate>=operatingToday()))return NextResponse.json({error:'HISTORICAL_TARGET_DATE_REQUIRED'},{status:400});
  const auth=await authorizeApiRequest(req,{siteId,productId:'BESS_ARBITRAGE',requireBearer:true});if(!auth.authorized)return auth.response;
  if(!auth.authenticatedClient||auth.isDemo||!auth.site||auth.site.id!==siteId||auth.site.organisation_id!==auth.organisationId)
    return NextResponse.json({error:'SITE_ACCESS_DENIED'},{status:403});
  try{
    if(targetDate){
      const readiness=await evaluateHistoricalBessSizingReadiness({client:auth.authenticatedClient,priceClient:createAdminClient(),siteId,
        organisationId:auth.organisationId,targetDate,contractDemandKw:Number(auth.site.contract_demand_value)});
      return NextResponse.json({site_id:siteId,evidence_contract:'FORECAST_BASED_HISTORICAL_SIZING',day:exposedDay(readiness),generated_at:new Date().toISOString()});
    }
    const [history,profile,prices]=await Promise.all([
      loadGridHistoricalInput(auth.authenticatedClient,siteId,426),
      loadBessProfile(auth.authenticatedClient,siteId,auth.organisationId),
      loadBessSizingPriceEvidence(createAdminClient()),
    ]);
    const inventory=buildBessSizingEvidenceCatalog(history.complete_days,prices,Boolean(profile),operatingToday());
    const days=[];
    for(const candidate of inventory){
      if(candidate.readiness_status!=='FORECAST_READINESS_NOT_EVALUATED'){days.push(candidate);continue;}
      const readiness=await evaluateHistoricalBessSizingReadiness({client:auth.authenticatedClient,priceClient:createAdminClient(),siteId,
        organisationId:auth.organisationId,targetDate:candidate.date,contractDemandKw:Number(auth.site.contract_demand_value)});
      days.push(exposedDay(readiness));
    }
    const readyDays=days.filter(day=>day.sizing_ready&&day.readiness_status==='READY');
    return NextResponse.json({site_id:siteId,evidence_contract:'FORECAST_BASED_HISTORICAL_SIZING',days:readyDays,
      diagnostic_days:days,eligible_dates:readyDays.map(day=>day.date),generated_at:new Date().toISOString()});
  }catch(error){const details=error instanceof Error?error.message:String(error);const denied=/permission denied|42501/i.test(details);
    console.error('BESS sizing evidence discovery failed',{siteId,error:details});
    return NextResponse.json({error:denied?'BESS_SIZING_EVIDENCE_ACCESS_DENIED':'BESS_SIZING_EVIDENCE_LOOKUP_FAILED'},{status:denied?403:500});}
}
