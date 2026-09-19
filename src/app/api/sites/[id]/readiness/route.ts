import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { loadGridHistoricalInput, resolveGridInputEvidence } from '@/lib/analytics/grid-input-evidence';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const siteId = params.id;
  const auth = await authorizeApiRequest(req, { siteId, requireBearer: true });
  if (!auth.authorized) return auth.response;
  if (!auth.authenticatedClient) {
    return NextResponse.json({ error: 'AUTHENTICATED_BEARER_REQUIRED' }, { status: 401 });
  }

  const db = auth.authenticatedClient;
  const [siteResult, qualityResult, solarResult, bessResult] = await Promise.all([
    db.from('sites').select('id,is_demo,activation_status').eq('id', siteId).single(),
    db.from('data_quality_evaluations')
      .select('evaluation_date,completeness_pct,missing_blocks_count,validation_status')
      .eq('site_id', siteId).order('evaluation_date', { ascending: false }).limit(1000),
    db.from('renewable_assets').select('id').eq('site_id', siteId).eq('is_active', true).limit(1),
    db.from('bess_assets').select('id').eq('site_id', siteId).eq('is_active', true).limit(1),
  ]);

  const lookupError = siteResult.error || qualityResult.error || solarResult.error || bessResult.error;
  if (lookupError || !siteResult.data) {
    console.error('Site readiness evidence lookup failed', {
      siteId,
      source: siteResult.error || !siteResult.data ? 'sites' : qualityResult.error ? 'data_quality_evaluations'
        : solarResult.error ? 'renewable_assets' : 'bess_assets',
      error: lookupError?.message,
    });
    return NextResponse.json({ error: 'SITE_READINESS_LOOKUP_FAILED' }, { status: 500 });
  }

  let validatedCompleteDays = 0;
  let latestOperatingDate: string | null = null;
  let latestEvidence;
  try {
    const { data: latestRow, error: latestError } = await db.from('interval_data_96')
      .select('operating_date').eq('site_id', siteId)
      .order('operating_date', { ascending: false }).limit(1).maybeSingle();
    if (latestError) throw new Error(`INTERVAL_DATE_LOOKUP_FAILED: ${latestError.message}`);
    latestOperatingDate = latestRow?.operating_date || null;
    latestEvidence = await resolveGridInputEvidence(db, siteId, latestOperatingDate);

    const qualityRows = qualityResult.data || [];
    if (qualityRows.length > 0 && qualityRows.length < 1000) {
      validatedCompleteDays = new Set(qualityRows.filter((row) => Number(row.completeness_pct) === 100 &&
        Number(row.missing_blocks_count) === 0 &&
        (row.validation_status === 'PASSED' || row.validation_status === 'WARNING'))
        .map((row) => row.evaluation_date)).size;
    } else if (latestOperatingDate) {
      // Older valid interval records may predate the quality summary. Validate
      // their actual 96-block days instead of treating absent summaries as no data.
      const history = await loadGridHistoricalInput(db, siteId, 426, latestOperatingDate);
      validatedCompleteDays = history.complete_days.length;
    }
  } catch (error) {
    console.error('Site readiness evidence lookup failed', {
      siteId,
      source: 'interval_data_96',
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'SITE_READINESS_LOOKUP_FAILED' }, { status: 500 });
  }

  return NextResponse.json({
    site_id: siteId,
    activation_status: siteResult.data.activation_status,
    is_demo: siteResult.data.is_demo === true,
    interval_evidence: {
      has_validated_history: validatedCompleteDays > 0,
      validated_complete_days: validatedCompleteDays,
      latest_operating_date: latestOperatingDate,
      latest_evidence_valid: latestEvidence.is_complete,
      quality_status: latestEvidence.quality_status,
      freshness_status: latestEvidence.freshness,
      source: 'interval_data_96',
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
