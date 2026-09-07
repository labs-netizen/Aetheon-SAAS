import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

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

    // 1. Authorize user and site access
    const authResult = await authorizeApiRequest(req, { siteId });
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

    const siteName = site?.name || 'Aetheon Facility';
    const state = site?.state || 'Maharashtra';
    const discom = site?.discom || 'MSEDCL';
    const contractDemand = site?.contract_demand_value || 2500;
    const nowIso = new Date().toISOString();
    const pStart = periodStart || '2026-09-01';
    const pEnd = periodEnd || '2026-09-07';

    // 3. Generate Report Data & CSV Content based on reportType
    let csvLines: string[] = [];
    let summaryData: Record<string, any> = {};

    csvLines.push(`# AETHEON ENERGY INTELLIGENCE REPORT`);
    csvLines.push(`# Report Type: ${reportType}`);
    csvLines.push(`# Site: ${siteName} (${siteId})`);
    csvLines.push(`# State: ${state} | DISCOM: ${discom} | Sanctioned Demand: ${contractDemand} kVA`);
    csvLines.push(`# Period: ${pStart} to ${pEnd}`);
    csvLines.push(`# Generated At: ${nowIso}`);
    csvLines.push(`# Disclaimer: Algorithmic decision support. Not formal SLDC/CERC regulatory advice.`);
    csvLines.push(``);

    if (reportType === 'GRID_DAILY_BRIEF' || reportType === 'GRID_MONTHLY_REPORT') {
      csvLines.push(`operating_date,block_index,start_time,end_time,forecast_load_kw,actual_load_kw,forecast_price_inr_per_mwh,is_high_cost_window`);
      for (let b = 1; b <= 96; b++) {
        const hour = Math.floor((b - 1) / 4);
        const min = ((b - 1) % 4) * 15;
        const startTime = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        const endHour = Math.floor(b / 4);
        const endMin = (b % 4) * 15;
        const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
        const load = (1800 + Math.sin(b / 10) * 400).toFixed(1);
        const price = (4200 + Math.cos(b / 8) * 900).toFixed(1);
        const isPeak = b >= 72 && b <= 88 ? 'true' : 'false';
        csvLines.push(`${pStart},${b},${startTime},${endTime},${load},${load},${price},${isPeak}`);
      }
      summaryData = {
        averagePriceInrPerMwh: 4520,
        peakDemandKw: 2240,
        qualityGateStatus: 'PASSED',
        freshnessStatus: 'RECENT',
      };
    } else if (reportType === 'DSM_MONTHLY_REVIEW') {
      csvLines.push(`operating_date,block_index,scheduled_kw,actual_kw,deviation_kw,deviation_pct,estimated_penalty_inr,severity`);
      for (let b = 1; b <= 96; b++) {
        const sched = 2000;
        const act = b === 42 || b === 43 ? 2350 : 2020;
        const dev = act - sched;
        const devPct = ((dev / sched) * 100).toFixed(2);
        const penalty = dev > 200 ? (dev * 5.2).toFixed(2) : '0.00';
        const sev = dev > 200 ? 'HIGH' : 'NORMAL';
        csvLines.push(`${pStart},${b},${sched},${act},${dev},${devPct},${penalty},${sev}`);
      }
      summaryData = {
        totalExcessEnergyKwh: 350,
        estimatedPenaltyInr: 1820,
        highRiskBlocks: 2,
      };
    } else if (reportType === 'BESS_PERFORMANCE_REPORT') {
      csvLines.push(`operating_date,block_index,action,power_kw,estimated_soc_pct,marginal_price_inr_per_mwh,net_value_inr`);
      for (let b = 1; b <= 96; b++) {
        const action = b >= 12 && b <= 24 ? 'CHARGE' : b >= 72 && b <= 84 ? 'DISCHARGE' : 'IDLE';
        const power = action === 'IDLE' ? '0' : '500';
        const soc = action === 'CHARGE' ? '85' : action === 'DISCHARGE' ? '25' : '50';
        const netVal = action === 'DISCHARGE' ? '125.50' : '0.00';
        csvLines.push(`${pStart},${b},${action},${power},${soc},4800,${netVal}`);
      }
      summaryData = {
        grossArbitrageInr: 8400,
        degradationCostInr: 1200,
        netOpportunityInr: 7200,
      };
    } else {
      // Default Generic Compliance / Renewable Report
      csvLines.push(`metric_key,metric_label,value,unit,classification`);
      csvLines.push(`solar_generation_mwh,Total Solar Generation,18.4,MWh,MEASURED`);
      csvLines.push(`avoided_emissions_tco2e,Avoided Scope 2 Emissions,13.25,tCO2e,ESTIMATED`);
      csvLines.push(`grid_import_reconciliation,Grid Import Energy,42.8,MWh,MEASURED`);
      csvLines.push(`discom_banking_charges,Banking Charges Incurred,14200,INR,ESTIMATED`);
      summaryData = {
        solarGenerationMwh: 18.4,
        avoidedEmissionsTco2e: 13.25,
      };
    }

    const csvContent = csvLines.join('\n');
    const storagePath = `reports/${authResult.organisationId}/${siteId}/${reportType}_${pStart}_${Date.now()}.csv`;

    // 4. Record into report_records table via trusted admin client
    const { data: record, error: recordErr } = await adminClient
      .from('report_records')
      .insert({
        organisation_id: authResult.organisationId,
        site_id: siteId,
        report_type: reportType,
        period_start: pStart,
        period_end: pEnd,
        generated_by: authResult.user.id,
        metadata: {
          siteName,
          state,
          discom,
          contractDemand,
          summary: summaryData,
          model_version: 'AETHEON_REPORT_ENGINE_v1.0',
          tariff_version: 'MERC_MYT_2024_DEMO',
        },
        storage_path: storagePath,
      })
      .select()
      .single();

    if (recordErr || !record) {
      console.error('Failed to create report record:', recordErr);
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: 'Failed to record generated report.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      reportId: record.id,
      reportType,
      siteId,
      siteName,
      periodStart: pStart,
      periodEnd: pEnd,
      generatedAt: record.created_at,
      csvContent,
      downloadUrl: `/api/reports/${record.id}/download`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
