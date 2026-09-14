import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { operatingToday, validDate } from '@/lib/analytics/domain-safety';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  const bearer = req.headers.get('authorization');
  if (!bearer?.startsWith('Bearer ')) return NextResponse.json({ error: 'AUTHENTICATED_BEARER_REQUIRED' }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const siteId = params.get('site_id');
  const requestedDate = params.get('delivery_date');
  if (!siteId || (requestedDate !== null && !validDate(requestedDate))) return NextResponse.json({ error: 'INVALID_PRICE_EVIDENCE_REQUEST' }, { status: 400 });
  const auth = await authorizeApiRequest(req, { siteId, productId: 'GRID_INTELLIGENCE' });
  if (!auth.authorized) return auth.response;
  const db = createAdminClient();
  let deliveryDate = requestedDate;
  if (!deliveryDate) {
    const { data, error } = await db.from('market_price_blocks').select('delivery_date').eq('exchange', 'IEX').eq('market_product', 'DAM')
      .eq('verification_status', 'VERIFIED').order('delivery_date', { ascending: false }).limit(1).maybeSingle();
    if (error) return NextResponse.json({ error: 'PRICE_EVIDENCE_LOOKUP_FAILED', details: error.message }, { status: 500 });
    deliveryDate = data?.delivery_date || null;
  }
  if (!deliveryDate) return NextResponse.json({ site_id: siteId, exchange: 'IEX', market_product: 'DAM', delivery_date: null,
    expected_blocks: 96, received_blocks: 0, completeness_pct: 0, missing_blocks: Array.from({ length: 96 }, (_, i) => i + 1),
    duplicate_blocks: [], readiness_status: 'MISSING', price_available: false, suppression_reason: 'AUTHORITATIVE_PRICE_FEED_REQUIRED', blocks: [] });
  const { data: rows, error } = await db.from('market_price_blocks')
    .select('delivery_date,block_index,time_start,time_end,mcp_rs_per_mwh,source_type,source_reference,source_file_hash,published_at,fetched_at,ingested_at,provenance_status,verification_status')
    .eq('exchange', 'IEX').eq('market_product', 'DAM').eq('delivery_date', deliveryDate).order('block_index');
  if (error) return NextResponse.json({ error: 'PRICE_EVIDENCE_LOOKUP_FAILED', details: error.message }, { status: 500 });
  const blockCounts = new Map<number, number>();
  for (const row of rows || []) blockCounts.set(Number(row.block_index), (blockCounts.get(Number(row.block_index)) || 0) + 1);
  const received = [...blockCounts.keys()].filter((block) => block >= 1 && block <= 96).length;
  const missing = Array.from({ length: 96 }, (_, i) => i + 1).filter((block) => !blockCounts.has(block));
  const duplicates = [...blockCounts].filter(([, count]) => count > 1).map(([block]) => block);
  const verified = received === 96 && rows?.length === 96 && duplicates.length === 0 && rows.every((row) => row.verification_status === 'VERIFIED' && row.provenance_status === 'OFFICIAL_SOURCE_CONFIRMED');
  let latestAvailableDate: string | null = null;
  if (!verified && requestedDate) {
    const { data: latest } = await db.from('market_price_blocks').select('delivery_date').eq('exchange', 'IEX').eq('market_product', 'DAM')
      .eq('verification_status', 'VERIFIED').order('delivery_date', { ascending: false }).limit(1).maybeSingle();
    latestAvailableDate = latest?.delivery_date || null;
  }
  const status = verified
    ? (deliveryDate < operatingToday() ? 'STALE' : 'READY')
    : latestAvailableDate && latestAvailableDate !== requestedDate ? 'DATE_MISMATCH' : 'MISSING';
  return NextResponse.json({ site_id: siteId, exchange: 'IEX', market_product: 'DAM', delivery_date: deliveryDate,
    latest_available_date: latestAvailableDate, expected_blocks: 96, received_blocks: received,
    completeness_pct: Number(((received / 96) * 100).toFixed(2)), missing_blocks: missing, duplicate_blocks: duplicates,
    readiness_status: status, price_available: verified, suppression_reason: status === 'READY' ? null : status === 'STALE' ? 'STALE_MARKET_PRICE_EVIDENCE' : status === 'DATE_MISMATCH' ? 'PRICE_DATE_MISMATCH' : 'AUTHORITATIVE_PRICE_FEED_REQUIRED',
    provenance: rows?.[0] ? { source_type: rows[0].source_type, source_reference: rows[0].source_reference, source_file_hash: rows[0].source_file_hash,
      published_at: rows[0].published_at, fetched_at: rows[0].fetched_at, ingested_at: rows[0].ingested_at,
      provenance_status: rows[0].provenance_status, verification_status: rows[0].verification_status } : null,
    blocks: verified ? rows.map((row) => ({ block_index: row.block_index, time_start: row.time_start, time_end: row.time_end, mcp_rs_per_mwh: Number(row.mcp_rs_per_mwh) })) : [] });
}
