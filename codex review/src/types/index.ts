/**
 * Aetheon Energy Intelligence Platform - Core Domain Types
 */

// 1. Exact Platform Roles
export type PlatformRole =
  | 'ORGANISATION_ADMIN'
  | 'ENERGY_MANAGER'
  | 'OPERATOR'
  | 'FINANCE_SUSTAINABILITY_VIEWER'
  | 'AETHEON_ANALYST'
  | 'AETHEON_REGULATORY_REVIEWER';

// 2. Operational Activation State Machine
export type OperationalActivationStatus =
  | 'CONFIGURED'
  | 'AWAITING_DATA'
  | 'CALIBRATING'
  | 'ACTIVE'
  | 'DEGRADED';

// 3. Commercial Subscription State
export type SubscriptionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'EXPIRED';

// 4. Product Availability Lifecycle
export type ProductAvailabilityStatus =
  | 'DEVELOPMENT'
  | 'DEMO'
  | 'INTERNAL_VALIDATION'
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'RETIRED';

// 5. Data Freshness Statuses
export type FreshnessStatus =
  | 'RECENT'
  | 'DELAYED'
  | 'STALE'
  | 'UNKNOWN'
  | 'DEMO';

// 6. Data Validation States
export type ValidationStatus =
  | 'PASSED'
  | 'WARNING'
  | 'FAILED'
  | 'STALE';

// 7. Publication Quality Gate Outcomes
export type PublicationGateStatus =
  | 'PUBLISHABLE'
  | 'PUBLISHABLE_WITH_WARNING'
  | 'BLOCKED_STALE_DATA'
  | 'BLOCKED_MISSING_INPUT'
  | 'BLOCKED_INVALID_CONFIGURATION'
  | 'BLOCKED_LOW_CONFIDENCE'
  | 'BLOCKED_UNAPPROVED_CONTENT';

// 8. Regulatory Workflow States
export type RegulatoryWorkflowStatus =
  | 'CAPTURED'
  | 'EXTRACTED'
  | 'CHANGE_DETECTED/REVIEW_PENDING'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'SUPERSEDED';

// 9. Alert Severities
export type AlertSeverity =
  | 'INFO'
  | 'WARNING'
  | 'HIGH'
  | 'CRITICAL';

// 10. Renewable Data Classification
export type ValueClassification =
  | 'MEASURED'
  | 'MODELLED'
  | 'ESTIMATED';

// Core Entities
export interface Organisation {
  id: string;
  name: string;
  legal_entity_name: string;
  gstin?: string;
  billing_address?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface Site {
  id: string;
  organisation_id: string;
  name: string;
  state: string;
  discom: string;
  voltage_category: string;
  contract_demand_value: number;
  contract_demand_unit: 'kVA' | 'MVA';
  metering_point: string;
  load_class: string;
  timezone: string;
  activation_status: OperationalActivationStatus;
  activation_reason?: string;
  last_status_change: string;
  is_demo: boolean;
}

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  is_platform_admin: boolean;
  mfa_enabled: boolean;
}

export interface Membership {
  id: string;
  organisation_id: string;
  user_id: string;
  role: PlatformRole;
  is_active: boolean;
  expires_at?: string | null;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  base_price_paise: number;
  billing_interval: string;
  availability_status: ProductAvailabilityStatus;
}

export interface Entitlement {
  id: string;
  organisation_id: string;
  product_id: string;
  site_id?: string;
  state_scope?: string;
  is_active: boolean;
  valid_from: string;
  valid_until?: string | null;
}

export interface CanonicalBlock96 {
  block_index: number;
  start_time: string;
  end_time: string;
  load_kw?: number;
  forecast_demand_kw?: number;
  forecast_price_inr_per_mwh?: number;
  actual_drawal_kw?: number;
  scheduled_drawal_kw?: number;
  deviation_kw?: number;
  solar_generation_kw?: number;
  bess_action?: 'CHARGE' | 'DISCHARGE' | 'IDLE';
  bess_soc_pct?: number;
}
