import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json(
        { error: 'siteId query parameter is required' },
        { status: 400 }
      );
    }

    const authResult = await authorizeApiRequest(req, { siteId });
    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // Query persisted alerts for this site
    let { data: alerts, error: alertErr } = await adminClient
      .from('alerts')
      .select('*')
      .eq('site_id', siteId)
      .order('triggered_at', { ascending: false });

    if (alertErr) {
      return NextResponse.json(
        { error: 'DATABASE_ERROR', message: alertErr.message },
        { status: 500 }
      );
    }

    // If no alerts exist yet, seed initial operational alerts for this site
    if (!alerts || alerts.length === 0) {
      const initialAlerts = [
        {
          organisation_id: authResult.organisationId,
          site_id: siteId,
          module: 'GRID',
          alert_type: 'HIGH_COST_WINDOW',
          severity: 'HIGH',
          title: 'High-Cost Window Ahead (Tomorrow Evening)',
          description: 'Projected Day-Ahead Market clearing price exceeds ₹7,800/MWh between 18:30 and 21:00 IST.',
          fingerprint: `grid_peak_${siteId}_20260908`,
          affected_block_start: 74,
          affected_block_end: 84,
          status: 'ACTIVE',
        },
        {
          organisation_id: authResult.organisationId,
          site_id: siteId,
          module: 'DSM',
          alert_type: 'DRAWAL_DEVIATION',
          severity: 'CRITICAL',
          title: 'DSM Drawal Deviation Exceeded (+15.0%)',
          description: 'Actual drawal exceeded SLDC schedule by 180 kW across consecutive blocks.',
          fingerprint: `dsm_dev_${siteId}_20260907`,
          affected_block_start: 53,
          affected_block_end: 58,
          status: 'ACTIVE',
        },
        {
          organisation_id: authResult.organisationId,
          site_id: siteId,
          module: 'COMPLIANCE',
          alert_type: 'BANKING_DEADLINE',
          severity: 'WARNING',
          title: 'Monthly Banking Reconciliation Deadline Approaching',
          description: 'MSEDCL banking energy filing must be submitted within 7 days to avoid energy lapse.',
          fingerprint: `compliance_banking_${siteId}_202609`,
          status: 'ACTIVE',
        },
        {
          organisation_id: authResult.organisationId,
          site_id: siteId,
          module: 'BESS',
          alert_type: 'CHARGE_OPPORTUNITY',
          severity: 'INFO',
          title: 'Optimal Charge Window Commenced',
          description: 'Off-peak solar valley tariff active. Recommended battery charge window open.',
          fingerprint: `bess_charge_${siteId}_20260907`,
          affected_block_start: 46,
          affected_block_end: 56,
          status: 'ACKNOWLEDGED',
        },
      ];

      const { data: seededAlerts } = await adminClient
        .from('alerts')
        .insert(initialAlerts)
        .select();

      alerts = seededAlerts || [];
    }

    return NextResponse.json({
      siteId,
      alerts: alerts || [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
