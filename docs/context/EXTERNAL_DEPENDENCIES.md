# EXTERNAL_DEPENDENCIES.md — Production Prerequisites & Non-Local Integrations

This document catalogues genuine non-local external requirements, provider secrets, and domain specialist signoffs necessary prior to commercial multi-tenant deployment.

## 1. Third-Party Provider Credentials & Vault Configuration

| External Provider | Production Secret / Prerequisite | Scope & Purpose | Current Local State |
|---|---|---|---|
| **Razorpay** | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Live payment gateway & subscription billing. | Mock mode / test keys configured in `.env.example`. |
| **Razorpay Webhooks** | `RAZORPAY_WEBHOOK_SECRET` | Cryptographic HMAC-SHA256 signature verification. | Test secret configured for local automated tests. |
| **Supabase Auth** | Production AAL2 / MFA Provider | Mandatory multi-factor authentication for administrative roles. | `PRODUCTION_CONFIG_REQUIRED`; password/token auth local. |
| **Transactional Email** | SMTP / Resend / AWS SES Credentials | Delivery of alert incident emails and invitation tokens. | Mailpit / Inbucket local mock container (`:15434`). |
| **Cloud Storage** | Production S3 / Supabase Storage | Multi-region durable tenant storage for CSVs and PDF/CSV reports. | Local Supabase Storage container (`:15431`). |

## 2. Telemetry & Hardware Gateway Connectors

- **AMR / AMI Meter Connectors**: Production connection to Indian state DISCOM AMR portals or on-site meter gateways via DLMS/COSEM, Modbus-TCP, or automated SFTP servers.
- **Inverter & Sensor Telemetry**: Live Modbus gateway polling for on-site rooftop/ground-mount solar inverters in the Renewable Portfolio Monitor.
- **BESS BMS Telemetry**: Real-time Modbus/CAN bus integration with Battery Management Systems to read live Cell Temperatures, State of Charge (SOC), and State of Health (SOH).

## 3. Domain Specialist Signoffs & External Audits

- **Electrochemical Engineering Review**: Specialist signoff on linear battery degradation cost formulas (₹/kWh/cycle) across specific lithium chemistries (LFP vs. NMC) before commercial arbitrage signals are automated.
- **Regulatory & Legal Counsel Signoff**: Legal audit of state-specific Open Access tariff models (MERC, GERC, KERC) regarding Cross Subsidy Surcharges (CSS), Additional Surcharges (AS), and banking settlement rules.
- **Third-Party Penetration Testing**: Independent security audit verifying JWT forgery resistance, session hijacking defenses, rate limiting, and network boundary integrity.
