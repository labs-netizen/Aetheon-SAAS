import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { validate96BlockContiguity, parseAndValidateCsv } from '@/features/ingestion/csvParser';

export async function POST(req: NextRequest) {
  try {
    let siteId: string | null = null;
    let filename: string | null = null;
    let rawBuffer: Buffer | null = null;
    let rawCsvText = '';

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      siteId = formData.get('siteId') as string;
      filename = (formData.get('filename') as string) || 'amr_upload.csv';
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json(
          { error: 'FILE_REQUIRED', message: 'multipart/form-data must include an uploaded file' },
          { status: 400 }
        );
      }

      filename = file.name || filename;
      const arrayBuffer = await file.arrayBuffer();
      rawBuffer = Buffer.from(arrayBuffer);
      rawCsvText = rawBuffer.toString('utf-8');
    } else {
      // JSON payload support
      const body = await req.json();
      siteId = body.siteId;
      filename = body.filename || 'amr_upload.csv';
      if (body.csvText) {
        rawCsvText = body.csvText;
        rawBuffer = Buffer.from(rawCsvText, 'utf-8');
      } else if (body.fileContent) {
        rawCsvText = body.fileContent;
        rawBuffer = Buffer.from(rawCsvText, 'utf-8');
      } else if (body.parsedData && Array.isArray(body.parsedData)) {
        if (process.env.NODE_ENV === 'production') {
          return NextResponse.json(
            {
              error: 'PARSED_DATA_DISALLOWED',
              message: 'Direct JSON parsedData injection is disallowed in production. Submit authentic raw CSV file bytes.',
            },
            { status: 400 }
          );
        }
        const header = 'operating_date,block_index,start_time,end_time,load_kw\n';
        const rows = body.parsedData.map((r: any) => `${r.operating_date},${r.block_index},${r.start_time},${r.end_time},${r.load_kw}`).join('\n');
        rawCsvText = header + rows;
        rawBuffer = Buffer.from(rawCsvText, 'utf-8');
      }
    }

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

    if (!rawBuffer || rawCsvText.trim().length === 0) {
      return NextResponse.json(
        { error: 'EMPTY_FILE', message: 'Original raw CSV file bytes are required for ingestion' },
        { status: 400 }
      );
    }

    // 2. Server-calculated SHA-256 Checksum on Actual File Bytes
    const serverChecksum = crypto.createHash('sha256').update(rawBuffer).digest('hex');

    // 3. Authoritative Server-Side CSV Parsing & Schema Validation
    const parseResult = parseAndValidateCsv(rawCsvText, siteId);
    if (parseResult.isDuplicate) {
      return NextResponse.json(
        { error: 'DUPLICATE_FILE', message: 'File with identical content has already been processed for this site' },
        { status: 409 }
      );
    }
    if (parseResult.errors.length > 0 || parseResult.acceptedRows === 0) {
      return NextResponse.json(
        {
          error: 'CSV_PARSING_FAILED',
          message: 'Server CSV validation detected invalid formatting or data violations.',
          errors: parseResult.errors,
          totalRows: parseResult.totalRows,
          daysDetected: parseResult.daysDetected,
          validDays: parseResult.validDays,
          validBlocks: parseResult.validBlocks,
          invalidDays: parseResult.invalidDays,
          invalidRows: parseResult.invalidRows,
          rejectedRows: parseResult.rejectedRows,
        },
        { status: 422 }
      );
    }

    const rowsToIngest = parseResult.parsedData;

    // 4. Server-Side 96-Block Contiguity Validation (exactly 96 blocks per day)
    const contiguity = validate96BlockContiguity(rowsToIngest);
    if (!contiguity.isContiguous || rowsToIngest.length % 96 !== 0) {
      return NextResponse.json(
        {
          error: 'NON_CONTIGUOUS_BLOCKS',
          message: 'Every operating date must form a complete 1-96 contiguous block set.',
          missingBlocksByDate: contiguity.missingBlocksByDate,
          receivedBlocks: rowsToIngest.length,
        },
        { status: 422 }
      );
    }

    const operatingDates = [...new Set(rowsToIngest.map((row) => row.operating_date))].sort();
    const incompleteOperatingDate = operatingDates.find((operatingDate) => {
      const operatingDayEnd = Date.parse(`${operatingDate}T00:00:00+05:30`) + 86400000;
      return !Number.isFinite(operatingDayEnd) || operatingDayEnd > Date.now();
    });
    const operatingDateStr = operatingDates[operatingDates.length - 1];
    const operatingDayEnd = Date.parse(`${operatingDateStr}T00:00:00+05:30`) + 86400000;
    if (!authResult.isDemo && incompleteOperatingDate) {
      return NextResponse.json({ error: 'INCOMPLETE_OPERATING_DAY',
        message: `Live observations require fully completed 96-block operating days in Asia/Kolkata; ${incompleteOperatingDate} is incomplete.` }, { status: 422 });
    }
    const adminClient = createAdminClient();

    // 5. Store Original File Privately in tenant-uploads bucket (fail closed on error)
    const storagePath = `tenants/${authResult.organisationId}/${siteId}/${filename}_${serverChecksum.slice(0, 8)}.csv`;
    const { error: storageError } = await adminClient.storage
      .from('tenant-uploads')
      .upload(storagePath, rawBuffer, {
        contentType: 'text/csv',
        upsert: true,
      });

    if (storageError) {
      console.error('Tenant upload private storage failed:', storageError);
      return NextResponse.json(
        {
          error: 'STORAGE_UPLOAD_FAILED',
          message: `Failed to archive original raw file into secure tenant storage: ${storageError.message}`,
        },
        { status: 500 }
      );
    }

    // 6. Compute Real Freshness Status from Operating Date
    const diffHours = (Date.now() - operatingDayEnd) / (1000 * 60 * 60);
    const freshnessStatus = diffHours <= 24 ? 'RECENT' : diffHours <= 168 ? 'DELAYED' : 'STALE';

    // Format rows for JSONB RPC
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
        solar_generation_kw: row.solar_generation_kw !== null && row.solar_generation_kw !== undefined
          ? Number(row.solar_generation_kw)
          : null,
        actual_drawal_kw: row.actual_drawal_kw !== null && row.actual_drawal_kw !== undefined ? Number(row.actual_drawal_kw) : null,
        scheduled_drawal_kw: row.scheduled_drawal_kw !== null && row.scheduled_drawal_kw !== undefined ? Number(row.scheduled_drawal_kw) : null,
      };
    });

    // 7. Atomic Transactional Commit via PostgreSQL RPC (service_role privileged)
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
      run_id: rpcResult?.run_id,
      siteId,
      totalBlocks: formattedRows.length,
      totalRows: parseResult.totalRows,
      daysDetected: parseResult.daysDetected,
      validDays: parseResult.validDays,
      validBlocks: parseResult.validBlocks,
      invalidDays: parseResult.invalidDays,
      invalidRows: parseResult.invalidRows,
      errors: parseResult.errors,
      serverChecksum,
      freshnessStatus,
      publicationGateStatus: rpcResult?.publication_gate_status || 'BLOCKED_MISSING_INPUT',
    });
  } catch (err) {
    console.error('Ingestion commit error:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
