import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { reportEvidenceValid } from '@/lib/analytics/report-evidence';
import { type ReportType, type ProductId } from '@/types';

const REPORT_PRODUCT_REQUIREMENTS: Record<ReportType, ProductId> = {
  GRID_DAILY_BRIEF: 'GRID_INTELLIGENCE',
  GRID_MONTHLY_REPORT: 'GRID_INTELLIGENCE',
  DSM_MONTHLY_REVIEW: 'DSM_RISK',
  BESS_PERFORMANCE_REPORT: 'BESS_ARBITRAGE',
  RENEWABLES_RECONCILIATION: 'RENEWABLE_PORTFOLIO',
  COMPLIANCE_AUDIT: 'OA_COMPLIANCE',
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json(
        { error: 'siteId query parameter is required' },
        { status: 400 }
      );
    }

    const authResult = await authorizeApiRequest(req, { siteId });
    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // 2. Query user organisation's active product entitlements to enforce module-level visibility
    const { data: entitlements } = await adminClient
      .from('entitlements')
      .select('product_id, site_id, is_active')
      .lte('valid_from', new Date().toISOString())
      .or(`valid_until.is.null,valid_until.gt.${new Date().toISOString()}`)
      .eq('organisation_id', authResult.organisationId)
      .eq('is_active', true);

    const activeProductIds = new Set<string>();
    entitlements?.forEach((e) => {
      if (!e.site_id || e.site_id === siteId) {
        activeProductIds.add(e.product_id);
      }
    });

    const isPrivileged = Boolean(authResult.user.is_platform_admin || authResult.role === 'AETHEON_ANALYST');

    const { data: reports, error: reportsErr } = await adminClient
      .from('report_records')
      .select('id, module, report_type, period_start, period_end, title, summary, quality_status, model_version, tariff_version, rule_version, generation_time, created_at, download_url')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false });

    if (reportsErr) {
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: reportsErr.message },
        { status: 500 }
      );
    }

    // Filter reports so that customer only sees reports for modules they are entitled to
    const filteredReports = isPrivileged
      ? (reports || [])
      : (reports || []).filter((r) => {
          const reqProduct = REPORT_PRODUCT_REQUIREMENTS[r.report_type as ReportType] ||
            (r.module === 'GRID' ? 'GRID_INTELLIGENCE' :
             r.module === 'DSM' ? 'DSM_RISK' :
             r.module === 'BESS' ? 'BESS_ARBITRAGE' :
             r.module === 'COMPLIANCE' ? 'OA_COMPLIANCE' :
             r.module === 'RENEWABLE' ? 'RENEWABLE_PORTFOLIO' : null);
          return reqProduct ? activeProductIds.has(reqProduct) : false;
        });

    const { data: site } = await adminClient.from('sites').select('id,state,discom,voltage_category,is_demo').eq('id',siteId).single();
    const evidence = await Promise.all(filteredReports.map(r=>reportEvidenceValid(adminClient,r,site)));
    return NextResponse.json({
      siteId,
      reports: filteredReports.filter((_,i)=>evidence[i]),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
