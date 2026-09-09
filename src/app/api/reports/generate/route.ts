import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveApplicableRegulatoryParameters } from '@/features/compliance/regulatoryResolver';
import { DSM_MODEL, LIVE_GRID_BLOCK, LIVE_BESS_BLOCK, validDate, operatingToday, validGridDemo } from '@/lib/analytics/domain-safety';
import { verifiedDSMRuns } from '@/lib/analytics/dsm-evidence';
import { regulatoryFingerprint } from '@/lib/analytics/report-evidence';
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
      .select('id, name, state, discom, contract_demand_value, voltage_category, is_demo')
      .eq('id', siteId)
      .single();

    if (!site) return NextResponse.json({ error:'SITE_NOT_FOUND' },{ status:404 });
    const siteName = site.name;
    const state = site.state;
    const discom = site.discom;
    const contractDemand = site.contract_demand_value;
    const nowIso = new Date().toISOString();
    const pStart = periodStart || operatingToday();
    const pEnd = periodEnd || pStart;

    if (!validDate(pStart) || !validDate(pEnd) || pEnd < pStart || Date.parse(pEnd)-Date.parse(pStart)>365*86400000)
      return NextResponse.json({ error:'INVALID_REPORT_PERIOD' },{ status:400 });
    if (site.is_demo !== true && ['GRID_INTELLIGENCE','BESS_ARBITRAGE'].includes(requiredProduct))
      return NextResponse.json({ error:'REPORT_NOT_PUBLISHABLE', reason:requiredProduct === 'GRID_INTELLIGENCE' ? LIVE_GRID_BLOCK : LIVE_BESS_BLOCK },{ status:422 });
    if (site.is_demo !== true && requiredProduct === 'RENEWABLE_PORTFOLIO')
      return NextResponse.json({ error:'REPORT_NOT_PUBLISHABLE', reason:'LIVE_RENEWABLE_MODEL_AND_FACTOR_AUTHORITY_REQUIRED' },{ status:422 });

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
    csvLines.push(`# Data mode: ${site.is_demo ? 'DEMO / SYNTHETIC' : 'LIVE INPUT SNAPSHOT'}; evidence verified as of ${nowIso}`);
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

      if (!latestRun) {
        return NextResponse.json(
          {
            error: 'REPORT_NOT_PUBLISHABLE',
            reason: 'DATA_GAP',
            message: `No persisted grid forecast runs found for site '${siteId}' in period ${pStart} to ${pEnd}.`,
          },
          { status: 422 }
        );
      }

      const is96Blocks = validGridDemo({ ...latestRun, data_quality:latestRun.quality_status, blocks },siteId,latestRun.operating_date) && pStart === pEnd && latestRun.operating_date === pStart;
      if (!is96Blocks) {
        return NextResponse.json(
          {
            error: 'REPORT_NOT_PUBLISHABLE',
            reason: 'DATA_GAP',
            message: `Grid report requires exactly 96 unique interval blocks 1–96 (received ${blocks.length}).`,
          },
          { status: 422 }
        );
      }

      const isDemoSite = Boolean(site?.is_demo);
      const isQualityPublishable = isDemoSite || (
        quality &&
        (quality.publication_gate_status === 'PUBLISHABLE' || quality.publication_gate_status === 'PUBLISHABLE_WITH_WARNING') &&
        quality.freshness_status === 'RECENT' &&
        quality.validation_status === 'PASSED'
      );

      if (!isQualityPublishable) {
        const failureReason = !quality
          ? 'MISSING_QUALITY_EVALUATION'
          : quality.publication_gate_status !== 'PUBLISHABLE' && quality.publication_gate_status !== 'PUBLISHABLE_WITH_WARNING'
          ? `QUALITY_GATE_${quality.publication_gate_status}`
          : quality.freshness_status !== 'RECENT'
          ? 'STALE_DATA'
          : 'VALIDATION_FAILED';

        return NextResponse.json(
          {
            error: 'REPORT_NOT_PUBLISHABLE',
            reason: failureReason,
            message: `Grid report output is not publishable: quality gate blocked or missing evidence (${failureReason}).`,
            qualityGateStatus: quality?.publication_gate_status || 'UNKNOWN',
            freshnessStatus: quality?.freshness_status || 'UNKNOWN',
          },
          { status: 422 }
        );
      }

      const tariffVersion = 'MSEDCL_HT1_TOD_DEMO';

      csvLines.push(`# MODEL VERSION: ${latestRun.model_version} | RUN ID: ${latestRun.id}`);
      csvLines.push(`# QUALITY GATE: ${'DEMO_UNVERIFIED'} | FRESHNESS: ${'DEMO'}`);
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
        qualityGateStatus: 'DEMO_UNVERIFIED',
        freshnessStatus: 'DEMO',
        totalBlocks: blocks.length,
        tariffVersion: tariffVersion,
      };

    } else if (reportType === 'DSM_MONTHLY_REVIEW') {
      const dsmRuns = await verifiedDSMRuns(adminClient,siteId,pStart,pEnd,site.is_demo === true);
      if (!dsmRuns) return NextResponse.json({ error:'REPORT_NOT_PUBLISHABLE', reason:'REPORT_DATA_GAP',
        message:'Every requested day requires a validated DSM snapshot matching the current interval inputs.' },{ status:422 });
      const incidents = dsmRuns.flatMap(r=>r.result_snapshot.incidents);
      csvLines.push('# Technical deviation thresholds: 4 / 8 / 12 percent; these are heuristic monitoring bands, not regulatory limits.');
      csvLines.push('# Monetary exposure unavailable: authoritative applicable rule parameters and calculation are not configured.');
      csvLines.push('operating_date,run_id,calculated_at,input_checksum,model_version,rule_status');
      for (const r of dsmRuns) csvLines.push(`${r.operating_date},${r.id},${r.calculation_timestamp},${r.input_checksum},${r.model_version},${r.rule_status}`);
      csvLines.push('operating_date,start_block,end_block,severity,max_deviation_pct,total_excess_energy_kwh,estimated_exposure_inr,root_cause_tag');
      for (const inc of incidents) csvLines.push(`${inc.operating_date},${inc.start_block},${inc.end_block},${inc.severity},${inc.max_deviation_pct ?? 'UNDEFINED_ZERO_SCHEDULE'},${inc.total_excess_energy_kwh},${site.is_demo ? inc.estimated_exposure_inr : 'UNAVAILABLE'},${inc.root_cause_tag}`);
      if (!incidents.length) csvLines.push('# No incidents exceeded the technical monitoring bands in the fully evaluated period.');
      summaryData = { totalIncidents:incidents.length, totalEstimatedExposureInr:site.is_demo ? incidents.reduce((v,i)=>v+i.estimated_exposure_inr,0) : null,
        ruleVersion:null, ruleStatus:'REGULATORY_CONFIGURATION_REQUIRED', isRegulatoryAuthoritative:false,
        monetaryExposureAuthoritative:false, modelVersion:DSM_MODEL, qualityGateStatus:'TECHNICAL_ONLY',
        riskBasis:'TECHNICAL_HEURISTIC_NOT_REGULATORY', evaluatedDays:dsmRuns.length,
        provenance:dsmRuns.map(r=>({ id:r.id,date:r.operating_date,calculatedAt:r.calculation_timestamp,inputChecksum:r.input_checksum })) };

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

      if (run?.solver_version === 'BESS_AC_HEURISTIC_DEMO_v2.0' && !run.is_suppressed && pStart === pEnd && run.operating_date === pStart) {
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
          qualityGateStatus: 'DEMO_UNVERIFIED',
          modelVersion: 'RENEWABLE_DEMO_LEDGER_V1',
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
        voltageCategory: site.voltage_category,
        operatingDate: pStart,
        throughDate: pEnd,
        isDemo: site.is_demo === true,
      });

      if (regParams.status !== 'RESOLVED' || !regParams.applicableCharge) {
        return NextResponse.json({ error:'REPORT_NOT_PUBLISHABLE', reason:'REGULATORY_EVIDENCE_GAP', message:regParams.gapReason },{ status:422 });
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
          regulatoryFingerprint:regulatoryFingerprint(regParams),
          qualityGateStatus:site.is_demo ? 'DEMO_UNVERIFIED' : 'REVIEWED_PARAMETERS',
          chargesAvailable: Boolean(charges),
          tariffCategory: regParams.applicableTariff?.category_name,
          regulatorySourceVersion: approvedSources[0]?.version,
          regulatorySourceEffectiveDate: approvedSources[0]?.effective_date,
        };
      }
    }

    if (summaryData.status === 'REPORT_DATA_GAP' || summaryData.isSuppressed ||
        !['DEMO_UNVERIFIED','TECHNICAL_ONLY','REVIEWED_PARAMETERS'].includes(summaryData.qualityGateStatus)) {
      return NextResponse.json({ error:'REPORT_NOT_PUBLISHABLE', reason:'QUALITY_OR_PROVENANCE_MISSING' },{ status:422 });
    }
    const csvContent = csvLines.join('\n');
    summaryData.csv_content = csvContent;
    summaryData.domain_safety_version = 'PASS2_V1';
    summaryData.is_demo = site.is_demo === true;
    summaryData.evidence_verified_at = nowIso;
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

    const reportModule = (reportType.startsWith('GRID') || reportType === 'DAILY_DISPATCH')
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
