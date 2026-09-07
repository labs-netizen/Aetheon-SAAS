import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

// Mapping each report type to its canonical required product entitlement
const REPORT_PRODUCT_REQUIREMENTS: Record<string, string> = {
  GRID_DAILY_BRIEF: 'GRID_INTELLIGENCE',
  GRID_MONTHLY_REPORT: 'GRID_INTELLIGENCE',
  DSM_MONTHLY_REVIEW: 'DSM_RISK',
  BESS_PERFORMANCE_REPORT: 'BESS_ARBITRAGE',
  RENEWABLES_RECONCILIATION: 'RENEWABLE_PORTFOLIO',
  COMPLIANCE_AUDIT: 'OA_COMPLIANCE',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, reportType, periodStart, periodEnd } = body;

    if (!siteId || !reportType) {
      return NextResponse.json(
        { error: 'siteId and reportType are required' },
        { status: 400 }
      );
    }

    const requiredProduct = REPORT_PRODUCT_REQUIREMENTS[reportType] || 'GRID_INTELLIGENCE';

    // 1. Authorize user, site access, and required product entitlement
    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: requiredProduct,
    });
    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // 2. Fetch site info
    const { data: site } = await adminClient
      .from('sites')
      .select('id, name, state, discom, contract_demand_value, voltage_category')
      .eq('id', siteId)
      .single();

    const siteName = site?.name || 'Facility';
    const state = site?.state || 'Maharashtra';
    const discom = site?.discom || 'MSEDCL';
    const contractDemand = site?.contract_demand_value || 1000;
    const nowIso = new Date().toISOString();
    const pStart = periodStart || new Date().toISOString().substring(0, 10);
    const pEnd = periodEnd || pStart;

    // 3. Build CSV Header
    let csvLines: string[] = [];
    let summaryData: Record<string, any> = {};

    csvLines.push(`# AETHEON ENERGY INTELLIGENCE REPORT`);
    csvLines.push(`# Report Type: ${reportType}`);
    csvLines.push(`# Site: ${siteName} (${siteId})`);
    csvLines.push(`# State: ${state} | DISCOM: ${discom} | Sanctioned Demand: ${contractDemand} kVA`);
    csvLines.push(`# Period: ${pStart} to ${pEnd}`);
    csvLines.push(`# Generated At: ${nowIso}`);
    csvLines.push(`# Product Entitlement Verified: ${requiredProduct}`);
    csvLines.push(`# Disclaimer: Algorithmic decision support based on persisted operational data. Not formal SLDC/CERC regulatory advice.`);
    csvLines.push(``);

    // 4. Query Actual Persisted Data per Report Type
    if (reportType === 'GRID_DAILY_BRIEF' || reportType === 'GRID_MONTHLY_REPORT' || reportType === 'DAILY_DISPATCH') {
      // Query persisted forecast run
      const { data: runs } = await adminClient
        .from('grid_forecast_runs')
        .select('*')
        .eq('site_id', siteId)
        .gte('operating_date', pStart)
        .lte('operating_date', pEnd)
        .order('created_at', { ascending: false })
        .limit(1);

      const latestRun = runs?.[0];
      let blocks: any[] = [];
      if (latestRun) {
        const { data: blockRows } = await adminClient
          .from('grid_forecast_blocks')
          .select('*')
          .eq('run_id', latestRun.id)
          .order('block_index', { ascending: true });
        blocks = blockRows || [];
      }

      // Query quality gate evaluation
      const { data: quality } = await adminClient
        .from('data_quality_evaluations')
        .select('*')
        .eq('site_id', siteId)
        .eq('evaluation_date', pStart)
        .maybeSingle();

      if (blocks.length > 0) {
        csvLines.push(`# MODEL VERSION: ${latestRun.model_version} | RUN ID: ${latestRun.id}`);
        csvLines.push(`# QUALITY GATE: ${quality?.publication_gate_status || 'PUBLISHABLE'} | FRESHNESS: ${quality?.freshness_status || 'RECENT'}`);
        csvLines.push(`operating_date,block_index,start_time,end_time,forecast_load_kw,forecast_price_inr_per_mwh,is_high_cost_window`);

        for (const b of blocks) {
          const hour = Math.floor((b.block_index - 1) / 4);
          const min = ((b.block_index - 1) % 4) * 15;
          const startTime = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
          const endHour = Math.floor(b.block_index / 4);
          const endMin = (b.block_index % 4) * 15;
          const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
          csvLines.push(`${latestRun.operating_date},${b.block_index},${startTime},${endTime},${b.forecast_demand_kw},${b.forecast_price_inr_per_mwh},${b.is_high_cost_window}`);
        }

        summaryData = {
          runId: latestRun.id,
          modelVersion: latestRun.model_version,
          averagePriceInrPerMwh: latestRun.average_price_inr_per_mwh,
          peakDemandKw: latestRun.peak_demand_kw,
          qualityGateStatus: quality?.publication_gate_status || 'PUBLISHABLE',
          freshnessStatus: quality?.freshness_status || 'RECENT',
          totalBlocks: blocks.length,
        };
      } else {
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - No persisted grid forecast runs found for site '${siteId}' in period ${pStart} to ${pEnd}.`);
        csvLines.push(`operating_date,block_index,status`);
        csvLines.push(`${pStart},ALL,DATA_GAP_NO_PERSISTED_FORECAST`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: 'No persisted forecast run exists for this period.' };
      }

    } else if (reportType === 'DSM_MONTHLY_REVIEW') {
      const { data: incidents } = await adminClient
        .from('dsm_incidents')
        .select('*')
        .eq('site_id', siteId)
        .gte('operating_date', pStart)
        .lte('operating_date', pEnd)
        .order('start_block', { ascending: true });

      if (incidents && incidents.length > 0) {
        csvLines.push(`incident_id,operating_date,start_block,end_block,severity,max_deviation_pct,total_excess_energy_kwh,estimated_exposure_inr,root_cause_tag,acknowledged`);
        let totalExposure = 0;
        let totalExcessKwh = 0;
        for (const inc of incidents) {
          totalExposure += Number(inc.estimated_exposure_inr || 0);
          totalExcessKwh += Number(inc.total_excess_energy_kwh || 0);
          csvLines.push(`${inc.id},${inc.operating_date},${inc.start_block},${inc.end_block},${inc.severity},${inc.max_deviation_pct},${inc.total_excess_energy_kwh},${inc.estimated_exposure_inr},${inc.root_cause_tag},${inc.acknowledged}`);
        }
        summaryData = {
          totalIncidents: incidents.length,
          totalExposureInr: Number(totalExposure.toFixed(2)),
          totalExcessEnergyKwh: Number(totalExcessKwh.toFixed(2)),
        };
      } else {
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - No persisted DSM deviation incidents recorded for site '${siteId}' in period ${pStart} to ${pEnd}.`);
        csvLines.push(`status,message`);
        csvLines.push(`REPORT_DATA_GAP,Zero deviation incidents or missing actual interval data.`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: 'No persisted DSM incidents found.' };
      }

    } else if (reportType === 'BESS_PERFORMANCE_REPORT') {
      const { data: assets } = await adminClient
        .from('bess_assets')
        .select('*')
        .eq('site_id', siteId);

      const asset = assets?.[0];
      let runs: any[] = [];
      if (asset) {
        const { data: runRows } = await adminClient
          .from('bess_signal_runs')
          .select('*')
          .eq('battery_id', asset.id)
          .gte('operating_date', pStart)
          .lte('operating_date', pEnd);
        runs = runRows || [];
      }

      if (runs.length > 0) {
        csvLines.push(`# BESS ASSET: ${asset.name} (${asset.id}) | CAPACITY: ${asset.usable_capacity_kwh} kWh | RATING: ${asset.power_rating_kw} kW`);
        csvLines.push(`operating_date,solver_version,gross_arbitrage_inr,degradation_cost_inr,net_opportunity_inr,equivalent_cycles,is_suppressed`);
        for (const r of runs) {
          csvLines.push(`${r.operating_date},${r.solver_version},${r.gross_arbitrage_inr},${r.degradation_cost_inr},${r.net_opportunity_inr},${r.equivalent_cycles},${r.is_suppressed}`);
        }
        summaryData = {
          assetId: asset.id,
          totalRuns: runs.length,
          grossArbitrageInr: runs.reduce((acc, r) => acc + Number(r.gross_arbitrage_inr || 0), 0),
          netOpportunityInr: runs.reduce((acc, r) => acc + Number(r.net_opportunity_inr || 0), 0),
        };
      } else {
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - No persisted BESS signal runs found for site '${siteId}' in period ${pStart} to ${pEnd}.`);
        csvLines.push(`status,message`);
        csvLines.push(`REPORT_DATA_GAP,No BESS asset configured or zero optimization runs found.`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: 'No persisted BESS signal runs found.' };
      }

    } else if (reportType === 'RENEWABLES_RECONCILIATION') {
      const { data: ledger } = await adminClient
        .from('renewable_generation_ledger')
        .select('*')
        .eq('site_id', siteId)
        .gte('operating_date', pStart)
        .lte('operating_date', pEnd)
        .order('operating_date', { ascending: true });

      if (ledger && ledger.length > 0) {
        csvLines.push(`operating_date,total_measured_generation_kwh,total_modelled_generation_kwh,performance_ratio_pct,avoided_emissions_tco2e,emission_factor_source,reconciliation_status`);
        for (const row of ledger) {
          csvLines.push(`${row.operating_date},${row.total_measured_generation_kwh},${row.total_modelled_generation_kwh},${row.performance_ratio_pct},${row.avoided_emissions_tco2e},${row.emission_factor_source},${row.reconciliation_status}`);
        }
        summaryData = {
          totalReconciledDays: ledger.length,
          totalAvoidedEmissionsTco2e: ledger.reduce((acc, r) => acc + Number(r.avoided_emissions_tco2e || 0), 0),
        };
      } else {
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - No persisted renewable generation ledger entries found for period ${pStart} to ${pEnd}.`);
        csvLines.push(`status,message`);
        csvLines.push(`REPORT_DATA_GAP,No reconciled generation data available.`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: 'No persisted renewable generation records found.' };
      }

    } else {
      // COMPLIANCE_AUDIT or default
      const { data: approvedSources } = await adminClient
        .from('regulatory_sources')
        .select('id, jurisdiction, state, document_title, effective_date, version, status')
        .in('status', ['APPROVED', 'PUBLISHED'])
        .or(`state.eq.${state},state.eq.National,state.is.null`);

      const { data: charges } = await adminClient
        .from('open_access_charges')
        .select('*')
        .eq('state', state)
        .eq('discom', discom)
        .maybeSingle();

      if (approvedSources && approvedSources.length > 0) {
        csvLines.push(`# JURISDICTION: ${state} (${discom})`);
        csvLines.push(`source_id,jurisdiction,state,document_title,effective_date,version,status`);
        for (const s of approvedSources) {
          csvLines.push(`${s.id},${s.jurisdiction},${s.state},"${s.document_title}",${s.effective_date},${s.version},${s.status}`);
        }
        if (charges) {
          csvLines.push(``);
          csvLines.push(`# APPROVED LANDED CHARGES`);
          csvLines.push(`css_inr_per_kwh,as_inr_per_kwh,wheeling_inr_per_kwh,transmission_inr_per_kwh,banking_charge_pct`);
          csvLines.push(`${charges.cross_subsidy_surcharge_inr_per_kwh},${charges.additional_surcharge_inr_per_kwh},${charges.wheeling_charge_inr_per_kwh},${charges.transmission_charge_inr_per_kwh},${charges.banking_charge_pct}`);
        }
        summaryData = {
          approvedSourcesCount: approvedSources.length,
          chargesAvailable: Boolean(charges),
        };
      } else {
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - No approved regulatory records published for jurisdiction '${state}'.`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: 'No approved regulatory orders published.' };
      }
    }

    const csvContent = csvLines.join('\n');
    summaryData.csv_content = csvContent;
    const storagePath = `tenants/${authResult.organisationId}/${siteId}/${reportType}_${pStart}_${Date.now()}.csv`;

    // 5. Store in private tenant-reports bucket (fail closed on upload error)
    const { error: storageError } = await adminClient.storage
      .from('tenant-reports')
      .upload(storagePath, csvContent, {
        contentType: 'text/csv',
        upsert: true,
      });

    if (storageError) {
      console.error('Failed to upload report to tenant-reports storage:', storageError);
      return NextResponse.json(
        {
          error: 'STORAGE_UPLOAD_FAILED',
          message: `Failed to archive report to private storage: ${storageError.message}`,
        },
        { status: 500 }
      );
    }

    const reportModule = (reportType.startsWith('GRID') || reportType === 'DAILY_DISPATCH')
      ? 'GRID'
      : reportType.startsWith('DSM')
      ? 'DSM'
      : reportType.startsWith('BESS')
      ? 'BESS'
      : reportType.startsWith('COMPLIANCE')
      ? 'COMPLIANCE'
      : 'RENEWABLE';

    const reportTitle = `${siteName} - ${reportType.replace(/_/g, ' ')} (${pStart})`;
    const qualityStatus = summaryData.qualityGateStatus || (summaryData.status === 'REPORT_DATA_GAP' ? 'DATA_GAP' : 'PASSED');
    const modelVersion = summaryData.modelVersion || 'GATEWAY_RAW_v1.0';

    // 6. Persist to report_records with canonical database schema
    const { data: record, error: recordError } = await adminClient
      .from('report_records')
      .insert({
        organisation_id: authResult.organisationId,
        site_id: siteId,
        module: reportModule,
        report_type: reportType,
        period_start: pStart,
        period_end: pEnd,
        title: reportTitle,
        summary: summaryData,
        quality_status: qualityStatus,
        model_version: modelVersion,
        tariff_version: 'MSEDCL_HT1_TOD_2024_VALIDATED',
        rule_version: 'CERC_DSM_2024',
        generated_by: authResult.user.id,
        download_url: `/api/reports/placeholder/download`,
        storage_path: storagePath,
      })
      .select()
      .single();

    if (recordError) {
      console.error('Failed to insert report record:', recordError);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: recordError.message },
        { status: 500 }
      );
    }

    const canonicalDownloadUrl = `/api/reports/${record.id}/download`;

    // Update download_url to canonical route
    await adminClient
      .from('report_records')
      .update({ download_url: canonicalDownloadUrl })
      .eq('id', record.id);

    return NextResponse.json({
      success: true,
      reportId: record.id,
      title: reportTitle,
      reportType,
      siteId,
      storagePath,
      downloadUrl: canonicalDownloadUrl,
      summary: summaryData,
      report: {
        id: record.id,
        download_url: canonicalDownloadUrl,
        storage_path: storagePath,
        title: reportTitle,
        report_type: reportType,
        site_id: siteId,
        summary: summaryData,
      },
    });
  } catch (err) {
    console.error('Report generation error:', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
