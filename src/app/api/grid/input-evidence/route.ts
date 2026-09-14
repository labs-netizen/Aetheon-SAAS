import { NextRequest, NextResponse } from 'next/server';
import { resolveGridInputEvidence } from '@/lib/analytics/grid-input-evidence';
import { validDate } from '@/lib/analytics/domain-safety';
import { authorizeApiRequest } from '@/lib/auth/api-guard';

export async function GET(req: NextRequest) {
  const bearer = req.headers.get('authorization');
  if (!bearer?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'AUTHENTICATED_BEARER_REQUIRED' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('site_id');
  const operatingDate = searchParams.get('operating_date');
  if (!siteId || (operatingDate !== null && !validDate(operatingDate))) {
    return NextResponse.json({ error: 'INVALID_INPUT_EVIDENCE_REQUEST' }, { status: 400 });
  }

  const authResult = await authorizeApiRequest(req, {
    siteId,
    productId: 'GRID_INTELLIGENCE',
  });
  if (!authResult.authorized) return authResult.response;
  if (!authResult.authenticatedClient) {
    return NextResponse.json({ error: 'AUTHENTICATED_BEARER_REQUIRED' }, { status: 401 });
  }

  try {
    const evidence = await resolveGridInputEvidence(authResult.authenticatedClient, siteId, operatingDate);
    return NextResponse.json({
      site_id: siteId,
      operating_date: evidence.operating_date,
      expected_blocks: evidence.total_blocks_expected,
      received_blocks: evidence.total_blocks_received,
      completeness_pct: evidence.completeness_pct,
      duplicate_blocks: evidence.duplicate_blocks,
      missing_blocks: evidence.missing_blocks,
      quality_status: evidence.quality_status,
      freshness_status: evidence.freshness,
      data_available: evidence.data_available,
    });
  } catch (error) {
    return NextResponse.json({
      error: 'GRID_INPUT_LOOKUP_FAILED',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
