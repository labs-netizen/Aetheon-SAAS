import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { operatingToday, validDate } from '@/lib/analytics/domain-safety';
import { applicableObligations } from '@/features/compliance/regulatoryResolver';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json({ error: 'siteId query parameter is required' }, { status: 400 });
    }

    // 1. Authorize request with OA_COMPLIANCE entitlement check
    const authResult = await authorizeApiRequest(req, {
      siteId,
      productId: 'OA_COMPLIANCE',
    });

    if (!authResult.authorized) {
      return authResult.response;
    }

    const adminClient = createAdminClient();

    // 2. Fetch site electrical and jurisdictional attributes
    const { data: site, error: siteErr } = await adminClient
      .from('sites')
      .select('id, name, state, discom, voltage_category, is_demo')
      .eq('id', siteId)
      .single();

    if (siteErr || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const siteState = site.state;
    const siteDiscom = site.discom;
    const siteVoltage = site.voltage_category;

    const today = searchParams.get('operatingDate') || operatingToday();
    if (!validDate(today)) return NextResponse.json({ error: 'INVALID_DATE' }, { status: 400 });

    // 4. Resolve applicable charges and tariffs via canonical approval resolver (no wrong-voltage fallback)
    const { resolveApplicableRegulatoryParameters } = await import('@/features/compliance/regulatoryResolver');
    const resolution = await resolveApplicableRegulatoryParameters({
      state: siteState,
      discom: siteDiscom,
      voltageCategory: siteVoltage,
      operatingDate: today,
      isDemo: site.is_demo === true,
    });

    const applicableCharge = resolution.applicableCharge;
    const applicableTariff = resolution.applicableTariff;

    // 6. Query approved statutory compliance calendar obligations
    const { data: obligations, error: obligationsError } = await adminClient
      .from('compliance_obligations')
      .select('*')
      .eq('state', siteState)
      .order('deadline_date', { ascending: true });

    return NextResponse.json({
      site: {
        id: site.id,
        name: site.name,
        state: siteState,
        discom: siteDiscom,
        voltageCategory: siteVoltage,
      },
      sources: resolution.approvedSources,
      charges: applicableCharge || null,
      tariff: applicableTariff || null,
      calendar: obligationsError ? [] : applicableObligations(obligations || [], resolution, { state: siteState, discom: siteDiscom, voltageCategory: siteVoltage, operatingDate: today, isDemo: site.is_demo === true }),
      hasApprovedData: resolution.hasApprovedData,
      is_data_gap: Boolean(obligationsError) || !applicableCharge || !applicableTariff,
      gap_reason: resolution.gapReason || (!applicableCharge ? 'No applicable approved open access charges found for voltage' : null),
      legalDisclaimer: 'NOT FORMAL LEGAL ADVICE. Statutory parameters are published from official Commission regulatory orders for algorithmic decision support only.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error fetching compliance records' },
      { status: 500 }
    );
  }
}
