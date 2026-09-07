-- Aetheon Energy Intelligence Platform - Seed Data
-- Deterministic demonstration data for Indian C&I consumers.
-- CRITICAL GOVERNANCE RULE: All synthetic regulatory, tariff, and operational values are explicitly stamped DEMO / UNVERIFIED.

-- 1. Products Catalogue
INSERT INTO products (id, name, description, base_price_paise, billing_interval, availability_status)
VALUES
('GRID_INTELLIGENCE', 'Grid Intelligence Monitor', '96-block price/demand forecast, Daily Grid Brief, and peak cost avoidance.', 1990000, 'MONTHLY', 'INTERNAL_VALIDATION'),
('OA_COMPLIANCE', 'Open Access Compliance Sentinel', 'Statutory compliance tracking, DISCOM charge calculation (CSS/AS), and SLDC calendar.', 1490000, 'MONTHLY', 'DEMO'),
('DSM_RISK', 'DSM Risk Monitor', 'Continuous 15-minute deviation tracking and regulatory exposure calculation under CERC rules.', 2990000, 'MONTHLY', 'DEMO'),
('BESS_ARBITRAGE', 'BESS Arbitrage Signals', 'Advisory charge/discharge opportunity window recommendations for C&I batteries.', 4990000, 'MONTHLY', 'DEMO'),
('RENEWABLE_PORTFOLIO', 'Renewable Portfolio Monitor', 'Generation reconciliation (measured/modelled/estimated) and carbon avoidance ledger.', 2490000, 'MONTHLY', 'DEMO')
ON CONFLICT (id) DO NOTHING;

-- 2. Notification Templates
INSERT INTO notification_templates (id, title_template, body_template)
VALUES
('PAYMENT_CONFIRMED', 'Payment Confirmed: {{product_name}}', 'Your payment of ₹{{amount}} for {{product_name}} has been confirmed. Commercial entitlement is active.'),
('SITE_CREATED', 'New Site Created: {{site_name}}', 'Site {{site_name}} has been configured for DISCOM {{discom}}. Operational activation status: CONFIGURED.'),
('DATA_SOURCE_CONNECTED', 'Data Source Active: {{source_name}}', 'Data source {{source_name}} has established connection for site {{site_name}}. Calibration commenced.'),
('DATA_VALIDATION_FAILED', 'Ingestion Alert: Validation Failed for {{filename}}', 'File {{filename}} was rejected due to: {{reason}}. Immediate remediation required.'),
('PRODUCT_ACTIVATED', 'Operational Activation: {{product_name}} is now ACTIVE', 'Data readiness requirements satisfied. Operational monitoring is now ACTIVE for site {{site_name}}.'),
('PAYMENT_FAILURE', 'Billing Alert: Payment Failed for Subscription {{subscription_id}}', 'Your recent renewal payment could not be processed. Please update payment method to avoid suspension.')
ON CONFLICT (id) DO NOTHING;

-- 3. Demo Organisation & Site
INSERT INTO organisations (id, name, legal_entity_name, gstin, billing_address, is_active)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Aetheon Demo Industries Pvt Ltd',
    'Aetheon Demo Industries Private Limited',
    '27AABCA1234F1Z5',
    '{"address_line": "Plot 42, Aetheon Demo Industrial Park, Phase II", "city": "Pune", "state": "Maharashtra", "pincode": "410501"}'::jsonb,
    true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO sites (
    id, organisation_id, name, state, discom, voltage_category, 
    contract_demand_value, contract_demand_unit, metering_point, 
    load_class, activation_status, activation_reason, is_demo
)
VALUES (
    'b0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Aetheon Demo Manufacturing Facility 1',
    'Maharashtra',
    'MSEDCL',
    '33kV',
    2500.0,
    'kVA',
    'Main Substation Incomer Feeder 1',
    'Continuous Process Industrial (Demo)',
    'ACTIVE',
    'Calibrated on 30-day historical interval dataset (DEMO)',
    true
) ON CONFLICT (id) DO NOTHING;

-- 4. Demo Users & Memberships
INSERT INTO user_profiles (id, full_name, email, phone, is_platform_admin, mfa_enabled)
VALUES
('c0000000-0000-0000-0000-000000000001', 'Rajesh Sharma (Aetheon Demo Admin)', 'rajesh.demo@demo.aetheonlabs.in', '+919820011223', false, true),
('c0000000-0000-0000-0000-000000000002', 'Vikram Desai (Aetheon Demo Energy Manager)', 'vikram.demo@demo.aetheonlabs.in', '+919820044556', false, false),
('c0000000-0000-0000-0000-000000000003', 'Sunil Pawar (Aetheon Demo Operator)', 'sunil.demo@demo.aetheonlabs.in', '+919820077889', false, false),
('c0000000-0000-0000-0000-000000000004', 'Anita Roy (Aetheon Demo Finance Viewer)', 'anita.demo@demo.aetheonlabs.in', '+919820099001', false, false),
('c0000000-0000-0000-0000-000000000005', 'Aetheon Support Analyst', 'analyst.internal@demo.aetheonlabs.in', '+919820000001', false, true),
('c0000000-0000-0000-0000-000000000006', 'Aetheon Regulatory Reviewer', 'regulatory.internal@demo.aetheonlabs.in', '+919820000002', false, true)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email;

INSERT INTO memberships (organisation_id, user_id, role, is_active, expires_at)
VALUES
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'ORGANISATION_ADMIN', true, null),
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'ENERGY_MANAGER', true, null),
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'OPERATOR', true, null),
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'FINANCE_SUSTAINABILITY_VIEWER', true, null),
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'AETHEON_ANALYST', true, now() + interval '24 hours'),
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000006', 'AETHEON_REGULATORY_REVIEWER', true, null)
ON CONFLICT (organisation_id, user_id) DO NOTHING;

-- Explicit site grants for demo site 1
INSERT INTO site_access (site_id, user_id, granted_by)
VALUES
('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001'),
('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001'),
('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001')
ON CONFLICT (site_id, user_id) DO NOTHING;

-- 5. Active Subscriptions & Entitlements for Demo Site
INSERT INTO subscriptions (id, organisation_id, status, current_period_start, current_period_end)
VALUES (
    'd0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'ACTIVE',
    now() - interval '10 days',
    now() + interval '20 days'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO entitlements (organisation_id, product_id, site_id, is_active)
VALUES
('a0000000-0000-0000-0000-000000000001', 'GRID_INTELLIGENCE', 'b0000000-0000-0000-0000-000000000001', true),
('a0000000-0000-0000-0000-000000000001', 'DSM_RISK', 'b0000000-0000-0000-0000-000000000001', true),
('a0000000-0000-0000-0000-000000000001', 'BESS_ARBITRAGE', 'b0000000-0000-0000-0000-000000000001', true),
('a0000000-0000-0000-0000-000000000001', 'RENEWABLE_PORTFOLIO', 'b0000000-0000-0000-0000-000000000001', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Demo Assets (BESS and Solar PV)
INSERT INTO bess_assets (
    id, site_id, name, usable_capacity_kwh, power_rating_kw, 
    min_soc_pct, max_soc_pct, current_soc_pct, charge_efficiency, 
    discharge_efficiency, degradation_cost_per_cycle_inr, maintenance_lock, is_active
)
VALUES (
    'e0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'Tesla Megapack 2XL Demo Battery',
    1000.0,
    500.0,
    10.0,
    90.0,
    45.0,
    0.92,
    0.92,
    1800.0,
    false,
    true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO renewable_assets (
    id, site_id, name, technology, installed_capacity_kw, commissioning_date, is_active
)
VALUES (
    'f0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'Factory Rooftop Solar PV Phase 1',
    'SOLAR_PV',
    1200.0,
    '2024-03-15',
    true
) ON CONFLICT (id) DO NOTHING;

-- 7. Unverified Demo Regulatory Sources & Tariffs (Explicitly labelled DEMO)
INSERT INTO regulatory_sources (
    id, jurisdiction, state, discom, document_title, 
    document_date, effective_date, version, status, is_demo
)
VALUES (
    '10000000-0000-0000-0000-000000000001',
    'MERC',
    'Maharashtra',
    'MSEDCL',
    'MSEDCL Multi-Year Tariff Order (DEMO / UNVERIFIED SYNTHETIC)',
    '2024-04-01',
    '2024-04-01',
    'MERC_MYT_2024_DEMO',
    'APPROVED',
    true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO discom_tariffs (
    state, discom, voltage_category, category_name, 
    fixed_charge_inr_per_kva_month, energy_charge_normal_inr_per_kwh, 
    tod_peak_surcharge_pct, tod_off_peak_rebate_pct, 
    regulatory_source_id, effective_from, is_demo
)
VALUES (
    'Maharashtra',
    'MSEDCL',
    '33kV',
    'HT-1 Continuous Industry',
    525.0,
    7.45,
    20.0,
    15.0,
    '10000000-0000-0000-0000-000000000001',
    '2024-04-01',
    true
) ON CONFLICT (id) DO NOTHING;
