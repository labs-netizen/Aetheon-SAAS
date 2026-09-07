import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { validate96BlockContiguity, parseAndValidateCsv } from '@/features/ingestion/csvParser';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, filename, csvText, fileContent, parsedData: clientParsedData } = body;

    if (!siteId || !filename) {
      return NextResponse.json(
        { error: 'siteId and filename are required' },
        { status: 400 }
      );
    }

    // 1. Authorize: Authentication, Org membership, Site access, and Role permission
    const authResult = await authorizeApiRequest(req, {
      siteId,
      requiredRoles: ['ORGANISATION_ADMIN', 'ENERGY_MANAGER'],
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    // 2. Server-calculated SHA-256 Checksum (Never trust client-supplied checksum)
    const rawContent = csvText || fileContent || (clientParsedData ? JSON.stringify(clientParsedData) : '');
    if (!rawContent) {
      return NextResponse.json(
        { error: 'csvText, fileContent, or non-empty parsedData is required for ingestion' },
        { status: 400 }
      );
    }

    const serverChecksum = crypto.createHash('sha256').update(rawContent).digest('hex');

    // 3. Resolve or parse 96-block rows
    let rowsToIngest: any[] = [];
    if (clientParsedData && Array.isArray(clientParsedData) && clientParsedData.length > 0) {
      rowsToIngest = clientParsedData;
    } else if (csvText || fileContent) {
      const parsed = parseAndValidateCsv(csvText || fileContent, siteId);
      if (parsed.errors.length > 0 || parsed.acceptedRows !== 96) {
        return NextResponse.json(
          { error: 'CSV_PARSING_FAILED', errors: parsed.errors },
          { status: 422 }
        );
      }
      rowsToIngest = parsed.parsedData;
    }

    // 4. Validate 96-block contiguity & completeness
    const contiguity = validate96BlockContiguity(rowsToIngest);
    if (!contiguity.isContiguous) {
      return NextResponse.json(
        {
          error: 'NON_CONTIGUOUS_BLOCKS',
          message: 'The submitted interval data does not form a complete 1-96 contiguous block set.',
          missingBlocksByDate: contiguity.missingBlocksByDate,
        },
        { status: 422 }
      );
    }

    const adminClient = createAdminClient();

    // 5. Store raw file privately in tenant-uploads bucket
    const storagePath = `tenants/${authResult.organisationId}/${siteId}/${filename}_${serverChecksum.slice(0, 8)}.csv`;
    try {
      await adminClient.storage
        .from('tenant-uploads')
        .upload(storagePath, rawContent, {
          contentType: 'text/csv',
          upsert: true,
        });
    } catch (storageErr) {
      console.warn('Tenant upload private storage warning:', storageErr);
    }

    // 6. Compute real freshness based on operating date relative to current time
    const operatingDateStr = rowsToIngest[0]?.operating_date || new Date().toISOString().split('T')[0];
    const opDate = new Date(operatingDateStr);
    const diffHours = (Date.now() - opDate.getTime()) / (1000 * 60 * 60);
    const freshnessStatus = diffHours <= 24 ? 'RECENT' : diffHours <= 168 ? 'DELAYED' : 'STALE';

    // Prepare rows for PostgreSQL JSONB RPC
    const formattedRows = rowsToIngest.map((row: any) => {
      const hour = Math.floor((row.block_index - 1) / 4);
      const min = ((row.block_index - 1) % 4) * 15;
      const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
      const timestampUtc = new Date(`${row.operating_date}T${timeStr}+05:30`).toISOString();

      return {
        operating_date: row.operating_date,
        block_index: row.block_index,
        timestamp_utc: timestampUtc,
        load_kw: Number(row.load_kw),
        solar_generation_kw: Number(row.solar_generation_kw || row.generation_solar_kw || 0),
        actual_drawal_kw: row.actual_drawal_kw !== null && row.actual_drawal_kw !== undefined ? Number(row.actual_drawal_kw) : null,
        scheduled_drawal_kw: row.scheduled_drawal_kw !== null && row.scheduled_drawal_kw !== undefined ? Number(row.scheduled_drawal_kw) : null,
      };
    });

    // 7. Atomic Transactional Commit via PostgreSQL RPC
    const { data: rpcResult, error: rpcError } = await adminClient.rpc(
      'commit_ingestion_transaction',
      {
        p_site_id: siteId,
        p_filename: filename,
        p_checksum_sha256: serverChecksum,
        p_uploaded_by: authResult.user.id,
        p_rows: formattedRows,
        p_freshness_status: freshnessStatus,
        p_actor_role: authResult.role,
        p_org_id: authResult.organisationId,
      }
    );

    if (rpcError) {
      if (rpcError.message.includes('DUPLICATE_FILE')) {
        return NextResponse.json(
          {
            error: 'DUPLICATE_FILE',
            message: `This file has already been ingested for site '${siteId}' (Checksum: ${serverChecksum}).`,
            checksum: serverChecksum,
          },
          { status: 409 }
        );
      }

      console.error('Transactional ingestion RPC error:', rpcError);
      return NextResponse.json(
        { error: 'TRANSACTION_FAILED', message: rpcError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Transactionally committed ${formattedRows.length} interval blocks into persistent database.`,
      ingestionRunId: rpcResult?.ingestion_run_id,
      siteId,
      totalBlocks: formattedRows.length,
      serverChecksum,
      freshnessStatus,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
