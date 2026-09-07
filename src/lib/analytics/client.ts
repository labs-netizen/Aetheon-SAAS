/**
 * Server-Side Typed Client for Python FastAPI Analytics Microservice
 * Communicates server-to-server: Next.js API/Server Actions -> FastAPI (port 8000)
 * Secret tokens are held exclusively on the server and never exposed to client browsers.
 */

const isProduction = process.env.NODE_ENV === 'production';
const ANALYTICS_BASE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://127.0.0.1:8000';
const ANALYTICS_SERVICE_TOKEN = process.env.ANALYTICS_SERVICE_TOKEN;

if (!process.env.ANALYTICS_SERVICE_TOKEN && isProduction) {
  throw new Error('CRITICAL: ANALYTICS_SERVICE_TOKEN must be set in production environment');
}
const effectiveToken = process.env.ANALYTICS_SERVICE_TOKEN || '';

export interface GridForecastParams {
  siteId: string;
  operatingDate: string;
  contractDemandKw: number;
  historicalLoadKw?: number[];
  seed?: number;
}

export interface DSMCalculationParams {
  siteId: string;
  operatingDate: string;
  scheduledDrawalKw: number[];
  actualDrawalKw: number[];
  contractDemandKw: number;
}

export interface BESSSolverParams {
  batteryId: string;
  siteId: string;
  operatingDate: string;
  usableCapacityKwh: number;
  powerRatingKw: number;
  initialSocPct: number;
  minSocPct: number;
  maxSocPct: number;
  chargeEfficiency?: number;
  dischargeEfficiency?: number;
  degradationCostPerCycleInr?: number;
  pricesInrPerMwh: number[];
  maintenanceLockActive?: boolean;
  telemetryStale?: boolean;
  interconnectionRestricted?: boolean;
}

export interface RenewableReconciliationParams {
  siteId: string;
  operatingDate: string;
  installedCapacityKw: number;
  measuredGenerationKwh: number[];
  gridEmissionFactorTco2ePerMwh?: number;
}

async function callAnalyticsEndpoint<TResponse>(endpoint: string, payload: unknown): Promise<TResponse> {
  if (!effectiveToken) {
    throw new Error('CRITICAL: ANALYTICS_SERVICE_TOKEN is not configured (analytics client fails closed in production)');
  }
  const url = `${ANALYTICS_BASE_URL}${endpoint}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${effectiveToken}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Analytics service responded with status ${response.status}: ${errText}`);
    }

    return (await response.json()) as TResponse;
  } catch (err) {
    throw new Error(`Failed to communicate with analytics microservice at ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function fetchGridForecast(params: GridForecastParams) {
  return callAnalyticsEndpoint('/v1/grid/forecast', {
    site_id: params.siteId,
    operating_date: params.operatingDate,
    contract_demand_kw: params.contractDemandKw,
    historical_load_kw: params.historicalLoadKw,
    seed: params.seed,
  });
}

export async function fetchDSMCalculation(params: DSMCalculationParams) {
  return callAnalyticsEndpoint('/v1/dsm/deviation', {
    site_id: params.siteId,
    operating_date: params.operatingDate,
    scheduled_drawal_kw: params.scheduledDrawalKw,
    actual_drawal_kw: params.actualDrawalKw,
    contract_demand_kw: params.contractDemandKw,
  });
}

export async function fetchBESSAdvisory(params: BESSSolverParams) {
  return callAnalyticsEndpoint('/v1/bess/optimise-demo', {
    battery_id: params.batteryId,
    site_id: params.siteId,
    operating_date: params.operatingDate,
    usable_capacity_kwh: params.usableCapacityKwh,
    power_rating_kw: params.powerRatingKw,
    initial_soc_pct: params.initialSocPct,
    min_soc_pct: params.minSocPct,
    max_soc_pct: params.maxSocPct,
    charge_efficiency: params.chargeEfficiency ?? 0.92,
    discharge_efficiency: params.dischargeEfficiency ?? 0.92,
    degradation_cost_per_cycle_inr: params.degradationCostPerCycleInr ?? 1500.0,
    prices_inr_per_mwh: params.pricesInrPerMwh,
  });
}

export async function fetchRenewableReconciliation(params: RenewableReconciliationParams) {
  return callAnalyticsEndpoint('/v1/renewables/reconcile', {
    site_id: params.siteId,
    operating_date: params.operatingDate,
    installed_capacity_kw: params.installedCapacityKw,
    measured_generation_kwh: params.measuredGenerationKwh,
    grid_emission_factor_tco2e_per_mwh: params.gridEmissionFactorTco2ePerMwh ?? 0.716,
  });
}
