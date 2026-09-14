import type { SupabaseClient } from '@supabase/supabase-js';

export interface GridInputEvidence {
  operating_date: string | null;
  total_blocks_expected: 96;
  total_blocks_received: number;
  completeness_pct: number;
  is_complete: boolean;
  freshness: 'RECENT' | 'DELAYED' | 'STALE' | 'UNKNOWN';
  latest_timestamp_utc: string | null;
  source: 'interval_data_96';
}

export async function parseGridForecastResponse(response: Response): Promise<{ data: any; warning: string | null }> {
  const payload = await response.json().catch(() => ({}));
  const message = payload.message || payload.error || `HTTP ${response.status}`;
  if (!response.ok) {
    if (payload.is_suppressed === true && payload.input_evidence) {
      return { data: payload, warning: message };
    }
    throw new Error(message);
  }
  return { data: payload, warning: null };
}

export async function resolveGridInputEvidence(
  client: SupabaseClient,
  siteId: string,
  requestedOperatingDate?: string | null
): Promise<GridInputEvidence> {
  let operatingDate = requestedOperatingDate || null;
  if (!operatingDate) {
    const { data: latest, error: latestError } = await client
      .from('interval_data_96')
      .select('operating_date')
      .eq('site_id', siteId)
      .order('operating_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new Error(`GRID_INPUT_LOOKUP_FAILED: ${latestError.message}`);
    operatingDate = latest?.operating_date || null;
  }

  if (!operatingDate) {
    return {
      operating_date: null,
      total_blocks_expected: 96,
      total_blocks_received: 0,
      completeness_pct: 0,
      is_complete: false,
      freshness: 'UNKNOWN',
      latest_timestamp_utc: null,
      source: 'interval_data_96',
    };
  }

  const { data: rows, error } = await client
    .from('interval_data_96')
    .select('block_index, timestamp_utc, load_kw, data_quality')
    .eq('site_id', siteId)
    .eq('operating_date', operatingDate)
    .order('block_index', { ascending: true });
  if (error) throw new Error(`GRID_INPUT_LOOKUP_FAILED: ${error.message}`);

  const validBlocks = new Set<number>();
  let latestTimestamp: string | null = null;
  let allRowsPassed = true;
  for (const row of rows || []) {
    const blockIndex = Number(row.block_index);
    const loadKw = Number(row.load_kw);
    if (Number.isInteger(blockIndex) && blockIndex >= 1 && blockIndex <= 96 && Number.isFinite(loadKw)) {
      validBlocks.add(blockIndex);
    }
    if (row.data_quality !== 'PASSED' && row.data_quality !== 'WARNING') allRowsPassed = false;
    if (row.timestamp_utc && (!latestTimestamp || Date.parse(row.timestamp_utc) > Date.parse(latestTimestamp))) {
      latestTimestamp = row.timestamp_utc;
    }
  }

  const received = validBlocks.size;
  const completedDayAt = Date.parse(`${operatingDate}T00:00:00+05:30`) + 86400000;
  const ageHours = Number.isFinite(completedDayAt) ? (Date.now() - completedDayAt) / 3600000 : Number.POSITIVE_INFINITY;
  const freshness = !Number.isFinite(completedDayAt) ? 'UNKNOWN'
    : ageHours <= 24 ? 'RECENT'
    : ageHours <= 168 ? 'DELAYED'
    : 'STALE';

  return {
    operating_date: operatingDate,
    total_blocks_expected: 96,
    total_blocks_received: received,
    completeness_pct: Number(((received / 96) * 100).toFixed(2)),
    is_complete: received === 96 && (rows?.length || 0) === 96 && allRowsPassed,
    freshness,
    latest_timestamp_utc: latestTimestamp,
    source: 'interval_data_96',
  };
}
