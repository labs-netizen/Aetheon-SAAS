import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { POST as createSite } from '@/app/api/sites/route';
import { POST as acceptInvite } from '@/app/api/invitations/accept/route';
import { POST as sendInvite } from '@/app/api/invitations/send/route';
import { POST as webhook } from '@/app/api/webhooks/razorpay/route';
import { POST as cancel } from '@/app/api/billing/cancel/route';
import { GET as adminAudit } from '@/app/api/admin/audit/route';
import { authorizeApiRequest } from '@/lib/auth/api-guard';
import { checkServerEntitlement } from '@/lib/auth/entitlements';
import { billingProvider, RazorpayBillingAdapter } from '@/features/billing/razorpayAdapter';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const stamp = crypto.randomUUID();
const siteFields = { name: 'Pass 1 site', state: 'Maharashtra', discom: 'MSEDCL', voltage_category: '33kV',
  contract_demand_value: 1000, contract_demand_unit: 'kVA', metering_point: 'Main incomer', is_demo: false };
function sql(input: string) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_Aetheon-SAAS', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'],
    { input, encoding: 'utf8' }).trim();
}
function req(path: string, token: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function must(query: any): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

describe('Pass 1 security authority adversarial regressions', () => {
  let db: SupabaseClient, customer: SupabaseClient, operator: SupabaseClient;
  let org: string, otherOrg: string, site: string, otherSite: string, hiddenSite: string;
  let owner: any, invitee: any, outsider: any, analyst: any;
  async function user(label: string, metadata = {}) {
    const email = `pass1-${label}-${stamp}@example.com`;
    const data = await must(db.auth.admin.createUser({ email, password: 'Pass1-Secure-Password!123', email_confirm: true, user_metadata: metadata }));
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const session = await must(client.auth.signInWithPassword({ email, password: 'Pass1-Secure-Password!123' }));
    return { id: data.user.id, email, token: session.session.access_token, client };
  }
  async function invitation(email = invitee.email, siteId = site, role = 'OPERATOR') {
    const token = crypto.randomBytes(32).toString('hex');
    const row = await must(db.rpc('create_invitation_atomic', { p_org_id: org, p_email: email, p_role: role,
      p_site_id: siteId, p_token: token, p_expires_at: new Date(Date.now()+3600000).toISOString(),
      p_invited_by: owner.id, p_actor_role: 'SPOOFED_ROLE' }));
    return { ...row, token };
  }
  async function checkout(mode = 'RAZORPAY_LIVE') {
    return must(db.from('billing_checkout_sessions').insert({ provider_reference: `order_${crypto.randomUUID().replaceAll('-', '')}`,
      organisation_id: org, site_id: site, product_id: 'DSM_RISK', amount_paise: 2490000, provider_mode: mode }).select().single());
  }
  function payload(c: any, overrides = {}) {
    return { event: 'payment.captured', created_at: Math.floor(Date.now()/1000)-86400,
      payload: { payment: { entity: { id: `pay_${crypto.randomUUID().replaceAll('-', '')}`, order_id: c.provider_reference,
        amount: c.amount_paise, currency: 'INR', status: 'captured', captured: true,
        notes: { org_id: otherOrg, site_id: otherSite, product_id: 'BESS_ARBITRAGE' }, ...overrides } } } };
  }
  async function deliver(body: any, event: string = crypto.randomUUID()) {
    const raw = JSON.stringify(body), secret = 'pass1-webhook-secret';
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', secret);
    return webhook(new NextRequest('http://localhost/api/webhooks/razorpay', { method: 'POST', body: raw,
      headers: { 'x-razorpay-event-id': event, 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') } }));
  }
  beforeAll(async () => {
    if (!['127.0.0.1','localhost'].includes(new URL(url).hostname)) throw new Error('Local Supabase only');
    db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    org = (await must(db.from('organisations').insert({ name: `Pass1 ${stamp}`, legal_entity_name: 'Pass1' }).select().single())).id;
    otherOrg = (await must(db.from('organisations').insert({ name: `Pass1 other ${stamp}`, legal_entity_name: 'Pass1 other' }).select().single())).id;
    owner = await user('owner'); invitee = await user('invitee'); outsider = await user('outsider'); analyst = await user('analyst');
    customer = owner.client; operator = invitee.client;
    await must(db.from('memberships').insert([
      { organisation_id: org, user_id: owner.id, role: 'ORGANISATION_ADMIN' },
      { organisation_id: otherOrg, user_id: outsider.id, role: 'ORGANISATION_ADMIN' },
      { organisation_id: org, user_id: analyst.id, role: 'AETHEON_ANALYST', expires_at: new Date(Date.now()+3600000).toISOString() },
    ]));
    site = (await must(db.from('sites').insert({ ...siteFields, organisation_id: org }).select().single())).id;
    hiddenSite = (await must(db.from('sites').insert({ ...siteFields, organisation_id: org }).select().single())).id;
    otherSite = (await must(db.from('sites').insert({ ...siteFields, organisation_id: otherOrg }).select().single())).id;
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('final catalog exposes no client mutating RPCs, unpinned definers, or write policies on audited tables', () => {
    expect(sql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef
      AND (p.proconfig IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp'=ANY(p.proconfig)));`)).toBe('0');
    expect(sql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef
      AND p.proname NOT IN ('is_org_member','has_org_role','is_platform_admin','has_site_access','is_internal_aetheon_user','is_aetheon_analyst','is_regulatory_reviewer')
      AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'));`)).toBe('0');
    expect(sql(`SELECT count(*) FROM pg_policies WHERE schemaname='public' AND cmd <> 'SELECT' AND tablename IN
      ('memberships','organisation_invitations','site_access','sites','interval_data_96','bess_assets','entitlements','report_records','audit_logs');`)).toBe('0');
  });

  it.each(['memberships','organisation_invitations','site_access','sites','interval_data_96','bess_assets','entitlements','report_records','audit_logs'])(
    'rejects direct customer insertion to %s before any trusted state can be written', async (table) => {
      const { error } = await customer.from(table).insert({});
      expect(error?.code).toBe('42501');
    });

  it('rejects direct membership edits/deletes and invitation tampering without an audited route', async () => {
    const i = await invitation();
    for (const query of [customer.from('memberships').update({ role: 'ORGANISATION_ADMIN' }).eq('user_id', outsider.id),
      customer.from('memberships').delete().eq('user_id', owner.id),
      customer.from('organisation_invitations').update({ site_id: otherSite }).eq('id', i.id)]) {
      expect((await query).error?.code).toBe('42501');
    }
    const unchanged = await must(db.from('organisation_invitations').select('site_id').eq('id',i.id).single());
    expect(unchanged.site_id).toBe(site);
  });

  it('atomically audits trusted membership changes and rolls them back on audit failure', async () => {
    sql(`CREATE FUNCTION public.pass1_fail_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='MEMBERSHIPS_UPDATE' AND NEW.details->'after'->>'user_id'='${owner.id}' THEN
        RAISE EXCEPTION 'PASS1_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER pass1_fail_membership BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.pass1_fail_membership();`);
    try {
      const { error } = await db.from('memberships').update({is_active:false}).eq('user_id',owner.id).eq('organisation_id',org);
      expect(error?.message).toContain('PASS1_AUDIT_FAILURE');
      expect((await must(db.from('memberships').select('is_active').eq('user_id',owner.id).eq('organisation_id',org).single())).is_active).toBe(true);
    } finally { sql('DROP TRIGGER pass1_fail_membership ON public.audit_logs; DROP FUNCTION public.pass1_fail_membership();'); }
    const i = await invitation();
    await must(db.from('organisation_invitations').update({status:'REVOKED'}).eq('id',i.id));
    const log = await must(db.from('audit_logs').select('details').eq('entity_id',i.id).eq('action','ORGANISATION_INVITATIONS_UPDATE').single());
    expect(log.details.after.status).toBe('REVOKED');
    expect(log.details.after.token).toBeUndefined();
    expect(log.details.after.token_hash).toBeUndefined();
  });

  it('rejects cross-tenant invitation IDs and derives audit role from membership', async () => {
    const res = await sendInvite(req('/api/invitations/send', owner.token, { organisationId: org, siteId: otherSite, email: invitee.email, role: 'OPERATOR' }));
    expect(res.status).toBe(400);
    const i = await invitation();
    const audit = await must(db.from('audit_logs').select('actor_role').eq('entity_id',i.id).eq('action','INVITATION_CREATED').single());
    expect(audit.actor_role).toBe('ORGANISATION_ADMIN');
    const { error } = await db.rpc('update_site_config_atomic', { p_site_id: otherSite, p_org_id: org, p_actor_id: owner.id,
      p_actor_role: 'ORGANISATION_ADMIN', p_updates: { name: 'spoofed' } });
    expect(error?.message).toContain('SITE_ORGANISATION_MISMATCH');
    expect((await db.rpc('create_site_atomic', { p_org_id: org, p_actor_id: outsider.id, p_site: siteFields })).error?.code).toBe('42501');
  });

  it('rolls back site, access and activation state when the actual audit INSERT fails, then succeeds normally', async () => {
    const name = `Pass1 rollback ${stamp}`;
    sql(`CREATE FUNCTION public.pass1_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='SITE_CREATED' AND NEW.actor_id='${owner.id}' THEN RAISE EXCEPTION 'PASS1_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER pass1_fail_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.pass1_fail_audit();`);
    try {
      const res = await createSite(req('/api/sites', owner.token, { ...siteFields, name, organisationId: org }));
      expect(res.status).toBe(500);
      expect(await must(db.from('sites').select('id').eq('name',name))).toEqual([]);
    } finally { sql('DROP TRIGGER pass1_fail_audit ON public.audit_logs; DROP FUNCTION public.pass1_fail_audit();'); }
    const res = await createSite(req('/api/sites', owner.token, { ...siteFields, name, organisationId: org }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect((await must(db.from('site_access').select('id').eq('site_id',body.site.id))).length).toBe(1);
    expect((await must(db.from('site_activation_history').select('id').eq('site_id',body.site.id))).length).toBe(1);
    expect((await must(db.from('audit_logs').select('id').eq('entity_id',body.site.id).eq('action','SITE_CREATED'))).length).toBe(1);
  });

  it('rolls back acceptance on audit failure and serializes simultaneous token redemption', async () => {
    const i = await invitation();
    sql(`CREATE FUNCTION public.pass1_fail_accept() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='INVITATION_ACCEPTED' AND NEW.entity_id='${i.id}' THEN RAISE EXCEPTION 'PASS1_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER pass1_fail_accept BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.pass1_fail_accept();`);
    try {
      expect((await acceptInvite(req('/api/invitations/accept',invitee.token,{token:i.token}))).status).toBe(500);
      expect(await must(db.from('memberships').select('id').eq('user_id',invitee.id).eq('organisation_id',org))).toEqual([]);
      expect(await must(db.from('site_access').select('id').eq('user_id',invitee.id))).toEqual([]);
      expect((await must(db.from('organisation_invitations').select('status').eq('id',i.id).single())).status).toBe('PENDING');
    } finally { sql('DROP TRIGGER pass1_fail_accept ON public.audit_logs; DROP FUNCTION public.pass1_fail_accept();'); }
    const results = await Promise.all([1,2].map(() => acceptInvite(req('/api/invitations/accept',invitee.token,{token:i.token}))));
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await must(db.from('audit_logs').select('id').eq('entity_id',i.id).eq('action','INVITATION_ACCEPTED'))).length).toBe(1);
  });

  it('does not let an invitation overwrite an existing membership or a revoked inviter grant access', async () => {
    const promoted = await invitation(invitee.email,site,'ORGANISATION_ADMIN');
    expect((await acceptInvite(req('/api/invitations/accept',invitee.token,{token:promoted.token}))).status).toBe(409);
    const i = await invitation(outsider.email);
    await must(db.from('memberships').update({is_active:false}).eq('user_id',owner.id).eq('organisation_id',org));
    try { expect((await acceptInvite(req('/api/invitations/accept',outsider.token,{token:i.token}))).status).toBe(403); }
    finally { await must(db.from('memberships').update({is_active:true}).eq('user_id',owner.id).eq('organisation_id',org)); }
  });

  it('denies site/org mismatch, expired membership, analyst global audit and anonymous demo mutations', async () => {
    expect((await authorizeApiRequest(req('/api/test',owner.token,{}),{organisationId:otherOrg,siteId:site})).authorized).toBe(false);
    await must(db.from('memberships').update({expires_at:'2020-01-01'}).eq('user_id',invitee.id).eq('organisation_id',org));
    expect((await authorizeApiRequest(req('/api/test',invitee.token,{}),{siteId:site})).authorized).toBe(false);
    await must(db.from('memberships').update({expires_at:null}).eq('user_id',invitee.id).eq('organisation_id',org));
    expect((await adminAudit(new Request('http://localhost/api/admin/audit',{headers:{Authorization:`Bearer ${analyst.token}`}}))).status).toBe(403);
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE','true');
    expect((await authorizeApiRequest(req('/api/test','',{}),{organisationId:'a0000000-0000-0000-0000-000000000001'})).authorized).toBe(false);
    expect((await authorizeApiRequest(new NextRequest('http://localhost/api/test'),{organisationId:'a0000000-0000-0000-0000-000000000001',siteId:site})).authorized).toBe(false);
  });

  it('signup metadata cannot select demo mode or platform/internal authority', async () => {
    const u = await user('metadata',{is_demo:true,is_platform_admin:true,role:'AETHEON_ANALYST',organisation_name:'Pass1 metadata',site_name:'Fake demo'});
    const m = await must(db.from('memberships').select('organisation_id,role').eq('user_id',u.id).single());
    expect(m.role).toBe('ORGANISATION_ADMIN');
    expect((await must(db.from('user_profiles').select('is_platform_admin').eq('id',u.id).single())).is_platform_admin).toBe(false);
    expect(await must(db.from('sites').select('id').eq('organisation_id',m.organisation_id))).toEqual([]);
  });

  it.each([{order_id:'order_mock_spoof'}, {amount:1}, {currency:'USD'}, {status:'authorized',captured:false}])(
    'quarantines spoofed payment facts %j without granting entitlement', async (override) => {
      const c = await checkout(); const body = payload(c,override); const res = await deliver(body);
      expect(res.status).toBe(422);
      const id = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
      expect((await must(db.from('processed_webhook_events').select('status').eq('id',id).single())).status).toBe('QUARANTINED');
      expect((await must(db.from('billing_checkout_sessions').select('status').eq('id',c.id).single())).status).toBe('CREATED');
      expect(await must(db.from('subscriptions').select('id').eq('billing_provider_ref',c.provider_reference))).toEqual([]);
      expect((await deliver(body)).status).toBe(422);
    });

  it.each(['MOCK_DEVELOPMENT','RAZORPAY_TEST'])('never grants live entitlements from %s payment sessions', async mode => {
    const c = await checkout(mode); expect((await deliver(payload(c))).status).toBe(422);
  });

  it('accepts delayed signed captures, ignores notes, and deduplicates concurrent event types and unsigned headers', async () => {
    const c = await checkout(); const body = payload(c);
    const responses = await Promise.all([deliver(body),deliver({...body,event:'order.paid'})]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    const sub = await must(db.from('subscriptions').select('*').eq('billing_provider_ref',c.provider_reference).single());
    const before = await must(db.from('entitlements').select('*').eq('organisation_id',org).eq('site_id',site).eq('product_id','DSM_RISK').single());
    expect((await deliver(body,'forged-delivery-header')).status).toBe(200);
    expect((await must(db.from('invoices').select('id').eq('subscription_id',sub.id))).length).toBe(1);
    const after = await must(db.from('entitlements').select('*').eq('id',before.id).single());
    expect(after.valid_until).toBe(before.valid_until);
    expect(after.organisation_id).toBe(org);
    expect(await must(db.from('entitlements').select('id').eq('organisation_id',otherOrg))).toEqual([]);
    const failed = payload(c,{status:'failed',captured:false}); failed.event='payment.failed';
    expect((await deliver(failed)).status).toBe(200);
    expect((await must(db.from('billing_checkout_sessions').select('status').eq('id',c.id).single())).status).toBe('PAID');
  });

  it('blocks cross-site report reads and future/expired entitlement bypasses through API and RLS', async () => {
    await must(db.from('entitlements').upsert({organisation_id:org,site_id:site,product_id:'DSM_RISK',is_active:true,
      valid_from:'2090-01-01',valid_until:'2091-01-01'},{onConflict:'organisation_id,product_id,site_id'}));
    expect((await checkServerEntitlement(org,site,'DSM_RISK')).entitled).toBe(false);
    const report = await must(db.from('report_records').insert({organisation_id:org,site_id:site,module:'DSM',report_type:'DSM_MONTHLY_REVIEW',
      period_start:'2026-09-01',period_end:'2026-09-08',title:'Pass1 private report',model_version:'test'}).select().single());
    expect(await must(customer.from('report_records').select('id').eq('id',report.id))).toEqual([]);
    await must(db.from('entitlements').update({valid_from:'2020-01-01',valid_until:'2021-01-01'}).eq('organisation_id',org).eq('site_id',site).eq('product_id','DSM_RISK'));
    expect((await checkServerEntitlement(org,site,'DSM_RISK')).entitled).toBe(false);
    expect(await must(customer.from('report_records').select('id').eq('id',report.id))).toEqual([]);
    expect(await must(operator.from('sites').select('id').eq('id',hiddenSite))).toEqual([]);
    expect(await must(customer.from('sites').select('id').eq('id',otherSite))).toEqual([]);
  });

  it('retains durable cancellation intent across provider failure and DB audit failure, and converges on retry', async () => {
    const sub = await must(db.from('subscriptions').insert({organisation_id:org,status:'ACTIVE',billing_provider:billingProvider.mode === 'MOCK_DEVELOPMENT' ? 'MOCK' : 'RAZORPAY',
      billing_provider_ref:`sub_mock_${stamp}`,current_period_start:new Date().toISOString(),current_period_end:'2090-01-01'}).select().single());
    const wrongMode = billingProvider.mode === 'MOCK_DEVELOPMENT' ? 'RAZORPAY_LIVE' : 'MOCK_DEVELOPMENT';
    const mismatch = await db.rpc('prepare_subscription_cancellation', {
      p_subscription_id: sub.id, p_org_id: org, p_actor_id: owner.id, p_provider_mode: wrongMode,
    });
    expect(mismatch.error?.message).toContain('PROVIDER_MODE_MISMATCH');
    const provider = vi.spyOn(billingProvider,'cancelSubscription').mockRejectedValueOnce(new Error('network timeout'));
    expect((await cancel(req('/api/billing/cancel',owner.token,{subscriptionId:sub.id}))).status).toBe(202);
    expect((await must(db.from('billing_cancellation_requests').select('status').eq('subscription_id',sub.id).single())).status).toBe('PENDING');
    provider.mockResolvedValue({success:true,mode:billingProvider.mode});
    sql(`CREATE FUNCTION public.pass1_fail_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='SUBSCRIPTION_CANCELLED' AND NEW.entity_id='${sub.id}' THEN RAISE EXCEPTION 'PASS1_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER pass1_fail_cancel BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.pass1_fail_cancel();`);
    try {
      expect((await cancel(req('/api/billing/cancel',owner.token,{subscriptionId:sub.id}))).status).toBe(202);
      expect((await must(db.from('subscriptions').select('cancel_at_period_end').eq('id',sub.id).single())).cancel_at_period_end).toBe(false);
    } finally { sql('DROP TRIGGER pass1_fail_cancel ON public.audit_logs; DROP FUNCTION public.pass1_fail_cancel();'); }
    expect((await cancel(req('/api/billing/cancel',owner.token,{subscriptionId:sub.id}))).status).toBe(200);
    expect((await cancel(req('/api/billing/cancel',owner.token,{subscriptionId:sub.id}))).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(3);
    expect((await must(db.from('audit_logs').select('id').eq('entity_id',sub.id).eq('action','SUBSCRIPTION_CANCELLED'))).length).toBe(1);
  });

  it('rejects test/mock credentials in production and removes the signature bypass', () => {
    vi.stubEnv('NODE_ENV','production'); vi.stubEnv('RAZORPAY_KEY_ID','rzp_test_real'); vi.stubEnv('RAZORPAY_KEY_SECRET','real_secret');
    expect(()=>new RazorpayBillingAdapter()).toThrow('live Razorpay credentials');
    vi.stubEnv('RAZORPAY_KEY_ID','rzp_live_real'); vi.stubEnv('RAZORPAY_KEY_SECRET','');
    expect(()=>new RazorpayBillingAdapter()).toThrow();
    vi.stubEnv('NODE_ENV','test'); vi.stubEnv('RAZORPAY_KEY_ID','');
    expect(new RazorpayBillingAdapter().verifyWebhookSignature('{}','dev_signature_bypass')).toBe(false);
  });
});
