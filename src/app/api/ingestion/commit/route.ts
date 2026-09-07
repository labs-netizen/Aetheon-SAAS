import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { validate96BlockContiguity } from '@/features/ingestion/csvParser';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, filename, checksum, parsedData } = body;

    if (!siteId || !filename || !checksum || !Array.isArray(parsedData) || parsedData.length === 0) {
      return NextResponse.json(
        { error: 'siteId, filename, checksum, and non-empty parsedData array are required' },
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

    // 2. Validate 96-block contiguity & completeness
    const contiguity = validate96BlockContiguity(parsedData);
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

    // 3. Duplicate check via SHA-256 checksum in ingestion_runs
    const { data: existingRun } = await adminClient
      .from('ingestion_runs')
      .select('id, uploaded_at')
      .eq('site_id', siteId)
      .eq('checksum_sha256', checksum)
      .maybeSingle();

    if (existingRun) {
      return NextResponse.json(
        {
          error: 'DUPLICATE_FILE',
          message: `This file has already been ingested for site '${siteId}' (Ingestion ID: ${existingRun.id}).`,
          existingRunId: existingRun.id,
        },
        { status: 409 }
      );
    }

    // Resolve or create data_source_id for this site
    let dataSourceId: string | null = null;
    const { data: ds } = await adminClient
      .from('data_sources')
      .select('id')
      .eq('site_id', siteId)
      .limit(1)
      .maybeSingle();

    if (ds) {
      dataSourceId = ds.id;
    } else {
      const { data: newDs } = await adminClient
        .from('data_sources')
        .insert({
          site_id: siteId,
          source_type: 'CSV_UPLOAD',
          name: 'Manual CSV Gateway Ingestion',
          config: {},
          is_active: true,
        })
        .select('id')
        .single();
      dataSourceId = newDs?.id || null;
    }

    // 4. Create Ingestion Run record
    const { data: run, error: runError } = await adminClient
      .from('ingestion_runs')
      .insert({
        data_source_id: dataSourceId,
        site_id: siteId,
        filename,
        checksum_sha256: checksum,
        total_rows: parsedData.length,
        accepted_rows: parsedData.length,
        rejected_rows: 0,
        status: 'ACCEPTED',
        uploaded_by: authResult.user.id,
      })
      .select()
      .single();

    if (runError || !run) {
      console.error('Failed to create ingestion run:', runError);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: 'Failed to record ingestion run.' },
        { status: 500 }
      );
    }

    // 5. Insert interval data transactionally/upsert
    const intervalRows = parsedData.map((row: any) => {
      const hour = Math.floor((row.block_index - 1) / 4);
      const min = ((row.block_index - 1) % 4) * 15;
      const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
      const timestampUtc = new Date(`${row.operating_date}T${timeStr}+05:30`).toISOString();

      return {
        site_id: siteId,
        operating_date: row.operating_date,
        block_index: row.block_index,
        timestamp_utc: timestampUtc,
        load_kw: Number(row.load_kw),
        generation_solar_kw: Number(row.solar_generation_kw || 0),
        actual_drawal_kw: row.actual_drawal_kw !== null && row.actual_drawal_kw !== undefined ? Number(row.actual_drawal_kw) : null,
        scheduled_drawal_kw: row.scheduled_drawal_kw !== null && row.scheduled_drawal_kw !== undefined ? Number(row.scheduled_drawal_kw) : null,
        data_quality: 'PASSED',
        ingestion_run_id: run.id,
      };
    });

    const { error: insertError } = await adminClient
      .from('interval_data_96')
      .upsert(intervalRows, {
        onConflict: 'site_id,operating_date,block_index',
      });

    if (insertError) {
      console.error('Failed to insert interval_data_96:', insertError);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: 'Failed to insert interval blocks to database.' },
        { status: 500 }
      );
    }

    // 6. Record quality evaluation pass
    const opDate = parsedData[0]?.operating_date || new Date().toISOString().split('T')[0];
    await adminClient.from('data_quality_evaluations').insert({
      site_id: siteId,
      evaluation_date: opDate,
      completeness_pct: 100.0,
      missing_blocks_count: 0,
      freshness_status: 'RECENT',
      validation_status: 'PASSED',
      publication_gate_status: 'PUBLISHABLE',
    });

    // 7. Transition site activation status to ACTIVE if it was CONFIGURED / AWAITING_DATA
    await adminClient
      .from('sites')
      .update({ activation_status: 'ACTIVE' })
      .eq('id', siteId)
      .in('activation_status', ['CONFIGURED', 'AWAITING_DATA']);

    // 8. Record audit log
    await adminClient.from('audit_logs').insert({
      actor_id: authResult.user.id,
      actor_role: authResult.role,
      organisation_id: authResult.organisationId,
      site_id: siteId,
      event_type: 'INTERVAL_DATA_INGESTED',
      event_payload: {
        filename,
        checksum,
        blocksCount: parsedData.length,
        ingestionRunId: run.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Successfully ingested ${parsedData.length} interval blocks into persistent database.`,
      ingestionRunId: run.id,
      siteId,
      totalBlocks: parsedData.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
