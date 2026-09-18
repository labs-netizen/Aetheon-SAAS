import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const siteId = params.id;
  const auth = await authorizeApiRequest(req, { siteId, requireBearer: true });
  if (!auth.authorized) return auth.response;

  const db = createAdminClient();
  const [siteResult, qualityResult, solarResult, bessResult] = await Promise.all([
    db.from('sites').select('id,is_demo,activation_status').eq('id', siteId).single(),
    db.from('data_quality_evaluations')
      .select('evaluation_date,completeness_pct,missing_blocks_count,freshness_status,validation_status,publication_gate_status')
      .eq('site_id', siteId)
      .order('evaluation_date', { ascending: false })
      .limit(1000),
    db.from('renewable_assets').select('id').eq('site_id', siteId).eq('is_active', true).limit(1),
    db.from('bess_assets').select('id').eq('site_id', siteId).eq('is_active', true).limit(1),
  ]);

  const lookupError = siteResult.error || qualityResult.error || solarResult.error || bessResult.error;
  if (lookupError || !siteResult.data) {
    console.error('Site readiness evidence lookup failed', { siteId, error: lookupError?.message });
    return NextResponse.json({ error: 'SITE_READINESS_LOOKUP_FAILED' }, { status: 500 });
  }

  const qualityRows = qualityResult.data || [];
  const completeValidatedDates = new Set(
    qualityRows
      .filter((row) => Number(row.completeness_pct) === 100 && Number(row.missing_blocks_count) === 0 &&
        (row.validation_status === 'PASSED' || row.validation_status === 'WARNING'))
      .map((row) => row.evaluation_date)
  );
  const latestQuality = qualityRows[0] || null;
  const latestEvidenceValid = Boolean(latestQuality && Number(latestQuality.completeness_pct) === 100 &&
    Number(latestQuality.missing_blocks_count) === 0 &&
    (latestQuality.validation_status === 'PASSED' || latestQuality.validation_status === 'WARNING'));
  const intervalQualityStatus = latestQuality?.validation_status === 'PASSED' || latestQuality?.validation_status === 'WARNING'
    ? latestQuality.validation_status
    : latestQuality ? 'FAILED' : 'NO_DATA';
  const intervalFreshnessStatus = ['RECENT', 'DELAYED', 'STALE'].includes(latestQuality?.freshness_status)
    ? latestQuality.freshness_status
    : 'UNKNOWN';

  return NextResponse.json({
    site_id: siteId,
    activation_status: siteResult.data.activation_status,
    is_demo: siteResult.data.is_demo === true,
    interval_evidence: {
      has_validated_history: completeValidatedDates.size > 0,
      validated_complete_days: completeValidatedDates.size,
      latest_operating_date: latestQuality?.evaluation_date || null,
      latest_evidence_valid: latestEvidenceValid,
      quality_status: intervalQualityStatus,
      freshness_status: intervalFreshnessStatus,
      source: 'data_quality_evaluations / interval_data_96',
    },
    alert_recipient: {
      configured: false,
      source: 'NOT_CONFIGURED',
      detail: 'No persisted alert-recipient configuration exists for this site.',
    },
    renewable_asset: {
      configured: (solarResult.data?.length || 0) > 0,
      source: 'renewable_assets',
    },
    bess_asset: {
      configured: (bessResult.data?.length || 0) > 0,
      source: 'bess_assets',
    },
  });
}
