import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeMarketDataAdmin } from '@/lib/auth/market-data-admin';
import { parseOfficialIexDamCsv, parseOfficialIexDamXlsx, type IexDateFormat } from '@/features/market-prices/iexDamImporter';

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDataAdmin(req);
  if (!auth.authorized) return auth.response;
  const { data, error } = await auth.adminClient.from('market_price_imports')
    .select('id,exchange,market_product,source_type,source_reference,source_file_name,source_file_hash,published_at,fetched_at,ingested_at,provenance_status,verification_status,delivery_date_start,delivery_date_end,total_rows,total_days')
    .order('ingested_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: 'MARKET_PRICE_STATUS_FAILED', details: error.message }, { status: 500 });
  return NextResponse.json({ latest_import: data ? { ...data,
    source_format: data.source_file_name.toLowerCase().endsWith('.xlsx') ? 'XLSX' : 'CSV' } : null });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeMarketDataAdmin(req);
  if (!auth.authorized) return auth.response;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const sourceReference = String(form?.get('source_reference') || '').trim();
  const officialConfirmed = form?.get('official_source_confirmed') === 'true';
  const previewOnly = form?.get('action') === 'preview';
  const dateFormat = String(form?.get('date_format') || 'AUTO') as IexDateFormat;
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function' ||
      (!previewOnly && !officialConfirmed) || !['AUTO', 'DD/MM/YYYY', 'DD-MM-YYYY'].includes(dateFormat)) {
    return NextResponse.json({ error: 'OFFICIAL_IEX_EXPORT_CONFIRMATION_REQUIRED',
      invalid_fields: { file: !file || typeof file === 'string' || typeof (file as File).arrayBuffer !== 'function', official_source_confirmed: !officialConfirmed, date_format: !['AUTO', 'DD/MM/YYYY', 'DD-MM-YYYY'].includes(dateFormat) } }, { status: 400 });
  }
  if (!/^https:\/\/([^/]+\.)?(iexindia\.com|iexindia\.in)(\/|$)/i.test(sourceReference)) {
    return NextResponse.json({ error: 'OFFICIAL_IEX_SOURCE_REFERENCE_REQUIRED' }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = String(file.name || '');
  const format = filename.toLowerCase().endsWith('.xlsx') ? 'XLSX' : filename.toLowerCase().endsWith('.csv') ? 'CSV' : null;
  if (!format || bytes.length === 0 || bytes.length > 10 * 1024 * 1024 || (format === 'XLSX' && (bytes[0] !== 0x50 || bytes[1] !== 0x4b))) {
    return NextResponse.json({ error: 'UNSUPPORTED_MARKET_PRICE_FILE' }, { status: 400 });
  }
  const parsed = format === 'XLSX' ? await parseOfficialIexDamXlsx(bytes, dateFormat) : parseOfficialIexDamCsv(bytes.toString('utf8'), dateFormat);
  if (!parsed.valid) return NextResponse.json({ error: 'INVALID_IEX_DAM_EXPORT', summary: parsed }, { status: 400 });
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const preview = { source_filename: filename, source_format: format, source_reference: sourceReference,
    checksum_sha256: checksum, detected_sheet: parsed.detected_sheet ?? null,
    delivery_dates: parsed.delivery_dates, total_rows: parsed.total_rows, total_days: parsed.total_days,
    received_blocks: parsed.rows.length, expected_blocks: parsed.total_days * 96,
    mcp_unit: 'Rs/MWh', mcp: parsed.preview, summary_rows_ignored: parsed.summary_rows_ignored ?? 0,
    verification_status: previewOnly ? 'PENDING_CONFIRMATION' : 'VERIFIED' };
  if (previewOnly) return NextResponse.json({ preview });
  if (form?.get('preview_checksum_sha256') !== checksum) {
    return NextResponse.json({ error: 'MARKET_PRICE_PREVIEW_CONFIRMATION_REQUIRED' }, { status: 400 });
  }
  const { data, error } = await auth.adminClient.rpc('commit_iex_dam_market_prices', {
    p_actor_id: auth.actorId,
    p_source_file_name: file.name,
    p_source_file_hash: checksum,
    p_source_reference: sourceReference,
    p_published_at: form?.get('published_at') ? String(form.get('published_at')) : null,
    p_fetched_at: new Date().toISOString(),
    p_rows: parsed.rows,
  });
  if (error) {
    const duplicate = error.message.includes('DUPLICATE_MARKET_PRICE_FILE') || error.message.includes('MARKET_PRICE_DATE_ALREADY_IMPORTED');
    return NextResponse.json({ error: duplicate ? 'DUPLICATE_MARKET_PRICE_IMPORT' : 'MARKET_PRICE_COMMIT_FAILED', details: error.message }, { status: duplicate ? 409 : 500 });
  }
  return NextResponse.json({ ...data, preview, checksum_sha256: checksum, provenance_status: 'OFFICIAL_SOURCE_CONFIRMED', verification_status: 'VERIFIED' });
}
