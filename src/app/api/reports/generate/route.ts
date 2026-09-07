import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveApplicableRegulatoryParameters } from '@/features/compliance/regulatoryResolver';
import { type ReportType, type ProductId } from '@/types';

// Mapping each report type to its canonical required product entitlement
const REPORT_PRODUCT_REQUIREMENTS: Record<string, ProductId> = {
  GRID_DAILY_BRIEF: 'GRID_INTELLIGENCE',
  GRID_MONTHLY_REPORT: 'GRID_INTELLIGENCE',
  DAILY_DISPATCH: 'GRID_INTELLIGENCE',
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

    // 1. Fail closed on unknown report type (never fall through or default)
    const requiredProduct = REPORT_PRODUCT_REQUIREMENTS[reportType as ReportType];
    if (!requiredProduct) {
      return NextResponse.json(
        {
          error: 'INVALID_REPORT_TYPE',
          message: `Unknown or unsupported report type: '${reportType}'. Must be one of: ${Object.keys(REPORT_PRODUCT_REQUIREMENTS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    // 2. Authorize user, site access, and required product entitlement
    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: requiredProduct,
    });
    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // 3. Fetch site info
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

    // 4. Build CSV Header
    const csvLines: string[] = [];
    let summaryData: Record<string, any> = {};

    csvLines.push(`# AETHEON ENERGY INTELLIGENCE REPORT`);
    csvLines.push(`# Report Type: ${reportType}`);
    csvLines.push(`# Site: ${siteName} (${siteId})`);
    csvLines.push(`# State: ${state} | DISCOM: ${discom} | Sanctioned Demand: ${contractDemand} kVA | Voltage: ${site?.voltage_category || 'N/A'}`);
    csvLines.push(`# Period: ${pStart} to ${pEnd}`);
    csvLines.push(`# Generated At: ${nowIso}`);
    csvLines.push(`# Product Entitlement Verified: ${requiredProduct}`);
    csvLines.push(`# Disclaimer: Algorithmic decision support based on persisted operational data. Not formal SLDC/CERC regulatory advice.`);
    csvLines.push(``);

    // 5. Query Persisted Data per Report Type
    if (reportType === 'GRID_DAILY_BRIEF' || reportType === 'GRID_MONTHLY_REPORT' || (reportType as string) === 'DAILY_DISPATCH') {
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

      const { data: quality } = await adminClient
        .from('data_quality_evaluations')
        .select('*')
        .eq('site_id', siteId)
        .eq('evaluation_date', pStart)
        .maybeSingle();

      if (blocks.length > 0) {
        // Fetch applicable tariff version from regulatory sources
        let tariffVersion = null;
        const { data: tariff } = await adminClient
          .from('discom_tariffs')
          .select('version, regulatory_source_id')
          .eq('state', state)
          .eq('discom', discom)
          .eq('voltage_category', site?.voltage_category)
          .order('effective_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (tariff) tariffVersion = tariff.version;

        csvLines.push(`# MODEL VERSION: ${latestRun.model_version} | RUN ID: ${latestRun.id}`);
        csvLines.push(`# QUALITY GATE: ${quality?.publication_gate_status || 'UNKNOWN'} | FRESHNESS: ${quality?.freshness_status || 'UNKNOWN'}`);
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
          qualityGateStatus: quality?.publication_gate_status || 'UNKNOWN',
          freshnessStatus: quality?.freshness_status || 'UNKNOWN',
          totalBlocks: blocks.length,
          tariffVersion: tariffVersion,
        };
      } else {
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - No persisted grid forecast runs found for site '${siteId}' in period ${pStart} to ${pEnd}.`);
        csvLines.push(`operating_date,block_index,status`);
        csvLines.push(`${pStart},ALL,DATA_GAP_NO_PERSISTED_FORECAST`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: 'No persisted forecast run exists for this period.', tariffVersion: null };
      }

    } else if (reportType === 'DSM_MONTHLY_REVIEW') {
      // First, check if a valid DSM calculation/run exists for the requested period
      const { data: dsmRuns } = await adminClient
        .from('dsm_incidents')
        .select('id')
        .eq('site_id', siteId)
        .gte('operating_date', pStart)
        .lte('operating_date', pEnd)
        .limit(1);

      // Fetch approved DSM rule version
      let ruleVersion = null;
      let ruleStatus = null;
      const { data: rule } = await adminClient
        .from('regulatory_sources')
        .select('version, status, effective_date')
        .eq('jurisdiction', 'CERC')
        .eq('category', 'DSM')
        .eq('status', 'APPROVED')
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (rule) {
        ruleVersion = rule.version;
        ruleStatus = rule.status;
      }

      const { data: incidents } = await adminClient
        .from('dsm_incidents')
        .select('*')
        .eq('site_id', siteId)
        .gte('operating_date', pStart)
        .lte('operating_date', pEnd)
        .order('start_block', { ascending: true });

      if (incidents && incidents.length > 0) {
        csvLines.push(`operating_date,start_block,end_block,severity,max_deviation_pct,total_excess_energy_kwh,estimated_exposure_inr,root_cause_tag,acknowledged`);
        for (const inc of incidents) {
          csvLines.push(`${inc.operating_date},${inc.start_block},${inc.end_block},${inc.severity},${inc.max_deviation_pct},${inc.total_excess_energy_kwh},${inc.estimated_exposure_inr},${inc.root_cause_tag},${inc.acknowledged}`);
        }
        summaryData = {
          totalIncidents: incidents.length,
          criticalCount: incidents.filter((i) => i.severity === 'CRITICAL').length,
          totalExcessEnergyKwh: incidents.reduce((acc, i) => acc + Number(i.total_excess_energy_kwh || 0), 0),
          totalEstimatedExposureInr: incidents.reduce((acc, i) => acc + Number(i.estimated_exposure_inr || 0), 0),
          ruleVersion: ruleVersion,
          ruleStatus: ruleStatus,
          note: 'Validated DSM calculation with material incidents.',
        };
      } else if (dsmRuns && dsmRuns.length > 0) {
        // Valid calculation exists but zero incidents
        csvLines.push(`# DATA STATUS: Valid DSM calculation exists for period ${pStart} to ${pEnd}. No material deviation incidents recorded.`);
        csvLines.push(`operating_date,status`);
        csvLines.push(`${pStart},NO_MATERIAL_INCIDENTS`);
        summaryData = { totalIncidents: 0, totalEstimatedExposureInr: 0, ruleVersion: ruleVersion, ruleStatus: ruleStatus, note: 'Validated DSM calculation: Zero deviations beyond allowable band.' };
      } else {
        // No validated calculation/input
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - No validated DSM calculation or input data found for period ${pStart} to ${pEnd}.`);
        csvLines.push(`operating_date,status`);
        csvLines.push(`${pStart},REPORT_DATA_GAP`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: 'No validated DSM calculation/input exists for this period.', ruleVersion: ruleVersion, ruleStatus: ruleStatus };
      }

    } else if (reportType === 'BESS_PERFORMANCE_REPORT') {
      const { data: asset } = await adminClient
        .from('bess_assets')
        .select('id, name, updated_at')
        .eq('site_id', siteId)
        .eq('is_active', true)
        .maybeSingle();

      let run = null;
      if (asset) {
        const { data: runs } = await adminClient
          .from('bess_signal_runs')
          .select('*')
          .eq('battery_id', asset.id)
          .gte('operating_date', pStart)
          .lte('operating_date', pEnd)
          .order('created_at', { ascending: false })
          .limit(1);
        run = runs?.[0];
      }

      if (run) {
        // For BESS, we report from the persisted signal runs
        // Detailed dispatch blocks would require a dedicated schedule table
        csvLines.push(`# BESS SIGNAL RUN: ${run.id} | SOLVER: ${run.solver_version}`);
        csvLines.push(`operating_date,gross_arbitrage_inr,degradation_cost_inr,net_opportunity_inr,equivalent_cycles,is_suppressed,suppression_reason`);
        csvLines.push(`${run.operating_date},${run.gross_arbitrage_inr},${run.degradation_cost_inr},${run.net_opportunity_inr},${run.equivalent_cycles},${run.is_suppressed},${run.suppression_reason || ''}`);

        summaryData = {
          runId: run.id,
          solverVersion: run.solver_version,
          assetId: asset?.id,
          assetName: asset?.name,
          assetConfigVersion: asset?.updated_at,
          grossArbitrageInr: run.gross_arbitrage_inr,
          degradationCostInr: run.degradation_cost_inr,
          netOpportunityInr: run.net_opportunity_inr,
          equivalentCycles: run.equivalent_cycles,
          isSuppressed: run.is_suppressed,
          suppressionReason: run.suppression_reason,
        };
      } else {
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - No persisted BESS signal runs found for site '${siteId}' in period ${pStart} to ${pEnd}.`);
        csvLines.push(`operating_date,status`);
        csvLines.push(`${pStart},DATA_GAP_NO_PERSISTED_BESS_RUN`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: 'No persisted BESS advisory run exists for this period.' };
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
        // Fetch emission factor source
        const { data: ef } = await adminClient
          .from('emission_factors')
          .select('source_name, source_version, effective_year')
          .eq('is_verified', true)
          .order('effective_year', { ascending: false })
          .limit(1)
          .maybeSingle();

        csvLines.push(`operating_date,total_measured_generation_kwh,total_modelled_generation_kwh,performance_ratio_pct,avoided_emissions_tco2e,emission_factor_source,reconciliation_status`);
        for (const row of ledger) {
          csvLines.push(`${row.operating_date},${row.total_measured_generation_kwh},${row.total_modelled_generation_kwh},${row.performance_ratio_pct},${row.avoided_emissions_tco2e},${row.emission_factor_source},${row.reconciliation_status}`);
        }
        summaryData = {
          totalReconciledDays: ledger.length,
          totalAvoidedEmissionsTco2e: ledger.reduce((acc, r) => acc + Number(r.avoided_emissions_tco2e || 0), 0),
          emissionFactorSource: ef?.source_name,
          emissionFactorVersion: ef?.source_version,
          assetConfigVersion: ledger[0]?.created_at,
        };
      } else {
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - No persisted renewable generation ledger entries found for period ${pStart} to ${pEnd}.`);
        csvLines.push(`status,message`);
        csvLines.push(`REPORT_DATA_GAP,No reconciled generation data available.`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: 'No persisted renewable generation records found.', emissionFactorSource: null, emissionFactorVersion: null };
      }

    } else if (reportType === 'COMPLIANCE_AUDIT') {
      // 8. Use canonical regulatory resolver
      const regParams = await resolveApplicableRegulatoryParameters({
        state,
        discom,
        voltageCategory: site?.voltage_category || '33kV',
        operatingDate: pStart,
      });

      if (regParams.status !== 'RESOLVED' || !regParams.applicableCharge) {
        csvLines.push(`# DATA STATUS: REPORT DATA GAP - ${regParams.gapReason || 'No applicable approved regulatory parameters found.'}`);
        summaryData = { status: 'REPORT_DATA_GAP', reason: regParams.gapReason, regulatorySourceVersion: null };
      } else {
        const approvedSources = regParams.approvedSources;
        const charges = regParams.applicableCharge;
        csvLines.push(`# JURISDICTION: ${state} (${discom}) | VOLTAGE: ${site?.voltage_category || 'N/A'}`);
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
          tariffCategory: regParams.applicableTariff?.category_name,
          regulatorySourceVersion: approvedSources[0]?.version,
          regulatorySourceEffectiveDate: approvedSources[0]?.effective_date,
        };
      }
    }

    const csvContent = csvLines.join('\n');
    summaryData.csv_content = csvContent;
    const storagePath = `tenants/${authResult.organisationId}/${siteId}/${reportType}_${pStart}_${Date.now()}.csv`;

    // 6. Store in private tenant-reports bucket (fail closed on upload error)
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

    const reportModule = (reportType.startsWith('GRID'))
      ? 'GRID'
      : reportType.startsWith('DSM')
      ? 'DSM'
      : reportType.startsWith('BESS')
      ? 'BESS'
      : reportType === 'COMPLIANCE_AUDIT'
      ? 'COMPLIANCE'
      : 'RENEWABLE';

    const reportTitle = `${siteName} - ${reportType.replace(/_/g, ' ')} (${pStart})`;
    // Fail closed: missing quality evidence = DATA_GAP / QUALITY_UNKNOWN / REPORT_NOT_PUBLISHABLE
    const qualityStatus = summaryData.qualityGateStatus || (summaryData.status === 'REPORT_DATA_GAP' ? 'DATA_GAP' : 'QUALITY_UNKNOWN');
    const modelVersion = summaryData.modelVersion || summaryData.solverVersion || 'UNKNOWN';

    // 7. Persist to report_records with canonical database schema
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
        tariff_version: summaryData.tariffVersion || null,
        rule_version: summaryData.ruleVersion || null,
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
