# Aetheon subscription platform — product and operating specification

**Version:** 1.0  
**Market:** Indian commercial and industrial (C&I) electricity consumers  
**Positioning:** Algorithmic decision support for power procurement, Open Access, DSM exposure, storage arbitrage, and renewable-portfolio performance.  
**Operating principle:** Sell standardised, automated outputs—not bespoke consultancy or autonomous market execution.

---

## 1. Product portfolio

| Product | Core customer job | Ideal buyer | Primary recurring output | Starting price |
|---|---|---|---|---:|
| Aetheon Grid Intelligence | Know tomorrow's cost and the best sourcing mix | Energy manager at a 1–5 MW C&I site | 96-block forecast and daily action brief | ₹19,900/site/month |
| Open Access Compliance Sentinel | Stay eligible and avoid avoidable regulatory surprises | OA/captive power manager | State-specific compliance calendar and rule-impact alerts | ₹14,900/state/site/month |
| DSM Risk Monitor | Identify and reduce likely deviation-settlement exposure | Scheduling / plant operations lead | Intraday DSM risk alerts and monthly variance report | ₹29,900/site/month |
| BESS Arbitrage Signals | Make storage-dispatch decisions from a measurable spread | Battery owner / EPC / energy manager | Charge-discharge recommendation windows and realised-value report | ₹49,900/site/month |
| Renewable Portfolio Monitor | Measure whether solar and renewable procurement deliver the promised outcome | Sustainability / CFO / energy manager | Generation, savings, RE attribute, and carbon-performance dashboard | ₹24,900/site/month |

### Packaging rules

- Every plan is sold per **site**, with a named primary administrator.
- A “site” is one metering / scheduling boundary; multi-site buyers purchase a portfolio add-on.
- Reports are decision-support outputs. They are not an offer to trade, an instruction to dispatch, legal advice, a guarantee of savings, or a substitute for SLDC/DISCOM requirements.
- Standard delivery is dashboard + email + CSV/PDF export. API access is an add-on.
- Plans renew monthly, are paid in advance, and can be cancelled from the billing portal. Annual prepayment may receive a discount; never lock a customer into an undocumented operational service.

---

## 2. Common customer journey

### 2.1 Self-serve purchase and onboarding

1. Visitor chooses a plan and sees price, scope, covered state(s), data required, exclusions, and a sample report.
2. Checkout collects legal entity name, GSTIN (optional at launch), billing contact, plan, number of sites, and payment mandate.
3. The organisation administrator verifies email and accepts the subscription terms and data-processing notice.
4. The setup wizard creates each site: state, DISCOM, voltage category, contract demand, meter / scheduling boundary, load class, asset mix, and report recipients.
5. The platform displays a data-readiness checklist. It cannot claim “active monitoring” until required data is present and validated.
6. The client receives a clear activation status: **Configured**, **Awaiting data**, **Calibrating**, **Active**, or **Degraded**.

### 2.2 Data-ingestion hierarchy

Use the least burdensome reliable method, in this order:

1. Authorised API or secure SFTP from an approved meter/EMS/vendor.
2. Structured CSV/XLSX upload through the customer portal.
3. Customer-designated mailbox for a standard report template.
4. Manual monthly bill upload for reporting-only plans.

Never ask customers to send credentials by email. Store access tokens in a secrets vault; make them revocable by the customer administrator.

### 2.3 Data-quality status

Every dashboard and alert must display:

- Last successful data timestamp and source.
- Completeness percentage for the relevant period.
- Validation state: passed, warning, failed, or stale.
- Forecast/model version and generation time.
- Applicable state, tariff version, and rule-source date.

If data is stale, suppress prescriptive recommendations and replace them with an explicit “insufficient current data” status.

---

## 3. Service specifications

## 3.1 Aetheon Grid Intelligence

### Customer promise

“Each day, understand expected 15-minute energy cost, likely tariff peaks, and the lowest-cost feasible mix of grid, Open Access, solar, and storage assumptions.”

### Included scope

- Day-ahead 96-block demand and price forecast.
- Grid-baseline versus configured scenario comparison.
- Peak-block, high-cost-window, and forecast-confidence alerts.
- Daily action brief delivered at a fixed configurable time.
- Weekly market summary and monthly savings-opportunity report.
- Downloadable CSV and PDF output.

### Required customer configuration

| Field | Required | Validation |
|---|---|---|
| State and DISCOM | Yes | Must match the supported-state catalogue |
| Contract demand and voltage category | Yes | Numeric range and unit check |
| Historical interval load | Recommended | At least 30 days for calibrated forecast |
| Tariff / latest bill | Yes | Effective-date and unit check |
| OA, solar, BESS availability | Optional | Capacity, availability window, loss and charge assumptions |
| Alert recipients and schedule | Yes | Verified corporate email |

### Core digital deliverables

- **Daily Grid Brief:** tomorrow's forecast, top three high-cost blocks, confidence band, scenario comparison, and assumptions.
- **Cost Explorer:** 15-minute chart, baseline/mix comparison, estimated cost and avoided-cost range.
- **Monthly Performance Report:** forecast accuracy, measured versus estimated cost, opportunity backlog, and data gaps.

### Automation pipeline

`ingest → validate → normalise → feature build → forecast → scenario engine → quality gate → publish dashboard → send alert/report`

- Forecast runs after the latest source-data cut-off and before the promised delivery SLA.
- Scenario engine only evaluates assets the customer has explicitly configured.
- Quality gate blocks outputs if input freshness, forecast confidence, or tariff applicability is below plan policy.

### Plan limits and add-ons

- Monitor: one site, dashboard, daily email, 12-month history.
- Optimise: one site up to 5 MW, configured OA/solar/BESS scenarios, CSV exports, three recipients.
- Portfolio add-on: additional sites, consolidated view, role-based access, API/export integration.

### Product exclusions

- Filing schedules, placing exchange bids, changing SLDC schedules, or controlling equipment.
- State-specific legal interpretation beyond cited source material.
- Guaranteed savings, IRR, or tariff outcomes.

---

## 3.2 Open Access Compliance Sentinel

### Customer promise

“Know which rules, charges, deadlines, and eligibility conditions can affect your configured Open Access or captive-power strategy before they become a surprise.”

### Included scope

- State and DISCOM-specific regulatory watchlist.
- Change alerts categorised by financial impact, deadline, and applicability.
- OA / captive eligibility checklist tied to the customer’s declared configuration.
- Wheeling, transmission, cross-subsidy surcharge, additional surcharge, banking, and scheduling-assumption tracker where published and supported.
- Monthly compliance calendar and evidence register.

### Data sources and governance

- Register each source with publisher, URL, jurisdiction, document date, retrieval timestamp, effective date, and reviewer status.
- Preserve source documents and version history so every platform recommendation can link to its source.
- Machine extraction may draft a summary; a trained reviewer must approve any legal/regulatory interpretation that reaches customers.
- Display “source date” and “not legal advice” beside every material rule interpretation.

### Digital deliverables

- **Rule Impact Alert:** what changed, effective date, potentially affected sites, confidence, source link, and required internal review.
- **Compliance Board:** obligations, owner, deadline, status, evidence attachment, and change log.
- **Monthly Cost Assumption Sheet:** versioned charges and assumptions used in Grid Intelligence scenarios.

### Automation pipeline

`source watch → document capture → change detection → classification → human approval → customer applicability rules → alert → audit trail`

### Plan limits and add-ons

- Sentinel: one state, one site, compliance calendar, monthly digest.
- Multi-state: additional supported states, portfolio view, exportable evidence register.
- Policy Intelligence add-on: quarterly, standardised state-comparison briefing; it must remain a published report, not custom legal advice.

### Product exclusions

- Legal opinions, filings, representation before authorities, or sign-off on statutory compliance.
- Reliance on unverified third-party tariff tables.

---

## 3.3 DSM Risk Monitor

### Customer promise

“See likely deviation risk before and during the operating day, with a transparent measure of uncertainty and a record of realised variance.”

### Required data

- 15-minute actual load or generation data, preferably near-real-time.
- Approved schedule / nominated schedule where relevant.
- Asset availability or outage status.
- State-specific DSM configuration approved by the platform's regulatory-content process.

### Included scope

- Expected-versus-scheduled block-level variance calculation.
- Intraday risk bands: normal, watch, high, and critical.
- Alert rules for configurable deviations, ramp events, missed telemetry, and stale schedule data.
- Daily risk log and monthly variance / exposure-estimate report.
- Root-cause tags: load variance, renewable forecast error, asset outage, schedule-data gap, or unknown.

### Digital deliverables

- **Operations Board:** current day’s 96 blocks, risk state, data freshness, and notable drivers.
- **Risk Alert:** affected time window, magnitude range, confidence, source-data state, and neutral recommended review action.
- **Monthly DSM Review:** variance distribution, high-risk blocks, model accuracy, data integrity, and non-binding exposure estimate.

### Safety and quality controls

- Do not issue “change schedule” commands or automated schedule submissions in v1.
- Require a customer-selected on-call contact and configurable quiet hours.
- Rate-limit alerts; group adjacent affected blocks into a single incident.
- If schedule or meter data is missing, report the gap rather than estimating a compliance result.
- Preserve a tamper-evident event log: input version, model version, output, recipient, and delivery timestamp.

### Plan limits and add-ons

- One monitored site and a defined set of telemetry sources per subscription.
- Intraday alerts only when data freshness meets the published SLA.
- Portfolio command centre and API export are enterprise add-ons.

---

## 3.4 BESS Arbitrage Signals

### Customer promise

“Convert forecasted price spreads and your battery’s operating constraints into explainable charge/discharge opportunity windows.”

### Required configuration

| Field | Why it matters |
|---|---|
| Usable energy capacity (kWh/MWh) | Limits deliverable energy |
| Power rating (kW/MW) | Limits ramp and dispatch rate |
| Round-trip efficiency | Determines economic spread threshold |
| SOC operating range and initial SOC | Keeps recommendations technically feasible |
| Cycle / degradation cost | Prevents false-positive arbitrage value |
| Interconnection and export restrictions | Prevents invalid scenarios |
| Asset availability and maintenance windows | Blocks unavailable recommendations |

### Included scope

- Day-ahead candidate charging and discharge windows.
- Expected gross spread, estimated losses, cycle-cost assumption, and net value range.
- SOC simulation over 96 blocks.
- Asset-performance dashboard and monthly recommended-versus-realised-value report.
- Alerts only for opportunities exceeding the customer-configured minimum net-value threshold.

### Optimisation policy

The optimiser must respect every hard constraint above. It should maximise expected net value only after feasibility checks. Each signal must show:

- Forecast timestamp and model version.
- Assumed tariff/market spread.
- Required charge and discharge blocks.
- Expected energy throughput and SOC path.
- Gross value, loss estimate, degradation-cost assumption, and net-value range.
- Confidence and invalidating conditions.

### Safety boundaries

- Recommendations are advisory until a customer-authorised operator executes them.
- No direct BMS/SCADA control or autonomous dispatch in the base subscription.
- Hard-disable a signal when telemetry is stale, SOC is unknown, a maintenance lock is active, or asset constraints conflict.
- Any future control integration requires a separate security, liability, and site-acceptance programme.

### Plan limits and add-ons

- Signal plan: one BESS, daily signals, dashboard, report export.
- Fleet add-on: multiple batteries, portfolio comparison, API delivery.
- Advanced optimisation: co-optimisation with solar and OA—only after the customer supplies each asset’s constraints.

---

## 3.5 Renewable Portfolio Monitor

### Customer promise

“Make renewable performance, savings attribution, and carbon reporting visible in one reconciled operating view.”

### Included scope

- Solar / renewable generation monitoring and expected-versus-actual performance.
- Grid-import displacement and cost-savings attribution.
- Renewable share, avoided-emissions estimate, and data-quality reporting.
- RE attribute / certificate tracker where the customer provides verified records.
- Monthly executive report for operations, finance, and sustainability teams.

### Required data

- Plant-level 15-minute generation or inverter/EMS interval data.
- Site load and grid-import data.
- Installed capacity, commissioning date, availability / curtailment status.
- Applicable tariff and approved emissions-factor source for reporting.
- For certificate/RPO tracking: customer-provided acquisition and retirement evidence.

### Digital deliverables

- **Portfolio Dashboard:** generation, PR/availability proxy, self-consumption, grid import, savings estimate, and carbon estimate.
- **Exception Alerts:** underperformance, unexpected grid import, curtailment indication, missing meter data.
- **Monthly Board Report:** generation, financial outcome, carbon outcome, data confidence, and actions to investigate.

### Calculation rules

- Separate measured values from modelled estimates.
- Label avoided-emissions results with the source and effective period of the emissions factor.
- Do not market estimates as verified carbon credits or compliance certificates.
- Version every tariff, emissions factor, and asset configuration that contributes to a report.

### Plan limits and add-ons

- One site and one renewable asset family in the base plan.
- Multi-site and multi-asset portfolio consolidation as add-ons.
- ESG reporting export is a template and data export, not assurance.

---

## 4. Shared platform architecture

## 4.1 Product modules

| Module | Responsibility |
|---|---|
| Identity and organisation | Tenant, users, roles, MFA, site ownership, audit logs |
| Billing and entitlements | Subscription status, plan limits, invoices, trial, cancellation, feature flags |
| Onboarding | Site wizard, data checklist, consent, supported-state rules |
| Data gateway | API/SFTP/file/mail ingestion, schema validation, encryption, source metadata |
| Energy data store | Time-series meter, forecast, tariff, schedule, and asset data |
| Regulatory knowledge base | Source documents, versioning, applicability rules, reviewer approval |
| Modelling service | Forecasts, scenario simulations, optimisation, quality scores, model registry |
| Alerts and reporting | Rules engine, email, in-app notifications, PDF/CSV rendering, delivery evidence |
| Customer portal | Dashboard, configuration, reports, billing, support knowledge base |
| Admin console | Tenant health, data incidents, content approvals, usage, and support queue |

## 4.2 Recommended v1 stack

- **Frontend:** Next.js/React with a component library and responsive dashboards.
- **API:** TypeScript or Python service layer with documented REST endpoints.
- **Data:** Postgres for tenants/configuration; managed time-series storage for interval data; object storage for uploaded bills and source documents.
- **Jobs:** Managed queue plus scheduled workers for ingestion, forecasts, alerts, and report generation.
- **Models:** Python forecasting/optimisation services, model registry, reproducible input/output snapshots.
- **Observability:** central logs, metrics, traces, data-pipeline alerts, and per-tenant delivery monitoring.
- **Payments:** an India-capable subscription payment provider with GST-ready invoice flow, recurring mandate support, webhook verification, and self-service cancellation.

Treat payment-provider, meter/EMS, and regulatory-source integrations as replaceable adapters. Do not couple the core product to one vendor.

## 4.3 Access control

| Role | Key permissions |
|---|---|
| Organisation admin | Billing, users, sites, source connections, reports |
| Energy manager | Configure assets/assumptions, view and export operations reports |
| Operator | View daily alerts and acknowledge incidents; cannot alter billing or users |
| Finance / sustainability viewer | Read reports and exports only |
| Aetheon analyst | Restricted support access, time-bound and audited |
| Aetheon regulatory reviewer | Approve content, no customer billing access |

Use tenant isolation at every query boundary; enforce least privilege and log exports, downloads, configuration changes, and administrator access.

---

## 5. Reliability, security, and governance

### Service levels to publish only when achievable

- Dashboard availability target, excluding planned maintenance.
- Daily forecast publication cut-off by product and state.
- Maximum accepted data delay for “Active” status.
- Alert-delivery target, measured from validated source-data receipt.
- Support response target for platform defects—not operational decision response.

### Minimum controls before paid launch

- Encryption in transit and at rest; secret vault for customer credentials.
- Tenant isolation, MFA for Aetheon admins, secure password policy, and session expiry.
- Backup and restoration testing for data and configuration.
- Audit log retention policy.
- Vulnerability scanning, dependency updates, and incident-response runbook.
- Document retention/deletion policy and customer data-export process.
- Model/data-change approval process, with rollback capability.
- Status page and automated internal alerts for ingestion, forecast, and delivery failures.

### Required legal/product text

- Terms of service, subscription/cancellation policy, privacy notice, and data-processing terms.
- Definition of each service's inputs, output frequency, plan limits, and supported states.
- Decision-support, no-guarantee, no-trading, no-dispatch, no-legal-advice, and data-latency disclaimers.
- Clear allocation of responsibility: the customer remains responsible for regulatory filings, market decisions, schedules, plant operation, and verification.

---

## 6. Website and checkout structure

### Pricing page layout

1. Headline: **Forecast cost. See risk. Act with confidence.**
2. Plan cards: Grid Intelligence, Compliance Sentinel, DSM Risk Monitor, BESS Arbitrage Signals, Renewable Portfolio Monitor.
3. “What you receive” and “What this does not do” on every product page.
4. Supported states and data requirements.
5. Sample anonymised report and methodology page.
6. Checkout CTA: **Start subscription**; enterprise CTA: **Request a portfolio plan**.

### Checkout fields

- Legal entity and billing contact.
- GSTIN and billing address where required for invoicing.
- Chosen product, state, number of sites, plan tier, and add-ons.
- Primary system administrator and operations report recipient.
- Consent to terms, privacy notice, and decision-support disclaimer.

### Activation email sequence

| Event | Automated message |
|---|---|
| Payment confirmed | Receipt, subscription summary, onboarding link |
| Site created | Required-data checklist and activation criteria |
| Data source connected | Confirmation, freshness SLA, first forecast/report timing |
| Data validation failed | Exact remediation steps and secure upload path |
| Product activated | Dashboard link, report schedule, support knowledge base |
| Renewal / payment failure | Transparent billing state and self-service recovery link |

---

## 7. Metrics and operating cadence

### Commercial metrics

- Trial-to-paid conversion.
- Activation rate within 7 days.
- Monthly recurring revenue, revenue per site, expansion rate, churn, and failed-payment recovery.
- Product attach rate: Grid Intelligence customers adding DSM, BESS, or portfolio monitoring.

### Product-quality metrics

- Data freshness and completeness by tenant/source.
- Forecast accuracy by state/load class and confidence band.
- Alert precision, acknowledgement rate, and alert fatigue rate.
- Report-delivery success rate and time-to-publication.
- Percentage of outputs with traceable input, source, model, and tariff versions.

### Monthly product review

1. Review data incidents, late outputs, and invalid recommendations.
2. Compare product claims to observed output quality.
3. Review state/tariff source changes and approvals.
4. Retire noisy alerts and tighten quality gates.
5. Publish customer-facing release notes for material changes.

---

## 8. Delivery roadmap

### Phase 1 — sellable foundation (6–8 weeks)

- Grid Intelligence dashboard with one supported state, manual CSV/bill upload, daily report generation, Stripe/Razorpay-equivalent checkout, tenant access, and clear data-status signals.
- One anonymised sample report, help centre, and cancellation/billing portal.
- No real-time control, no autonomous schedule changes, no multi-state compliance claims.

### Phase 2 — recurring intelligence (8–12 weeks)

- Secure recurring data ingestion, forecast-quality monitoring, configurable alerts, compliance knowledge base, and monthly report automation.
- Add Compliance Sentinel for the same supported state.
- Add integrations only after a repeatable onboarding/data-validation process exists.

### Phase 3 — operational products (12+ weeks)

- DSM Risk Monitor and BESS Arbitrage Signals with strict data freshness, constraints, audit log, and human-in-the-loop controls.
- Renewable Portfolio Monitor with reconciled generation/load data.
- Portfolio, API, and enterprise-role add-ons.

---

## 9. Launch decision checklist

A product may be marked **available for paid subscription** only when all are true:

- [ ] Its supported state(s), tariff assumptions, and data sources are named publicly.
- [ ] The onboarding wizard validates all mandatory configuration.
- [ ] A data-quality gate suppresses misleading outputs.
- [ ] Every report shows its data timestamp, model/version, and disclaimer.
- [ ] Payment, invoicing, cancellation, and entitlement changes work end-to-end.
- [ ] A customer can download/export their own reports and close their subscription without human intervention.
- [ ] Error states have understandable self-service remediation.
- [ ] Source-data, model, recommendation, and notification events are auditable.
- [ ] The product makes no claim that requires human consulting, legal advice, or real-time operational control to fulfil.

## 10. First product recommendation

Launch **Aetheon Grid Intelligence — Monitor** first. It proves the essential system: paid access, tenant onboarding, data intake, forecast/report generation, quality disclosure, and recurring delivery. It also creates the data/configuration base from which DSM, BESS, and renewable monitoring can be offered as credible upgrades.

The initial commercial objective is not an all-in-one EMS. It is a reliable, self-serve daily decision product that customers can buy, configure, understand, and renew without needing a consulting call.
