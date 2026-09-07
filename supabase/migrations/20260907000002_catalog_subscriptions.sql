-- Aetheon Energy Intelligence Platform - Migration 02: Catalogue, Subscriptions & Entitlements
-- Implements products, integer paise pricing, commercial subscriptions, and site/state entitlement mapping.

-- 1. Product Catalogue
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY, -- 'GRID_INTELLIGENCE', 'OA_COMPLIANCE', 'DSM_RISK', 'BESS_ARBITRAGE', 'RENEWABLE_PORTFOLIO'
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    base_price_paise BIGINT NOT NULL CHECK (base_price_paise >= 0),
    billing_interval VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
    availability_status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (availability_status IN ('DEVELOPMENT', 'DEMO', 'INTERNAL_VALIDATION', 'AVAILABLE', 'DEGRADED', 'RETIRED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Commercial Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED')),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    billing_provider VARCHAR(50) NOT NULL DEFAULT 'RAZORPAY',
    billing_provider_ref VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organisation_id);

-- 3. Subscription Items
CREATE TABLE IF NOT EXISTS subscription_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id),
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    state_scope VARCHAR(100),
    unit_price_paise BIGINT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Centralized Entitlements (Decoupled from payment status)
CREATE TABLE IF NOT EXISTS entitlements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id),
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    state_scope VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ,
    granted_by VARCHAR(255) NOT NULL DEFAULT 'SYSTEM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entitlements_lookup 
ON entitlements(organisation_id, product_id, site_id, is_active);

-- 5. Invoices & Billing History
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    invoice_number VARCHAR(100) NOT NULL UNIQUE,
    amount_paise BIGINT NOT NULL,
    tax_paise BIGINT NOT NULL DEFAULT 0,
    total_paise BIGINT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(50) NOT NULL DEFAULT 'PAID' CHECK (status IN ('DRAFT', 'OPEN', 'PAID', 'UNCOLLECTIBLE', 'VOID')),
    paid_at TIMESTAMPTZ,
    pdf_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Processed Webhook Events (Idempotency & Replay Protection)
CREATE TABLE IF NOT EXISTS processed_webhook_events (
    id VARCHAR(255) PRIMARY KEY,
    provider VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Billing Customers Mapping
CREATE TABLE IF NOT EXISTS billing_customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'RAZORPAY',
    provider_customer_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(organisation_id, provider)
);

-- 8. Billing Events Audit
CREATE TABLE IF NOT EXISTS billing_events (
    id BIGSERIAL PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'RAZORPAY',
    provider_event_id VARCHAR(255),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_org ON billing_events(organisation_id, created_at DESC);
