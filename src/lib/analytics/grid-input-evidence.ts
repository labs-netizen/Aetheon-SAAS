import type { SupabaseClient } from '@supabase/supabase-js';

export interface GridInputEvidence {
  operating_date: string | null;
  total_blocks_expected: 96;
  total_blocks_received: number;
  completeness_pct: number;
  duplicate_blocks: number[];
  missing_blocks: number[];
  quality_status: 'PASSED' | 'WARNING' | 'FAILED' | 'NO_DATA';
  is_complete: boolean;
  data_available: boolean;
  freshness: 'RECENT' | 'DELAYED' | 'STALE' | 'UNKNOWN';
  latest_timestamp_utc: string | null;
  source: 'interval_data_96';
}

const emptyEvidence = (): GridInputEvidence => ({
  operating_date: null,
  total_blocks_expected: 96,
  total_blocks_received: 0,
  completeness_pct: 0,
  duplicate_blocks: [],
  missing_blocks: Array.from({ length: 96 }, (_, index) => index + 1),
  quality_status: 'NO_DATA',
  is_complete: false,
  data_available: false,
  freshness: 'UNKNOWN',
  latest_timestamp_utc: null,
  source: 'interval_data_96',
});

async function readOperatingDay(
  client: SupabaseClient,
  siteId: string,
  operatingDate: string
): Promise<GridInputEvidence> {
  const { data: rows, error } = await client
    .from('interval_data_96')
    .select('block_index, timestamp_utc, load_kw, data_quality')
    .eq('site_id', siteId)
    .eq('operating_date', operatingDate)
    .order('block_index', { ascending: true });
  if (error) throw new Error(`GRID_INPUT_LOOKUP_FAILED: ${error.message}`);

  const validBlocks = new Set<number>();
  const duplicateBlocks = new Set<number>();
  let latestTimestamp: string | null = null;
  let hasWarning = false;
  let hasInvalidQuality = false;
  for (const row of rows || []) {
    const blockIndex = Number(row.block_index);
    const hasLoad = row.load_kw !== null && row.load_kw !== '' && Number.isFinite(Number(row.load_kw));
    if (Number.isInteger(blockIndex) && blockIndex >= 1 && blockIndex <= 96 && hasLoad) {
      if (validBlocks.has(blockIndex)) duplicateBlocks.add(blockIndex);
      validBlocks.add(blockIndex);
    }
    if (row.data_quality === 'WARNING') hasWarning = true;
    else if (row.data_quality !== 'PASSED') hasInvalidQuality = true;
    if (row.timestamp_utc && (!latestTimestamp || Date.parse(row.timestamp_utc) > Date.parse(latestTimestamp))) {
      latestTimestamp = row.timestamp_utc;
    }
  }

  const received = validBlocks.size;
  const missingBlocks = Array.from({ length: 96 }, (_, index) => index + 1)
    .filter((blockIndex) => !validBlocks.has(blockIndex));
  const duplicates = [...duplicateBlocks].sort((a, b) => a - b);
  const completedDayAt = Date.parse(`${operatingDate}T00:00:00+05:30`) + 86400000;
  const ageHours = Number.isFinite(completedDayAt) ? (Date.now() - completedDayAt) / 3600000 : Number.POSITIVE_INFINITY;
  const freshness = !Number.isFinite(completedDayAt) ? 'UNKNOWN'
    : ageHours <= 24 ? 'RECENT'
    : ageHours <= 168 ? 'DELAYED'
    : 'STALE';
  const isComplete = received === 96 && duplicates.length === 0 && (rows?.length || 0) === 96 && !hasInvalidQuality;
  const qualityStatus = received === 0 ? 'NO_DATA'
    : !isComplete || hasInvalidQuality ? 'FAILED'
    : hasWarning ? 'WARNING'
    : 'PASSED';

  return {
    operating_date: operatingDate,
    total_blocks_expected: 96,
    total_blocks_received: received,
    completeness_pct: Number(((received / 96) * 100).toFixed(2)),
    duplicate_blocks: duplicates,
    missing_blocks: missingBlocks,
    quality_status: qualityStatus,
    is_complete: isComplete,
    data_available: received > 0,
    freshness,
    latest_timestamp_utc: latestTimestamp,
    source: 'interval_data_96',
  };
}

export async function resolveGridInputEvidence(
  client: SupabaseClient,
  siteId: string,
  requestedOperatingDate?: string | null
): Promise<GridInputEvidence> {
  if (requestedOperatingDate) return readOperatingDay(client, siteId, requestedOperatingDate);

  let beforeDate: string | null = null;
  let latestAvailable: GridInputEvidence | null = null;
  while (true) {
    let query = client
      .from('interval_data_96')
      .select('operating_date')
      .eq('site_id', siteId)
      .order('operating_date', { ascending: false })
      .limit(1);
    if (beforeDate) query = query.lt('operating_date', beforeDate);
    const { data: latest, error } = await query.maybeSingle();
    if (error) throw new Error(`GRID_INPUT_LOOKUP_FAILED: ${error.message}`);
    const operatingDate = latest?.operating_date || null;
    if (!operatingDate) return latestAvailable || emptyEvidence();

    const evidence = await readOperatingDay(client, siteId, operatingDate);
    latestAvailable ||= evidence;
    if (evidence.is_complete) return evidence;
    beforeDate = operatingDate;
  }
}
