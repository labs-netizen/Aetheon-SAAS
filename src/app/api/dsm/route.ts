import { NextRequest, NextResponse } from 'next/server';
import { fetchDSMCalculation } from '@/lib/analytics/client';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, operatingDate, scheduledDrawalKw, actualDrawalKw, contractDemandKw } = body;

    if (!siteId || !operatingDate || !contractDemandKw) {
      return NextResponse.json(
        { error: 'siteId, operatingDate, and contractDemandKw are required' },
        { status: 400 }
      );
    }

    // 1. Authorize: User Authentication, Org Membership, Site Access, Product Entitlement
    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'DSM_RISK',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    // 2. Section 11: Missing schedule or actual meter data -> suppress compliance/exposure result
    if (
      !scheduledDrawalKw ||
      !actualDrawalKw ||
      !Array.isArray(scheduledDrawalKw) ||
      !Array.isArray(actualDrawalKw) ||
      scheduledDrawalKw.length === 0 ||
      actualDrawalKw.length === 0
    ) {
      return NextResponse.json(
        {
          is_suppressed: true,
          suppression_reason: 'MISSING_DATA: Missing approved schedule or actual meter interval data.',
          summary: {
            total_deviation_kwh: 0,
            estimated_penalty_inr: 0,
            high_risk_blocks_count: 0,
            quality_status: 'BLOCKED_MISSING_INPUT',
          },
          blocks: [],
          incidents: [],
        },
        { status: 200 }
      );
    }

    // 3. Call FastAPI analytics microservice
    let calculationResult: any;
    try {
      calculationResult = await fetchDSMCalculation({
        siteId,
        operatingDate,
        scheduledDrawalKw,
        actualDrawalKw,
        contractDemandKw,
      });
    } catch (apiErr) {
      return NextResponse.json(
        {
          error: 'ANALYTICS_SERVICE_UNAVAILABLE',
          details: apiErr instanceof Error ? apiErr.message : String(apiErr),
        },
        { status: 502 }
      );
    }

    // 4. Persist identified incidents to dsm_incidents safely via service client
    const adminClient = createAdminClient();
    try {
      if (calculationResult.incidents && Array.isArray(calculationResult.incidents) && calculationResult.incidents.length > 0) {
        const incidentRows = calculationResult.incidents.map((inc: any) => ({
          site_id: siteId,
          operating_date: operatingDate,
          start_block: inc.start_block,
          end_block: inc.end_block,
          severity: inc.severity,
          max_deviation_pct: inc.max_deviation_pct,
          total_excess_energy_kwh: inc.total_excess_energy_kwh,
          estimated_exposure_inr: inc.estimated_exposure_inr,
          root_cause_tag: inc.root_cause_tag || 'DEVIATION_SPIKE',
        }));

        const { error: incError } = await adminClient.from('dsm_incidents').insert(incidentRows);
        if (incError) {
          throw new Error(incError.message);
        }
      }
      calculationResult.persisted = true;
    } catch (dbErr) {
      console.error('CRITICAL: DSM incident persistence failure:', dbErr);
      return NextResponse.json(
        {
          error: 'PERSISTENCE_FAILED',
          message: 'DSM evaluation computed but persistence failed; output cannot be published.',
          details: dbErr instanceof Error ? dbErr.message : String(dbErr),
        },
        { status: 500 }
      );
    }

    return NextResponse.json(calculationResult);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to process DSM calculation', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
