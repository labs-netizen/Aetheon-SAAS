import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { type ReportType, type ProductId } from '@/types';

const REPORT_PRODUCT_REQUIREMENTS: Record<ReportType, ProductId> = {
  GRID_DAILY_BRIEF: 'GRID_INTELLIGENCE',
  GRID_MONTHLY_REPORT: 'GRID_INTELLIGENCE',
  DSM_MONTHLY_REVIEW: 'DSM_RISK',
  BESS_PERFORMANCE_REPORT: 'BESS_ARBITRAGE',
  RENEWABLES_RECONCILIATION: 'RENEWABLE_PORTFOLIO',
  COMPLIANCE_AUDIT: 'OA_COMPLIANCE',
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const reportId = params.id;
  const adminClient = createAdminClient();

  // 1. Fetch Report Record
  const { data: report, error: reportErr } = await adminClient
    .from('report_records')
    .select('*')
    .eq('id', reportId)
    .single();

  if (reportErr || !report) {
    return NextResponse.json(
      { error: 'REPORT_NOT_FOUND', message: 'Report record not found.' },
      { status: 404 }
    );
  }

  // Map report_type or module to required product
  const requiredProduct = REPORT_PRODUCT_REQUIREMENTS[report.report_type as ReportType] ||
    (report.module === 'GRID' ? 'GRID_INTELLIGENCE' :
     report.module === 'DSM' ? 'DSM_RISK' :
     report.module === 'BESS' ? 'BESS_ARBITRAGE' :
     report.module === 'COMPLIANCE' ? 'OA_COMPLIANCE' :
     report.module === 'RENEWABLE' ? 'RENEWABLE_PORTFOLIO' : null);

  // 2. Authorize requester against the report's site AND module entitlement
  const authResult = await authorizeApiRequest(req, {
    siteId: report.site_id,
    organisationId: report.organisation_id,
    productId: requiredProduct || undefined,
  });

  if (!authResult.authorized) {
    return authResult.response;
  }

  // 3. Retrieve actual persisted CSV snapshot from storage bucket or record summary
  let csvBody = '';
  const storagePath = report.storage_path || report.summary?.storage_path;

  if (storagePath) {
    try {
      const { data: fileData, error: downloadErr } = await adminClient.storage
        .from('tenant-reports')
        .download(storagePath);

      if (downloadErr) {
        console.warn('Tenant report download error from storage:', downloadErr);
      } else if (fileData) {
        if (typeof (fileData as any).text === 'function') {
          csvBody = await (fileData as any).text();
        } else if ((fileData as any).buffer && Buffer.isBuffer((fileData as any).buffer)) {
          csvBody = (fileData as any).buffer.toString('utf-8');
        } else if (typeof (fileData as any).arrayBuffer === 'function') {
          const ab = await (fileData as any).arrayBuffer();
          csvBody = Buffer.from(ab).toString('utf-8');
        } else if (Buffer.isBuffer(fileData)) {
          csvBody = fileData.toString('utf-8');
        }
      }
    } catch (e) {
      console.warn('Storage download threw exception:', e);
    }
  }

  if ((!csvBody || csvBody === '[object Blob]') && report.summary?.csv_content) {
    csvBody = report.summary.csv_content;
  }

  if (!csvBody) {
    // If raw file is unavailable, output structured DATA_GAP notice or exact persisted metrics only (never synthetic 4500/2200)
    const summary = report.summary || {};
    if (summary.averagePriceInrPerMwh && summary.peakDemandKw) {
      csvBody = [
        `# AETHEON ENERGY INTELLIGENCE REPORT SNAPSHOT`,
        `# Report ID: ${report.id}`,
        `# Title: ${report.title}`,
        `# Module: ${report.module} | Type: ${report.report_type}`,
        `# Site ID: ${report.site_id}`,
        `# Period: ${report.period_start} to ${report.period_end}`,
        `# Model Version: ${report.model_version}`,
        `# Generated At: ${report.generation_time || report.created_at}`,
        `# Status: ${report.quality_status}`,
        ``,
        `metric_key,value,unit`,
        `average_price_inr_per_mwh,${summary.averagePriceInrPerMwh},INR/MWh`,
        `peak_demand_kw,${summary.peakDemandKw},kW`,
        `quality_gate_status,${report.quality_status},STATUS`,
      ].join('\n');
    } else {
      csvBody = [
        `# AETHEON ENERGY INTELLIGENCE REPORT SNAPSHOT`,
        `# Report ID: ${report.id}`,
        `# Title: ${report.title}`,
        `# Module: ${report.module} | Type: ${report.report_type}`,
        `# Site ID: ${report.site_id}`,
        `# Period: ${report.period_start} to ${report.period_end}`,
        `# Model Version: ${report.model_version}`,
        `# Generated At: ${report.generation_time || report.created_at}`,
        `# Status: REPORT_FILE_UNAVAILABLE`,
        ``,
        `status,reason`,
        `REPORT_FILE_UNAVAILABLE,DATA_GAP: Persisted raw report file is not available in storage archive.`,
      ].join('\n');
    }
  }

  const filename = `${report.report_type}_${report.period_start}_${report.id.substring(0, 8)}.csv`;

  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
