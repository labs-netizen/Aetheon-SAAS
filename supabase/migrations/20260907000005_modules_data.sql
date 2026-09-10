-- Aetheon Energy Intelligence Platform - Migration 05: Module Data Entities
-- Implements Grid Forecasts, DSM Schedules & Incidents, BESS Assets & Signals, and Renewable Assets.

-- 1. Grid Forecast Runs & 96 Blocks
CREATE TABLE IF NOT EXISTS grid_forecast_runs (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    operating_date DATE NOT NULL,
    model_version VARCHAR(50) NOT NULL DEFAULT 'DEMO_BASELINE_v1.0',
    model_generation_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    average_price_inr_per_mwh NUMERIC(10, 2) NOT NULL,
    peak_demand_kw NUMERIC(12, 2) NOT NULL,
    peak_demand_block INTEGER NOT NULL CHECK (peak_demand_block BETWEEN 1 AND 96),
    quality_status VARCHAR(20) NOT NULL DEFAULT 'PASSED',
    freshness_status VARCHAR(20) NOT NULL DEFAULT 'DEMO',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(site_id, operating_date)
);

CREATE TABLE IF NOT EXISTS grid_forecast_blocks (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES grid_forecast_runs(id) ON DELETE CASCADE,
    block_index INTEGER NOT NULL CHECK (block_index BETWEEN 1 AND 96),
    start_time VARCHAR(10) NOT NULL,
    end_time VARCHAR(10) NOT NULL,
    forecast_demand_kw NUMERIC(12, 2) NOT NULL,
    forecast_price_inr_per_mwh NUMERIC(10, 2) NOT NULL,
    confidence_lower_kw NUMERIC(12, 2) NOT NULL,
    confidence_upper_kw NUMERIC(12, 2) NOT NULL,
    is_high_cost_window BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(run_id, block_index)
);

-- 2. DSM Incidents (Adjacent-block grouping)
CREATE TABLE IF NOT EXISTS dsm_incidents (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    operating_date DATE NOT NULL,
    start_block INTEGER NOT NULL CHECK (start_block BETWEEN 1 AND 96),
    end_block INTEGER NOT NULL CHECK (end_block BETWEEN 1 AND 96),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('WATCH', 'HIGH', 'CRITICAL')),
    max_deviation_pct NUMERIC(6, 2) NOT NULL,
    total_excess_energy_kwh NUMERIC(12, 2) NOT NULL,
    estimated_exposure_inr NUMERIC(12, 2) NOT NULL,
    root_cause_tag VARCHAR(50) DEFAULT 'UNKNOWN',
    acknowledged BOOLEAN NOT NULL DEFAULT false,
    acknowledged_by UUID REFERENCES user_profiles(id),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. BESS Assets & Opportunity Windows
CREATE TABLE IF NOT EXISTS bess_assets (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    usable_capacity_kwh NUMERIC(12, 2) NOT NULL CHECK (usable_capacity_kwh > 0),
    power_rating_kw NUMERIC(12, 2) NOT NULL CHECK (power_rating_kw > 0),
    min_soc_pct NUMERIC(5, 2) NOT NULL DEFAULT 10.0 CHECK (min_soc_pct >= 0),
    max_soc_pct NUMERIC(5, 2) NOT NULL DEFAULT 90.0 CHECK (max_soc_pct <= 100),
    current_soc_pct NUMERIC(5, 2) NOT NULL DEFAULT 50.0,
    charge_efficiency NUMERIC(4, 3) NOT NULL DEFAULT 0.92,
    discharge_efficiency NUMERIC(4, 3) NOT NULL DEFAULT 0.92,
    degradation_cost_per_cycle_inr NUMERIC(10, 2) NOT NULL DEFAULT 1500.0,
    maintenance_lock BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_telemetry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bess_signal_runs (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    battery_id UUID NOT NULL REFERENCES bess_assets(id) ON DELETE CASCADE,
    operating_date DATE NOT NULL,
    solver_version VARCHAR(50) NOT NULL DEFAULT 'BESS_ADVISORY_HEURISTIC_DEMO_v1.0',
    gross_arbitrage_inr NUMERIC(12, 2) NOT NULL,
    degradation_cost_inr NUMERIC(12, 2) NOT NULL,
    net_opportunity_inr NUMERIC(12, 2) NOT NULL,
    equivalent_cycles NUMERIC(6, 2) NOT NULL,
    is_suppressed BOOLEAN NOT NULL DEFAULT false,
    suppression_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(battery_id, operating_date)
);

-- 4. Renewable Assets & Reconciliations
CREATE TABLE IF NOT EXISTS renewable_assets (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    technology VARCHAR(50) NOT NULL DEFAULT 'SOLAR_PV', -- SOLAR_PV, WIND, HYBRID
    installed_capacity_kw NUMERIC(12, 2) NOT NULL CHECK (installed_capacity_kw > 0),
    commissioning_date DATE,
    inverter_capacity_kva NUMERIC(12, 2),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
