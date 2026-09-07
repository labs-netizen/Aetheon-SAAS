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

    // Query persisted alerts for this site
    let { data: alerts, error: alertErr } = await adminClient
      .from('alerts')
      .select('*')
      .eq('site_id', siteId)
      .order('triggered_at', { ascending: false });

    if (alertErr) {
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: alertErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      siteId,
      alerts: alerts || [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
