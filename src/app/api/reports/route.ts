import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

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

    return NextResponse.json({
      siteId,
      reports: reports || [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
