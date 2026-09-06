# AETHEON ENERGY INTELLIGENCE PLATFORM
# ANTIGRAVITY MASTER IMPLEMENTATION DIRECTIVE

You are the primary implementation engineering team responsible for constructing the first major production-oriented foundation of the Aetheon Energy Intelligence Platform.

This is not merely a planning exercise.

You are expected to inspect the repository, design the implementation, create the files, install appropriate dependencies, implement the application, run it, test it, browser-test important workflows where possible, fix your own errors, document your decisions, and leave a clean and highly usable repository for a later specialist engineering/audit phase.

You are working inside the dedicated repository:

`aetheon-saas`

The existing corporate website is a DIFFERENT repository and is outside the scope of this task.

The marketing website will remain at:

`https://aetheonlabs.in`

The SaaS application will eventually operate at:

`https://app.aetheonlabs.in`

Never modify, move, import, overwrite, or otherwise interfere with the existing marketing website.

---

# PART 0 — AUTHORITATIVE PRODUCT SPECIFICATION

Before doing anything substantial, locate and read:

`docs/PRODUCT_SPECIFICATION.md`

Read the ENTIRE document.

Treat it as the authoritative product and operating specification.

Its requirements regarding:

- product positioning;
- pricing;
- customer journey;
- site model;
- onboarding;
- data readiness;
- activation status;
- data ingestion;
- data quality;
- Grid Intelligence;
- Open Access Compliance;
- DSM;
- BESS;
- Renewable Portfolio monitoring;
- roles;
- safety boundaries;
- regulatory governance;
- billing;
- subscription behaviour;
- reporting;
- auditability;
- reliability;
- launch criteria;

take precedence over casual implementation assumptions.

Do not silently contradict the product specification.

If an engineering decision needs interpretation, choose the safest and simplest interpretation compatible with the product specification and record the decision in:

`docs/DECISIONS.md`

---

# PART 1 — PRODUCT MISSION

Build the first major implementation of:

# Aetheon Energy Intelligence Platform

Target market:

Indian commercial and industrial electricity consumers.

Core positioning:

Algorithmic decision support for:

- power procurement;
- Open Access;
- DSM exposure;
- battery storage arbitrage;
- renewable portfolio performance.

The platform sells standardized recurring digital outputs.

It is NOT a bespoke consulting system.

It is NOT an autonomous trading system.

It is NOT a plant-control system.

It is NOT a legal-advice system.

It does NOT automatically:

- place exchange bids;
- modify SLDC schedules;
- submit statutory filings;
- dispatch customer equipment;
- control BMS;
- control SCADA;
- guarantee financial savings;
- guarantee arbitrage returns;
- provide legal opinions.

Encode these boundaries throughout the UX and data model.

---

# PART 2 — ANTIGRAVITY'S ROLE

Your responsibility is to implement as much of the platform as safely and efficiently possible BEFORE a later specialist review by another advanced engineering model.

Think of your role as:

## BUILD

not merely:

## PLAN

Your implementation should ideally cover roughly the first 60–70% of repository engineering effort.

You own:

- project bootstrap;
- repository structure;
- application shell;
- UI system;
- routing;
- customer portal;
- administrator portal;
- authentication integration;
- organisations;
- sites;
- users;
- roles;
- onboarding;
- activation-state infrastructure;
- database schema;
- first-pass RLS;
- product catalogue;
- subscription data model;
- first-pass entitlement plumbing;
- billing provider abstraction;
- first-pass Razorpay adapter;
- data-source architecture;
- CSV/XLSX upload;
- ingestion tracking;
- data-quality infrastructure;
- module user interfaces;
- module database models;
- module API contracts;
- deterministic demo data;
- common reports;
- common alerts;
- notification preferences;
- common audit events;
- settings;
- help centre;
- empty/error/loading states;
- initial tests;
- CI;
- developer documentation;
- handoff documentation.

Later specialist engineering will deeply review:

- tenant security;
- final RLS correctness;
- authorization attack resistance;
- payment security;
- entitlement security;
- advanced forecasting;
- DSM regulatory correctness;
- BESS mathematical optimisation;
- regulatory publication safeguards;
- tamper-evident logging;
- production security;
- final quality-gate logic.

You should nevertheless implement sensible first-pass versions/interfaces/tests for these areas so the later engineer is improving working code rather than beginning from zero.

---

# PART 3 — WORKING STYLE

Work autonomously.

Do NOT repeatedly ask the user ordinary software-development questions.

You are authorized to:

- inspect repository files;
- create directories;
- create files;
- initialize Git if appropriate;
- initialize Next.js;
- install packages;
- initialize TypeScript;
- initialize Tailwind;
- create Supabase migrations;
- create local scripts;
- create Python service;
- create tests;
- execute tests;
- execute builds;
- execute lint;
- execute typechecking;
- browser-test the app;
- refactor code you created;
- fix build failures;
- fix test failures;
- remove dead code;
- improve documentation.

Do NOT stop after creating a plan.

Do NOT respond merely with snippets that the user must manually copy into files.

Make the changes in the repository yourself.

---

# PART 4 — MULTI-AGENT EXECUTION

If Antigravity multi-agent / Teamwork / subagent functionality is available, use it intelligently.

Parallelize only workstreams that have low merge-conflict risk.

Good candidates for parallel agents:

### Agent A — Frontend design system

- layout;
- typography;
- reusable cards;
- tables;
- charts;
- forms;
- loaders;
- empty states.

### Agent B — Customer portal

- dashboard;
- onboarding;
- settings;
- subscriptions UI.

### Agent C — Module UI

- Grid;
- DSM;
- Compliance;
- Renewables;
- BESS.

### Agent D — Testing

- unit-test setup;
- component tests;
- Playwright;
- test fixtures.

### Agent E — Documentation

- README;
- architecture documentation;
- environment setup;
- module documentation.

### Agent F — Demo data

- deterministic fixtures;
- demo organisation;
- demo site;
- sample interval datasets.

DO NOT let multiple agents independently redesign:

- central database schema;
- authorization;
- entitlement model;
- tenant model;
- billing model;
- core naming conventions.

One coordinating agent must own those.

Resolve all merge conflicts before claiming completion.

---

# PART 5 — TECHNOLOGY STACK

Use a modern, maintainable stack optimized for rapid SaaS development.

Unless a compelling repository constraint exists, use:

## Main application

Next.js

React

TypeScript

Next.js App Router

Tailwind CSS

Use current stable mutually compatible releases.

Enable strict TypeScript.

---

# PART 6 — UI COMPONENT SYSTEM

Use a mature accessible component system rather than hand-building every primitive.

Prefer a lightweight system such as shadcn/ui or an equivalent accessible component approach.

Do not introduce a massive proprietary design framework.

Create reusable components rather than duplicating markup.

Components should include:

- Button
- Input
- Textarea
- Select
- MultiSelect if required
- Checkbox
- RadioGroup
- Switch
- Dialog
- Sheet
- Popover
- Tooltip
- Tabs
- Card
- DataTable
- Badge
- Alert
- Breadcrumb
- Dropdown
- Date selector
- Time selector
- Skeleton
- EmptyState
- ErrorState
- LoadingState
- ConfirmationDialog

---

# PART 7 — DATABASE / AUTH / STORAGE

Preferred managed foundation:

Supabase.

Use:

PostgreSQL

Supabase Auth

Supabase Storage

Row Level Security

Supabase migrations

Do not hardcode backend credentials into browser code.

Create browser-safe and server-only client helpers separately.

---

# PART 8 — ANALYTICS SERVICE FOUNDATION

Create:

`services/analytics`

Use:

Python 3

FastAPI

Pydantic

pandas

NumPy

SciPy where justified

scikit-learn only where useful

Do NOT make sophisticated production modelling the focus of this Antigravity phase.

Instead implement:

- clean service structure;
- strongly typed request schemas;
- strongly typed response schemas;
- health endpoint;
- deterministic demo algorithms;
- service authentication interface;
- tests;
- Docker support.

Create interfaces/endpoints that later sophisticated implementations can replace without changing the main web application.

---

# PART 9 — TARGET REPOSITORY STRUCTURE

Aim for:

aetheon-saas/
│
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   ├── (portal)/
│   │   ├── admin/
│   │   └── api/
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── charts/
│   │   ├── tables/
│   │   └── shared/
│   │
│   ├── features/
│   │   ├── authentication/
│   │   ├── organisations/
│   │   ├── sites/
│   │   ├── onboarding/
│   │   ├── billing/
│   │   ├── entitlements/
│   │   ├── ingestion/
│   │   ├── quality/
│   │   ├── alerts/
│   │   ├── notifications/
│   │   ├── reports/
│   │   └── audit/
│   │
│   ├── modules/
│   │   ├── grid-intelligence/
│   │   ├── compliance/
│   │   ├── dsm/
│   │   ├── renewable-portfolio/
│   │   └── bess/
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   ├── auth/
│   │   ├── validation/
│   │   ├── billing/
│   │   ├── units/
│   │   ├── dates/
│   │   └── constants/
│   │
│   ├── server/
│   ├── providers/
│   ├── jobs/
│   ├── hooks/
│   ├── types/
│   └── styles/
│
├── services/
│   └── analytics/
│
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── config.toml
│
├── scripts/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── demo-data/
│
├── docs/
│   ├── PRODUCT_SPECIFICATION.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── IMPLEMENTATION_STATUS.md
│   ├── HANDOFF_TO_ASTRA.md
│   ├── DEPLOYMENT.md
│   ├── SECURITY.md
│   ├── DATA_SOURCES.md
│   ├── MODULES.md
│   └── DECISIONS.md
│
├── public/
├── .github/workflows/
├── .env.example
├── README.md
├── package.json
└── other required configuration

Improve this structure where clearly beneficial.

Do not overengineer it.

---

# PART 10 — ARCHITECTURE STYLE

Use a modular monolith for the Next.js application.

Do NOT create five separate applications.

Do NOT create five separate databases.

Do NOT create unnecessary microservices.

Do NOT introduce Kubernetes.

Do NOT introduce Kafka.

Do NOT introduce complex event sourcing.

Do NOT introduce an elaborate service mesh.

A separate Python analytics service is acceptable because numerical modelling and optimisation naturally fit Python.

Keep everything else simple.

---

# PART 11 — CUSTOMER/TENANT MODEL

Core hierarchy:

Organisation
→ Sites
→ Users
→ Module subscriptions
→ Data sources
→ Outputs

A site represents one metering/scheduling boundary.

One organisation may have multiple sites.

One user may access one or more permitted sites.

Every customer-owned record must be tenant-scoped.

---

# PART 12 — USER ROLES

Implement role definitions aligned with PRODUCT_SPECIFICATION.md.

Required customer/internal roles:

ORGANISATION_ADMIN

ENERGY_MANAGER

OPERATOR

FINANCE_SUSTAINABILITY_VIEWER

AETHEON_ANALYST

AETHEON_REGULATORY_REVIEWER

Optionally define a very narrowly controlled platform administration role if technically necessary.

Permissions:

## Organisation Admin

Can manage:

- organisation;
- billing;
- users;
- sites;
- data-source connections;
- reports;
- subscriptions.

## Energy Manager

Can:

- view operational modules;
- configure permitted assets;
- configure assumptions;
- import operational data;
- view/export reports.

## Operator

Can:

- view alerts;
- view daily operations;
- acknowledge incidents.

Cannot manage:

- billing;
- users;
- commercial subscriptions.

## Finance/Sustainability Viewer

Read-only access to appropriate:

- financial reports;
- renewable reports;
- sustainability exports.

## Aetheon Analyst

Restricted support access.

Must be architected for:

- time-bounded access;
- auditability;
- least privilege.

## Aetheon Regulatory Reviewer

Can:

- review regulatory content;
- approve regulatory interpretations.

Must not automatically receive customer billing privileges.

---

# PART 13 — FIRST-PASS RLS

Implement sensible first-pass Supabase Row Level Security.

Do not leave customer tables globally readable.

At minimum ensure:

Organisation A users cannot intentionally query Organisation B through normal application paths.

Site access is membership-sensitive.

Storage objects are private by default.

Admin/internal access is explicit.

IMPORTANT:

Create:

`docs/HANDOFF_TO_ASTRA.md`

and list all RLS policies there under:

`REQUIRES SPECIALIST SECURITY AUDIT`

Do NOT label your RLS implementation as production-security-certified.

---

# PART 14 — AUTHENTICATION

Implement:

Sign in

Sign up

Email verification state

Forgot password

Reset password

Logout

Protected routes

Organisation invitation UI

Invitation acceptance

Session-aware application shell.

Handle:

unauthenticated

authenticated-without-organisation

authenticated-with-organisation

states cleanly.

---

# PART 15 — CUSTOMER ONBOARDING

Implement onboarding as a real workflow.

Customer journey should support:

1. account creation;
2. organisation setup;
3. subscription/plan context;
4. site creation;
5. site operational configuration;
6. data-source/readiness setup;
7. validation;
8. activation-state visibility.

---

# PART 16 — SITE SETUP FIELDS

Include appropriate fields such as:

Site name

State

DISCOM

Voltage category

Contract demand

Contract-demand unit

Metering/scheduling boundary

Load class

Industry/category if useful

Operational timezone

Configured assets

Report recipients

Do not make every module-specific field mandatory during basic site setup.

---

# PART 17 — OPERATIONAL ACTIVATION STATE MACHINE

Implement states:

CONFIGURED

AWAITING_DATA

CALIBRATING

ACTIVE

DEGRADED

Build this as actual application/domain state.

Not merely text badges.

Store transition timestamps/reasons where appropriate.

Display the current state visibly.

---

# PART 18 — ACTIVATION LOGIC

Commercial subscription and operational activation are two different things.

A customer can be:

Subscription = ACTIVE

while:

Monitoring status = AWAITING_DATA

Payment must NOT automatically imply operational monitoring is active.

Examples:

Payment confirmed
→ subscription entitlement active.

Site created
→ CONFIGURED.

Required input missing
→ AWAITING_DATA.

Inputs received but calibration incomplete
→ CALIBRATING.

Requirements satisfied
→ ACTIVE.

Previously healthy source becomes stale
→ DEGRADED.

---

# PART 19 — DATA READINESS

Create a module-aware readiness system.

Each requirement should support:

REQUIRED

RECOMMENDED

OPTIONAL.

Show:

requirement

status

data source

validation outcome

remediation.

Grid example:

State/DISCOM
Required.

Contract demand
Required.

Voltage category
Required.

Tariff/latest bill
Required.

Historical interval load
Recommended.

OA configuration
Optional.

Solar configuration
Optional.

BESS configuration
Optional.

Alert recipient
Required.

---

# PART 20 — DATA INGESTION ARCHITECTURE

Implement the hierarchy:

1. API / secure vendor integration abstraction;
2. secure SFTP abstraction;
3. structured CSV/XLSX upload;
4. designated mailbox abstraction;
5. monthly bill upload.

For this implementation phase, fully implement the portal-side CSV/XLSX workflow.

Other modes may initially be provider interfaces/configuration screens rather than real integrations if credentials/vendors are unavailable.

---

# PART 21 — DATA PROVIDER INTERFACES

Create replaceable provider contracts such as:

MarketDataProvider

MeterDataProvider

EMSDataProvider

SFTPDataProvider

WeatherDataProvider

RegulatoryDataProvider

InboundMailboxProvider.

Core business logic must not depend directly on one vendor.

---

# PART 22 — CSV/XLSX IMPORT

Build a serious import flow.

Features:

Upload

Template download

Supported-format explanation

File-size validation

Header validation

Column mapping

Timestamp validation

Block-number validation

Numeric validation

Unit validation

Duplicate detection

Preview

Validation summary

Accepted-row count

Rejected-row count

Row-level error information

Import confirmation

Import result.

Support appropriate datasets such as:

interval load

meter readings

actual energy

scheduled energy

renewable generation

market-price demonstration data.

---

# PART 23 — IMPORT IDEMPOTENCY

Avoid accidental duplicate imports.

Use:

source identifier

file checksum

site

data type

timestamp/block

appropriate uniqueness constraints.

Track:

uploaded by

uploaded at

filename

checksum

source

ingestion run

validation result.

---

# PART 24 — DATA QUALITY FRAMEWORK

Create a common Data Quality object/service.

Each important output should be capable of reporting:

Last successful data timestamp

Source

Completeness %

Validation state

Freshness state

Model version

Model generation timestamp

Applicable state

Tariff version

Regulatory source date where relevant.

Validation states:

PASSED

WARNING

FAILED

STALE.

Freshness statuses:

RECENT

DELAYED

STALE

UNKNOWN

DEMO.

---

# PART 25 — DATA QUALITY UI

Build reusable components:

DataQualityBadge

FreshnessBadge

CompletenessIndicator

DataSourceIndicator

ModelVersionIndicator

TariffVersionIndicator

LastUpdatedIndicator.

They should be reusable across every module.

---

# PART 26 — QUALITY GATE FIRST-PASS IMPLEMENTATION

Implement a centralized quality-gate interface/service.

Possible result:

PUBLISHABLE

PUBLISHABLE_WITH_WARNING

BLOCKED_STALE_DATA

BLOCKED_MISSING_INPUT

BLOCKED_INVALID_CONFIGURATION

BLOCKED_LOW_CONFIDENCE

BLOCKED_UNAPPROVED_CONTENT.

Do not bury quality decisions inside individual page components.

IMPORTANT:

Implement reasonable first-pass rules.

Mark this subsystem in HANDOFF_TO_ASTRA.md as requiring specialist review before commercial production.

---

# PART 27 — STALE DATA BEHAVIOUR

If critical operational data is stale:

Do not continue displaying an old recommendation as if it were current.

Replace actionable recommendation areas with:

`Insufficient current data`

or equivalent.

Show:

affected source

last valid timestamp

reason

recommended remediation.

---

# PART 28 — UNIT SYSTEM

Create reusable unit handling.

Support:

kW

MW

kWh

MWh

₹/kWh

₹/MWh

percentage

tCO2e

SOC %.

Do not display naked ambiguous numbers.

Avoid accidental kWh/MWh or ₹/kWh/₹/MWh confusion.

---

# PART 29 — TIME MODEL

Default user-facing timezone:

Asia/Kolkata.

Use timezone-safe canonical timestamps internally.

Create reusable utilities for Indian 15-minute electricity blocks.

Each operating day:

96 blocks.

Implement mapping between:

operating date

block 1–96

start time

end time

canonical timestamp.

Add tests.

---

# PART 30 — PRODUCT CATALOGUE

Seed:

GRID_INTELLIGENCE

OA_COMPLIANCE

DSM_RISK

BESS_ARBITRAGE

RENEWABLE_PORTFOLIO.

Base prices:

Grid Intelligence
₹19,900/site/month.

Open Access Compliance Sentinel
₹14,900/state/site/month.

DSM Risk Monitor
₹29,900/site/month.

BESS Arbitrage Signals
₹49,900/site/month.

Renewable Portfolio Monitor
₹24,900/site/month.

Store currency in integer paise.

---

# PART 31 — PLANS / ADD-ONS

Architect flexible plan configuration.

Examples derived from product specification include:

Grid:
Monitor
Optimise
Portfolio add-on.

Compliance:
Sentinel
Multi-state
Policy Intelligence add-on.

BESS:
Signal plan
Fleet add-on
Advanced optimisation.

Renewables:
base plan
multi-site
multi-asset
ESG export.

Do not invent missing commercial prices.

Allow admin configuration.

---

# PART 32 — SUBSCRIPTION MODEL

Implement:

products

plans

subscriptions

subscription_items

entitlements

site allocation

state allocation

billing period

start date

renewal date

cancellation state

provider reference

manual grant support.

Possible subscription states:

PENDING

ACTIVE

PAST_DUE

SUSPENDED

CANCELLED

EXPIRED.

---

# PART 33 — ENTITLEMENT FIRST PASS

Create a centralized entitlement service.

Never scatter subscription logic randomly.

Conceptual API:

`getEntitlement(user, organisation, site, product)`

UI should use entitlement results.

Backend routes should independently enforce them.

Implement first-pass enforcement.

Flag for Astra security audit.

---

# PART 34 — BILLING PROVIDER ABSTRACTION

Create:

BillingProvider interface.

Possible methods:

createCustomer

createCheckout

createSubscription

cancelSubscription

getSubscription

getInvoiceHistory

handleWebhook.

Implement Razorpay-oriented adapter architecture.

If no production credentials:

do not fail the entire app.

Provide development/demo billing adapter.

---

# PART 35 — BILLING UX

Create:

Plans page

Subscription management

Billing status

Invoice/payment history placeholder with real schema

Cancellation workflow

Payment failure state

Recovery action.

Checkout requirements should be capable of capturing:

Legal entity

Billing contact

GSTIN

Billing address

Product

State

Number of sites

Plan

Add-ons

Primary administrator

Operations report recipient

Terms acceptance

Privacy acceptance

Decision-support disclaimer acceptance.

Store consent version/timestamp where practical.

---

# PART 36 — PAYMENT SECURITY BOUNDARY

Do not trust browser-reported payment success.

Implement server-side webhook structure and signature-verification interface.

If test credentials exist, implement real test-mode flow.

Otherwise use explicitly labelled development mode.

Flag webhook/idempotency/security implementation for Astra review.

---

# PART 37 — APPLICATION DESIGN

Visual tone:

Professional

Technical

Industrial

Financially credible

Energy-market oriented.

Avoid:

consumer-style gamification

cartoonish illustrations

excessive animation

glowing AI gradients everywhere

unnecessary 3D

overly playful icons.

Aim for a professional analytics SaaS used by:

energy managers

plant operations teams

CFO/finance users

sustainability managers

battery owners

EPC professionals.

---

# PART 38 — MAIN APP SHELL

Create responsive authenticated application layout.

Include:

Sidebar

Header

Organisation context

Site selector

Global data-health indicator

Notifications

User/profile menu.

Navigation:

Dashboard

Grid Intelligence

Open Access

DSM

BESS

Renewables

Alerts

Reports

Settings.

Aetheon internal users additionally receive Admin navigation according to role.

---

# PART 39 — DASHBOARD HOME

Build an informative home dashboard showing:

Organisation name

Selected site

Operational activation state

Data freshness

Data completeness

Subscribed products

Locked products

Recent alerts

Latest reports

Upcoming compliance events

Latest Grid brief

Data-source health.

---

# PART 40 — LOCKED MODULES

If a user lacks entitlement:

Do not reveal restricted operational data.

Show:

module explanation

scope

starting price where appropriate

data requirements

subscription status

upgrade/request action.

Backend still enforces restrictions.

---

# PART 41 — GRID INTELLIGENCE UI

Build Grid Intelligence as the most complete product UI.

Routes/features:

Overview

96-block Forecast

Cost Explorer

Opportunities

Alerts

Reports.

---

# PART 42 — GRID OVERVIEW

Display:

Tomorrow average forecast

Highest-cost block/window

Lowest-cost block/window

Peak demand forecast

Forecast confidence

Expected baseline cost

Scenario cost where configured

Estimated avoided-cost range

Data freshness

Model version

Tariff version.

Clearly label DEMO data.

---

# PART 43 — 96-BLOCK FORECAST UI

Create:

interactive line/chart

96-row table

date control

tooltips

block number

start/end time

forecast demand

forecast price

actual price when available

confidence/interval

data source

model version.

Ensure charts are readable.

---

# PART 44 — GRID DEMO ANALYTICS

Implement deterministic demo computations in Python or TypeScript as appropriate.

Demo output must contain 96 valid blocks.

Use deterministic seeds.

Do NOT claim production predictive accuracy.

Label model:

DEMO_BASELINE

or equivalent.

Create API contract allowing Astra later to replace the forecasting implementation.

---

# PART 45 — COST EXPLORER

Build UI supporting:

Grid baseline

OA scenario

Solar contribution

BESS contribution

Configured sourcing mix.

Only show resources configured for the site.

Show:

expected demand

expected unit cost

estimated total cost

scenario difference

estimated avoided cost

assumptions.

---

# PART 46 — GRID REPORTS

Create:

Daily Grid Brief view

Weekly summary view

Monthly Performance Report view.

Daily brief should include:

96-block outlook

top high-cost windows

confidence

scenario comparison

assumptions

freshness

model generation time.

Support:

print layout

CSV

PDF-ready architecture.

---

# PART 47 — GRID ALERT UI

Create first-pass configurable alerts for:

high-cost window

forecast confidence

tariff spike

data freshness.

Allow:

severity

threshold configuration

recipient selection

enable/disable.

---

# PART 48 — OPEN ACCESS COMPLIANCE UI

Create:

Compliance Overview

Rule Changes

Compliance Calendar

Charges

Eligibility

Evidence Register

Reports.

---

# PART 49 — REGULATORY SOURCE DATABASE

Implement schema/UI for:

Publisher

Jurisdiction

State

DISCOM where relevant

Document title

Source URL

Document date

Retrieval date

Effective date

Expiry/superseded date

Source file

Version

Checksum

Reviewer status.

---

# PART 50 — REGULATORY WORKFLOW

Implement workflow state:

CAPTURED

EXTRACTED

REVIEW_PENDING

APPROVED

PUBLISHED

SUPERSEDED.

Customer-facing material interpretation cannot come from REVIEW_PENDING.

Create reviewer UI.

Do not populate real production regulations from casual web search.

Demo fixtures must say DEMO / UNVERIFIED.

---

# PART 51 — COMPLIANCE BOARD

Create fields:

Obligation

Site

State

Owner

Deadline

Status

Evidence

Source

Change history.

Statuses may include:

NOT_STARTED

IN_PROGRESS

DONE

OVERDUE

NOT_APPLICABLE.

---

# PART 52 — CHARGE TRACKER

Create configurable structure capable of representing:

Wheeling

Transmission

Cross-subsidy surcharge

Additional surcharge

Banking

Scheduling-related assumptions.

Every value should support:

unit

effective period

source

version

approval state.

---

# PART 53 — COMPLIANCE DISCLAIMERS

Display:

source date

source reference

review state where appropriate

`Not legal advice`.

Do not claim automated legal interpretation.

---

# PART 54 — DSM RISK MONITOR UI

Routes:

Operations Board

Deviation History

Incidents/Alerts

Reports

Configuration.

Display 96-block operational table.

Possible risk levels:

NORMAL

WATCH

HIGH

CRITICAL.

---

# PART 55 — DSM DATA MODEL

Support:

scheduled value

actual value

deviation

deviation %

applicable rule version

risk level

source freshness

root-cause tag.

Root-cause tags can include:

LOAD_VARIANCE

RENEWABLE_FORECAST_ERROR

ASSET_OUTAGE

SCHEDULE_DATA_GAP

UNKNOWN.

---

# PART 56 — DSM FIRST-PASS CALCULATION

Implement transparent deterministic baseline deviation calculations.

Do NOT invent authoritative regulatory charges.

DSM monetary-exposure computation must be demo/configuration-driven unless a verified rule source exists.

Create clean rule-engine interface for Astra.

If schedule/meter data is missing:

do not manufacture a compliance result.

---

# PART 57 — DSM INCIDENT UX

Group adjacent affected blocks into incidents.

Show:

time range

severity

affected blocks

magnitude

data freshness

cause

acknowledgement.

Implement:

acknowledge action

incident status

quiet hours settings

recipient settings.

---

# PART 58 — BESS ASSET UI

Create battery CRUD.

Configuration:

Name

Site

Usable capacity

Power rating

Minimum SOC

Maximum SOC

Initial SOC

Charge efficiency

Discharge efficiency

Round-trip efficiency

Degradation-cost assumption

Availability

Maintenance lock

Export/interconnection restrictions.

Validate ranges.

---

# PART 59 — BESS SIGNAL UI

Create:

Forecast price chart

Charge windows

Discharge windows

SOC trajectory

Gross value

Loss estimate

Degradation estimate

Net-value range

Confidence

Assumptions

Invalidating conditions.

---

# PART 60 — BESS DEMO SOLVER

Implement a safe deterministic reference/demo solver sufficient to exercise the UI and data contracts.

It must:

respect simple power limit

respect usable energy limit

respect min/max SOC

respect initial SOC

apply efficiency

avoid obvious simultaneous charge/discharge.

It is NOT to be considered commercially validated.

Label it accordingly.

Create extensive input/output tests for obvious physical constraints.

Record in HANDOFF_TO_ASTRA.md:

`BESS OPTIMISER REQUIRES SPECIALIST MATHEMATICAL REVIEW/REPLACEMENT`.

---

# PART 61 — BESS SAFETY UX

If:

SOC unknown

data stale

maintenance lock active

configuration invalid

then suppress active signal.

Display why.

No BMS control.

No SCADA control.

No autonomous dispatch.

---

# PART 62 — RENEWABLE ASSET UI

Create renewable asset CRUD.

Initial focus:

Solar.

Fields:

name

site

technology

installed capacity

commissioning date

availability

status.

Schema should permit future technologies.

---

# PART 63 — RENEWABLE DASHBOARD

Show:

Expected generation

Actual generation

Generation variance

Site load

Grid import

Renewable share

Self consumption

Estimated savings

Avoided emissions

Data confidence.

Clearly distinguish:

MEASURED

MODELLED

ESTIMATED.

---

# PART 64 — CARBON MODEL

Create versionable emission factor schema:

value

unit

source

effective date

expiry

jurisdiction

approval state.

Demo factor must be marked DEMO if not verified.

Never label avoided emissions as verified carbon credits.

---

# PART 65 — REC/RPO / ATTRIBUTE TRACKER

Build ledger-style UI/schema supporting:

obligation

generation

acquisition

certificate identifier

retirement/use

evidence

period

balance.

Do not fabricate official compliance.

---

# PART 66 — COMMON ALERT ENGINE

Create reusable alert schema/service.

Alert should include:

organisation

site

module

type

severity

title

description

triggered timestamp

affected blocks/time

source

quality state

acknowledged state

resolved state.

Severity:

INFO

WARNING

HIGH

CRITICAL.

---

# PART 67 — ALERT DEDUPLICATION

Create first-pass:

fingerprint

deduplication

cooldown

adjacent-block grouping.

Avoid dozens of repetitive alerts.

---

# PART 68 — NOTIFICATION PREFERENCES

Create settings for:

Email

In-app

Severity threshold

Module

Quiet hours.

Architect extension points for future:

WhatsApp

SMS

Webhook/API.

Do not implement those unless straightforward and credentials are provided.

---

# PART 69 — COMMON REPORT SYSTEM

Create report records with:

organisation

site

module

report type

period

status

generated at

generated by

quality state

data snapshot metadata

model version

tariff/rule version

storage location.

Build polished browser/print report templates.

Implement CSV export.

Implement PDF export if reliable with chosen stack.

---

# PART 70 — REPORT PROVENANCE

Report output should have places for:

Data timestamp

Completeness

Source

Model version

Tariff version

Rule version

Generation timestamp

Assumptions

Disclaimer.

Do not build reports that lose the provenance of their calculations.

---

# PART 71 — EMAIL TEMPLATE SYSTEM

Create templates/events for:

Payment confirmed

Site created

Data source connected

Validation failed

Product activated

Payment failure

Report available

Important alert.

Development environment may log emails instead of sending them.

---

# PART 72 — ADMIN CONSOLE

Create protected `/admin` area.

Include:

Organisations

Users

Sites

Subscriptions

Entitlements

Product catalogue

Data-source health

Ingestion runs

Reports

Alerts

Regulatory sources

Regulatory approval queue

Tariffs

DSM rules

Emission factors

Model registry

Audit log

Support access.

---

# PART 73 — MODEL REGISTRY UI/DATA

Create foundational model registry.

Fields:

model name

module

version

status

description

created timestamp

input/schema version

metrics metadata

notes.

No need for sophisticated MLOps platform.

---

# PART 74 — AUDIT LOG

Create common audit-event data structure.

Record meaningful events such as:

organisation created

site created

user invited

role changed

subscription changed

entitlement changed

data imported

data source configured

report generated

report downloaded

alert acknowledged

regulatory content approved

admin access

configuration changed.

Do not include secrets.

---

# PART 75 — HELP CENTRE

Create lightweight in-app help structure.

Articles/categories:

Getting started

Creating a site

Understanding activation status

Uploading interval data

Understanding data quality

Grid forecasts

DSM alerts

BESS signals

Renewable reporting

Compliance sources

Reports

Billing

Cancellation

Security and privacy.

Static markdown/content is acceptable for V1.

---

# PART 76 — PRODUCT/LEGAL INFORMATION SURFACES

Create draft/template pages for:

Terms of Service

Privacy Notice

Subscription/Cancellation Policy

Data Processing Terms

Decision Support Disclaimer.

Clearly label:

`Requires professional legal review before commercial launch`

where appropriate.

Do NOT claim legal approval.

---

# PART 77 — DEMO MODE

Demo mode is mandatory.

Create deterministic demonstration data.

Demo organisation:

`Aetheon Demo Industries Pvt Ltd`

or another obviously fictitious name.

Demo site:

`Demo Manufacturing Site`

or similarly obvious.

Seed:

Users/roles

Subscriptions

Site configuration

96-block loads

96-block prices

Grid forecasts

Tariff

Alerts

Reports

DSM schedule/actual

Battery

BESS signals

Renewable generation

Compliance sources

Data-quality states.

---

# PART 78 — DEMO LABEL

When demonstration data is being used, show a prominent:

DEMO DATA

indicator.

Never silently fall back to demonstration data in production mode.

---

# PART 79 — EMPTY STATES

Every main page should have proper empty states.

Examples:

No site configured

No interval data

No battery configured

No renewable asset

No compliance records

No subscription

No reports

No alerts.

Each should provide an appropriate action.

---

# PART 80 — ERROR STATES

Create useful errors.

Avoid blank screens.

Examples:

Upload rejected

Data stale

Subscription unavailable

Permission denied

Unknown site

Invalid configuration

Analytics service unavailable

Payment provider unavailable.

---

# PART 81 — LOADING STATES

Use skeletons/spinners appropriately.

Avoid abrupt page flashes.

Dashboard pages should gracefully handle data loading.

---

# PART 82 — RESPONSIVENESS

Prioritize desktop/laptop.

Nevertheless support:

desktop

tablet

mobile.

Tables should horizontally scroll or transform appropriately.

Sidebar should collapse sensibly.

---

# PART 83 — ACCESSIBILITY

Implement:

Semantic HTML

Keyboard navigation

Form labels

Focus states

Accessible dialogs

Contrast

ARIA only where useful

Accessible tables.

---

# PART 84 — CHARTS

Use a stable charting library.

Create shared chart wrappers.

Support:

Line charts

Area charts

Bar charts

96-block time series

Baseline vs scenario

Expected vs actual

SOC trajectory.

Avoid unnecessarily fancy animations.

---

# PART 85 — DATABASE MIGRATIONS

All schema changes should be represented by migration files.

Do not rely on manually clicking around a remote database.

Create coherent migration ordering.

---

# PART 86 — SEED DATA

Create repeatable seed process.

Seeds must be safe to rerun or clearly documented.

Never mix demo records with production customer data.

---

# PART 87 — VALIDATION

Use Zod in TypeScript boundaries where appropriate.

Use Pydantic in Python.

Validate:

UUIDs

Dates

Times

Email

Units

Energy values

Power values

Prices

SOC

Efficiencies

Upload rows

Subscription fields.

---

# PART 88 — API CONTRACTS

Prefer typed, understandable API contracts.

Avoid random API styles.

Document important boundaries.

Create consistent response pattern for:

data

errors

metadata

quality status.

---

# PART 89 — ANALYTICS SERVICE ENDPOINTS

Create first-pass endpoints/contracts such as:

`/health`

`/v1/grid/forecast`

`/v1/grid/scenario`

`/v1/dsm/deviation`

`/v1/bess/optimise-demo`

`/v1/renewables/reconcile`.

Names may differ if your architecture is better.

Authenticate internal service calls.

---

# PART 90 — JOB FOUNDATION

Create job abstractions for:

Ingestion

Validation

Forecasting

Quality evaluation

Alerts

Reports

Email.

Local development should be able to trigger jobs manually.

Do not create complex distributed queue architecture merely for appearance.

---

# PART 91 — OBSERVABILITY FOUNDATION

Implement structured logging.

Create interfaces/configuration points for later:

Error reporting

Metrics

Tracing.

Log failures such as:

Ingestion failure

Analytics failure

Report failure

Email failure

Billing webhook failure.

Never log secrets.

---

# PART 92 — SECURITY BASELINE

Implement standard security hygiene:

Server-side validation

Safe database access

No secret in frontend

Private storage

Signed access where practical

Secure cookie/session patterns

Secure headers

Webhook verification interface

Rate limiting abstraction for sensitive operations

Upload validation.

Then document all security-sensitive areas for Astra review.

---

# PART 93 — TESTING TOOLING

Set up:

Vitest or equivalent

React Testing Library

Playwright

pytest.

Tests must actually run.

---

# PART 94 — UNIT TESTS

Create meaningful tests for:

Currency calculations

Unit conversion

96-block generation

Timestamp/block mapping

Activation state machine

Data freshness classification

Readiness calculation

Entitlement helpers

CSV validation

Duplicate import detection

Basic alert grouping

Grid demo forecast schema

DSM deviation arithmetic

BESS demo feasibility

Renewable reconciliation.

---

# PART 95 — INTEGRATION TESTS

Where practical test:

Supabase/query helpers

Organisation/site isolation in normal application paths

Auth guards

Subscription guards

Import processing

Report creation.

---

# PART 96 — E2E TESTS

Create Playwright smoke flows:

Login/demo login

Dashboard loads

Site selector works

Grid page works

Locked module works

CSV import path works

Report view works

Alert acknowledgement works

Settings page works

Admin denied to normal customer.

---

# PART 97 — SECURITY TEST DOCUMENT

Create:

`docs/SECURITY.md`

Include:

Implemented protections

Known limitations

Areas requiring Astra review

Areas requiring external penetration testing before paid launch.

Do not falsely claim a penetration test occurred.

---

# PART 98 — CONTINUOUS INTEGRATION

Create GitHub Actions workflow.

Run:

Node install

Lint

Typecheck

Unit tests

Python setup

pytest

Production Next.js build.

Run Playwright where reliably supportable.

---

# PART 99 — CODE QUALITY

Use:

Strict TypeScript

Clear names

Small reusable functions

No giant multi-thousand-line components

No duplicated product logic

No mysterious constants

No dead commented-out code

No placeholder TODO explosion.

Where unfinished specialist logic is intentional, use structured tags such as:

`SPECIALIST_REVIEW_REQUIRED`

with documentation.

---

# PART 100 — DOCUMENTATION

Create/update:

## README.md

Explain:

what the project is

prerequisites

installation

environment

database

Supabase

analytics service

demo mode

tests

build

common troubleshooting.

## docs/ARCHITECTURE.md

Explain system architecture.

## docs/DATA_MODEL.md

Explain major database entities.

## docs/MODULES.md

Explain each product.

## docs/DATA_SOURCES.md

Explain provider architecture.

## docs/SECURITY.md

Explain security approach.

## docs/DEPLOYMENT.md

Explain eventual deployment.

## docs/DECISIONS.md

Record important engineering decisions.

## docs/IMPLEMENTATION_STATUS.md

Maintain a feature matrix.

## docs/HANDOFF_TO_ASTRA.md

This is extremely important.

---

# PART 101 — HANDOFF_TO_ASTRA.MD

Create a serious handoff document.

Organize it:

# Repository state

# Architecture summary

# What Antigravity implemented

# What is fully working

# What is demo-only

# What is partially implemented

# What requires specialist review

# Security-sensitive areas

# Database/RLS review areas

# Billing review areas

# Entitlement review areas

# Grid forecast review areas

# DSM review areas

# Compliance/regulatory review areas

# BESS optimisation review areas

# Quality-gate review areas

# Audit-log review areas

# Production integrations missing

# Failing tests, if any

# Recommended Astra execution order.

Be specific.

Mention exact file paths.

Do not write vague notes such as:

`security needs review`.

Instead write things like:

`supabase/migrations/xxxx_rls.sql — organisation access policies implemented but cross-tenant attack suite requires specialist audit.`

---

# PART 102 — IMPLEMENTATION STATUS MATRIX

Create a table in IMPLEMENTATION_STATUS.md.

Columns:

Area

Status

Implemented

Demo/Production

Tests

Specialist review required

Notes.

Statuses:

COMPLETE

FUNCTIONAL

PARTIAL

SCAFFOLDED

NOT_STARTED.

---

# PART 103 — SPECIALIST REVIEW MARKERS

Specifically flag the following for Astra even if you implemented first-pass versions:

1. RLS / cross-tenant security.

2. Privilege escalation.

3. Entitlement bypass resistance.

4. Razorpay webhook verification/idempotency.

5. Production secret handling.

6. Regulatory publication/approval logic.

7. DSM state-rule calculations.

8. Forecast validity and model design.

9. BESS optimisation mathematics.

10. Quality-gate thresholds.

11. Tamper-evident event architecture.

12. Production threat modelling.

Do not force Astra to discover these from scratch.

---

# PART 104 — DO NOT OVERSTEP INTO FALSE PRODUCTION CLAIMS

Never describe demo functionality as:

Production validated

Commercially accurate

Regulator approved

Legally reviewed

Security certified

Financially guaranteed.

Use precise labels.

---

# PART 105 — WHAT ANTIGRAVITY SHOULD NOT SPEND TIME ON

Do NOT spend excessive time on:

Perfect machine-learning accuracy

Scraping every Indian regulation

Building proprietary electricity-market connectors without credentials

Complex BESS co-optimisation

Kubernetes

Microservices

Fancy marketing animation

Custom auth protocols

Blockchain

Native mobile apps

SCADA integration

BMS control

Automated trading

Automated scheduling.

Those are outside this implementation phase.

---

# PART 106 — GIT

If repository Git is available:

Commit logical checkpoints.

Suggested:

`foundation`

`database-auth`

`onboarding-data-gateway`

`customer-portal`

`module-interfaces`

`admin-reports`

`demo-tests`

`antigravity-handoff`.

Do not rewrite unrelated existing history.

---

# PART 107 — EXECUTION ORDER

Execute in this exact general order.

## PHASE 1
Repository inspection and specification reading.

## PHASE 2
Architecture and project bootstrap.

## PHASE 3
Design system.

## PHASE 4
Database migrations/schema.

## PHASE 5
Authentication and tenant foundation.

## PHASE 6
Organisation/site management.

## PHASE 7
Onboarding and activation states.

## PHASE 8
Data readiness.

## PHASE 9
Data Gateway and CSV/XLSX import.

## PHASE 10
Data quality/freshness.

## PHASE 11
Product catalogue and subscription model.

## PHASE 12
Billing adapter and entitlement first pass.

## PHASE 13
Customer application shell.

## PHASE 14
Grid Intelligence UI and deterministic demo backend.

## PHASE 15
Compliance database/workflows/UI.

## PHASE 16
DSM database/workflows/UI/demo calculations.

## PHASE 17
Renewable module.

## PHASE 18
BESS module and safe demo solver.

## PHASE 19
Alerts and notifications.

## PHASE 20
Reports.

## PHASE 21
Admin console.

## PHASE 22
Help/legal template surfaces.

## PHASE 23
Demo-data completion.

## PHASE 24
Automated tests.

## PHASE 25
Browser/E2E validation.

## PHASE 26
CI.

## PHASE 27
Documentation.

## PHASE 28
Repository cleanup.

## PHASE 29
Full verification.

## PHASE 30
Handoff to Astra.

Do not ask the user to prompt you between phases.

Continue automatically.

---

# PART 108 — VALIDATION AFTER EACH PHASE

After significant phases:

Run relevant tests.

Run typechecking.

Run lint where useful.

Open relevant pages.

Fix failures before continuing.

Do not leave all testing until the end.

---

# PART 109 — BROWSER VALIDATION

Use browser/testing capabilities where available.

Actually inspect:

Login

Dashboard

Site setup

Data upload

Grid forecast

Compliance page

DSM board

BESS page

Renewables page

Reports

Settings

Admin.

Look for:

broken layouts

runtime errors

unusable tables

missing states

navigation failures.

Fix them.

---

# PART 110 — FINAL REPOSITORY CLEANUP

Before handoff:

Remove unused imports

Remove unused packages

Remove abandoned experimental files

Remove duplicate components

Remove console debugging

Ensure environment files are safe

Ensure `.env` is ignored

Ensure `.env.example` exists

Ensure README matches reality

Ensure tests reflect current paths.

---

# PART 111 — FINAL VERIFICATION COMMANDS

Run as many as applicable:

npm install / appropriate package manager install

lint

TypeScript typecheck

unit tests

Python tests

production build

Playwright smoke tests.

Fix failures caused by your implementation.

Do not say a command passed if you did not run it.

---

# PART 112 — DEFINITION OF ANTIGRAVITY DONE

Antigravity's phase is complete when the repository contains a coherent, runnable platform foundation with:

- Next.js;
- TypeScript;
- professional design system;
- authentication;
- organisations;
- sites;
- roles;
- first-pass RLS;
- onboarding;
- activation states;
- data readiness;
- CSV/XLSX ingestion;
- data-quality framework;
- product catalogue;
- subscriptions;
- first-pass entitlements;
- billing adapter;
- main customer portal;
- Grid Intelligence UI/demo;
- Compliance UI/workflow;
- DSM UI/demo;
- Renewables UI/demo;
- BESS UI/demo;
- alerts;
- notifications;
- reporting;
- admin console;
- audit records;
- deterministic demo data;
- help content;
- tests;
- CI;
- documentation;
- clean Astra handoff.

It is NOT required that specialist energy algorithms or production security already be commercially validated.

---

# PART 113 — EXPECTED FINAL RESPONSE

Do NOT give a giant essay.

After completing repository work, report:

## BUILD COMPLETED

What was implemented.

## VERIFICATION

Exact tests/build commands run and results.

## DEMO INSTRUCTIONS

Exact commands to start the application.

## DEMO LOGIN

Only if intentionally created.

## EXTERNAL SERVICES STILL REQUIRED

Supabase production project

Razorpay

Email

Market-data provider

Meter/EMS integration

Weather integration if desired

Verified regulatory content

etc.

## SPECIALIST REVIEW REQUIRED

Brief list.

## HANDOFF

Point to:

`docs/HANDOFF_TO_ASTRA.md`

## NEXT STEP

State that the repository is ready for the Astra specialist engineering/review phase only if that is genuinely true.

---

# PART 114 — CRITICAL NON-NEGOTIABLE RULES

1. Never fabricate customer data.

2. Never fabricate current tariff/regulatory data as authoritative.

3. Demo data must say DEMO.

4. Never expose secrets.

5. Never put service-role credentials into browser bundles.

6. Do not make subscription UI the only authorization barrier.

7. Do not claim payment means monitoring is operationally active.

8. Do not keep recommendations active when required data is stale.

9. Do not issue automated market bids.

10. Do not issue automated scheduling submissions.

11. Do not control customer equipment.

12. Do not provide legal advice.

13. Do not guarantee savings.

14. Do not guarantee BESS revenue.

15. Do not call estimated carbon reductions verified credits.

16. Do not implement five separate SaaS applications.

17. Do not modify the existing aetheonlabs.in website.

18. Do not stop after writing a plan.

19. Do not hide failed tests.

20. Do not claim production readiness simply because the UI works.

---

# PART 115 — START EXECUTION

Proceed now.

First:

1. Inspect the repository.
2. Read `docs/PRODUCT_SPECIFICATION.md` completely.
3. Inspect existing files before overwriting anything.
4. Create `docs/ARCHITECTURE.md`.
5. Create `docs/IMPLEMENTATION_STATUS.md`.
6. Establish the project stack.
7. Begin implementation.
8. Use parallel subagents where they reduce time without risking core architectural conflicts.
9. Test continuously.
10. Fix your own errors.
11. Complete every phase reasonably possible.
12. Produce `docs/HANDOFF_TO_ASTRA.md`.
13. Run final verification.
14. Return the concise handoff summary.

This is an implementation task.

Begin working on the repository now.