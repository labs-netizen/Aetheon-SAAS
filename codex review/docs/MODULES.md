# Aetheon Energy Intelligence Platform - Product Modules Specification (MODULES.md)

## 1. Grid Intelligence Monitor (Primary Commercial Target)

- **Product ID**: `GRID_INTELLIGENCE`
- **Base Pricing**: ₹19,900 / site / month (1,990,000 paise)
- **Positioning**: Algorithmic decision support for day-ahead power procurement, tariff optimization, and peak demand charge mitigation.
- **Key Features**:
  1. **Daily Grid Brief**: Executive summary of day-ahead grid outlook, forecasted average price, peak demand window, avoided cost estimate, and data freshness.
  2. **96-Block Price & Demand Forecast**: Interactive line/area chart and 96-row tabular view displaying hourly/15-minute expected demand (kW), clearing price (₹/MWh), confidence intervals, and model version.
  3. **Cost Explorer**: Comprehensive scenario comparison modeling baseline utility tariff vs. Open Access sourcing, rooftop solar self-consumption, and battery storage arbitrage.
  4. **High-Cost Window Alerts**: Proactive notifications 4 hours prior to forecasted peak tariff blocks.
  5. **Weekly & Monthly Reports**: Executive performance summaries with CSV export and print-ready layouts.
- **Data Readiness Prerequisites**:
  - *Required*: State, DISCOM, Contract Demand (kVA/MVA), Voltage Category, Active Utility Tariff.
  - *Recommended*: Historical 15-minute interval load data (minimum 30 days).
  - *Optional*: Solar PV profile, BESS configuration, Open Access bilateral contract terms.

---

## 2. Open Access Compliance Sentinel

- **Product ID**: `OA_COMPLIANCE`
- **Base Pricing**: ₹14,900 / state / site / month (1,490,000 paise)
- **Positioning**: Automated statutory compliance tracking, cross-subsidy surcharge (CSS) and additional surcharge (AS) calculations, and regulatory calendar.
- **Key Features**:
  1. **Regulatory Calendar**: Deadlines for open access renewals, SLDC scheduling submissions, and banking reconciliations.
  2. **DISCOM Charge Tracker**: Dynamic breakdown of wheeling charges, transmission losses, CSS, AS, and SLDC scheduling fees.
  3. **Rule Verification Pipeline**: Strict reviewer approval workflow for all tariff orders.
  4. **Statutory Disclaimer**: Explicit declaration: `Information provided is algorithmic decision support and does not constitute formal legal advice`.

---

## 3. DSM Risk Monitor (Deviation Settlement Mechanism)

- **Product ID**: `DSM_RISK`
- **Base Pricing**: ₹29,900 / site / month (2,990,000 paise)
- **Positioning**: Continuous tracking of actual vs. scheduled drawal deviations under CERC/SERC DSM regulations.
- **Key Features**:
  1. **96-Block Deviation Board**: 15-minute scheduled vs. actual drawal variance tracking.
  2. **Risk Band Classification**: `NORMAL` (0-4% deviation), `WATCH` (4-8%), `HIGH` (8-12%), `CRITICAL` (> 12% or grid frequency danger zones).
  3. **Incident Grouping**: Adjacent deviation blocks automatically collated into persistent operational incidents.
  4. **Operational Safeguards**: Alert rate limiting, quiet hours enforcement, and automatic calculation suppression when schedule or meter inputs are missing.

---

## 4. BESS Arbitrage Signals (Battery Energy Storage)

- **Product ID**: `BESS_ARBITRAGE`
- **Base Pricing**: ₹49,900 / site / month (4,990,000 paise)
- **Positioning**: Degradation-aware charge/discharge opportunity window recommendations for C&I battery assets.
- **Strict Advisory Language**: Uses **"Recommended charge/discharge opportunity windows"**. Plant control or autonomous dispatch is explicitly excluded.
- **Key Features**:
  1. **Asset Parameter Modeling**: Usable capacity (kWh), power rating (kW), min/max SOC, charge/discharge efficiency, and cell degradation cost assumptions.
  2. **Opportunity Window Recommendations**: Advisory schedule maximizing arbitrage value while accounting for cycle degradation.
  3. **Safety Interlocks**: Automatic signal suppression when SOC is unknown, telemetry is stale, maintenance lock is on, or interconnection limits are exceeded.

---

## 5. Renewable Portfolio Monitor

- **Product ID**: `RENEWABLE_PORTFOLIO`
- **Base Pricing**: ₹24,900 / site / month (2,490,000 paise)
- **Positioning**: Performance monitoring, generation reconciliation, and carbon emission avoidance ledger for behind-the-meter and captive solar/wind assets.
- **Key Features**:
  1. **Reconciliation Engine**: Strictly segregates `MEASURED`, `MODELLED`, and `ESTIMATED` values.
  2. **Self-Consumption Tracking**: Real-time ratio of onsite solar utilized vs. exported to the grid.
  3. **Carbon Avoidance Ledger**: Versioned emission factors (tCO2e/MWh) calculating avoided emissions without claiming unverified carbon credits.
