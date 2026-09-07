import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
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
      .select('id, name, state, discom, voltage_category')
      .eq('id', siteId)
      .single();

    if (siteErr || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const siteState = site.state || 'Maharashtra';
    const siteDiscom = site.discom || 'MSEDCL';
    const siteVoltage = site.voltage_category || '33kV';

    // 3. Query ONLY APPROVED and PUBLISHED regulatory sources (Customer-Safe)
    const { data: regSources, error: regErr } = await adminClient
      .from('regulatory_sources')
      .select('id, jurisdiction, state, discom, document_title, source_url, document_date, effective_date, version, status')
      .or(`state.eq.${siteState},state.eq.National,state.is.null`)
      .in('status', ['APPROVED', 'PUBLISHED'])
      .order('effective_date', { ascending: false });

    if (regErr) {
      return NextResponse.json({ error: regErr.message }, { status: 500 });
    }

    const today = new Date().toISOString().split('T')[0];

    // 4. Query applicable Open Access landed charges (Strict Approval Gate)
    const { data: chargesList, error: chargesErr } = await adminClient
      .from('open_access_charges')
      .select('*, regulatory_sources!inner(id, status)')
      .eq('state', siteState)
      .eq('discom', siteDiscom)
      .in('regulatory_sources.status', ['APPROVED', 'PUBLISHED'])
      .lte('effective_from', today)
      .order('effective_from', { ascending: false });

    if (chargesErr) {
      return NextResponse.json({ error: chargesErr.message }, { status: 500 });
    }

    const applicableCharge = chargesList?.find(
      (c) =>
        (c.voltage_category === siteVoltage || !c.voltage_category) &&
        (!c.effective_until || c.effective_until >= today)
    ) || chargesList?.[0] || null;

    // 5. Query applicable DISCOM Retail Tariffs (Strict Approval Gate)
    const { data: tariffsList, error: tariffErr } = await adminClient
      .from('discom_tariffs')
      .select('*, regulatory_sources!inner(id, status)')
      .eq('state', siteState)
      .eq('discom', siteDiscom)
      .in('regulatory_sources.status', ['APPROVED', 'PUBLISHED'])
      .lte('effective_from', today)
      .order('effective_from', { ascending: false });

    if (tariffErr) {
      return NextResponse.json({ error: tariffErr.message }, { status: 500 });
    }

    const applicableTariff = tariffsList?.find(
      (t) =>
        (t.voltage_category === siteVoltage || !t.voltage_category) &&
        (!t.effective_until || t.effective_until >= today)
    ) || tariffsList?.[0] || null;

    // 6. Query approved statutory compliance calendar obligations
    const { data: obligations } = await adminClient
      .from('compliance_obligations')
      .select('*')
      .or(`state.eq.${siteState},state.eq.National,state.is.null`)
      .order('deadline_date', { ascending: true });

    return NextResponse.json({
      site: {
        id: site.id,
        name: site.name,
        state: siteState,
        discom: siteDiscom,
        voltageCategory: siteVoltage,
      },
      sources: regSources || [],
      charges: applicableCharge,
      tariff: applicableTariff,
      calendar: obligations || [],
      hasApprovedData: Boolean(regSources && regSources.length > 0),
      legalDisclaimer: 'NOT FORMAL LEGAL ADVICE. Statutory parameters are published from official Commission regulatory orders for algorithmic decision support only.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error fetching compliance records' },
      { status: 500 }
    );
  }
}
