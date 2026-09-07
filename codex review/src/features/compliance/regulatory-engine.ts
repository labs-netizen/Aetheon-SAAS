/**
 * Regulatory Governance Engine - Six-Stage Approval Pipeline
 * Enforces canonical regulatory lifecycle states:
 * CAPTURED -> EXTRACTED -> CHANGE_DETECTED -> REVIEW_PENDING -> APPROVED -> PUBLISHED -> SUPERSEDED
 * Strictly prevents unreviewed draft items from reaching customer-facing calculations or dashboards.
 */

export type RegulatoryState =
  | 'CAPTURED'
  | 'EXTRACTED'
  | 'CHANGE_DETECTED'
  | 'REVIEW_PENDING'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'SUPERSEDED';

export interface RegulatorySourceItem {
  id: string;
  jurisdiction: 'CERC' | 'SERC' | 'MERC' | 'GERC' | 'UPERC' | 'CEA' | 'FOR';
  state?: string;
  discom?: string;
  documentTitle: string;
  sourceUrl?: string;
  documentDate: string;
  effectiveDate: string;
  expiryDate?: string;
  version: string;
  checksumSha256?: string;
  status: RegulatoryState;
  approvedBy?: string;
  approvedAt?: string;
  reviewerNotes?: string;
  isDemo?: boolean;
}

export interface ComplianceObligation {
  id: string;
  siteId: string;
  obligationName: string;
  category: 'DISCOM_FILING' | 'SLDC_STATUTORY' | 'CAPTIVE_VERIFICATION' | 'BANKING_RECONCILIATION';
  deadline: string;
  responsibleOwner: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'COMPLETED' | 'OVERDUE';
  evidenceDocUrl?: string;
  lastUpdated: string;
}

/**
 * Valid state transitions for regulatory lifecycle
 */
const VALID_TRANSITIONS: Record<RegulatoryState, RegulatoryState[]> = {
  CAPTURED: ['EXTRACTED', 'SUPERSEDED'],
  EXTRACTED: ['CHANGE_DETECTED', 'REVIEW_PENDING', 'SUPERSEDED'],
  CHANGE_DETECTED: ['REVIEW_PENDING', 'SUPERSEDED'],
  REVIEW_PENDING: ['APPROVED', 'EXTRACTED', 'SUPERSEDED'],
  APPROVED: ['PUBLISHED', 'SUPERSEDED'],
  PUBLISHED: ['SUPERSEDED'],
  SUPERSEDED: [],
};

/**
 * Validate if a state transition is legal in the regulatory pipeline
 */
export function canTransitionRegulatoryState(
  currentState: RegulatoryState,
  targetState: RegulatoryState,
  userRole?: string
): { allowed: boolean; reason?: string } {
  const allowedNext = VALID_TRANSITIONS[currentState] || [];
  if (!allowedNext.includes(targetState)) {
    return {
      allowed: false,
      reason: `Illegal state transition from ${currentState} to ${targetState}.`,
    };
  }

  // Only AETHEON_REGULATORY_REVIEWER can move to APPROVED or PUBLISHED
  if ((targetState === 'APPROVED' || targetState === 'PUBLISHED') && userRole !== 'AETHEON_REGULATORY_REVIEWER') {
    return {
      allowed: false,
      reason: 'Dual-signoff restriction: Only AETHEON_REGULATORY_REVIEWER can approve or publish regulatory rules.',
    };
  }

  return { allowed: true };
}

/**
 * Customer Publication Quality Gate:
 * Returns TRUE only if the item has passed formal review and is in PUBLISHED status.
 * Any draft state (e.g. REVIEW_PENDING or CHANGE_DETECTED) is strictly hidden from customers.
 */
export function isPublishedToCustomer(status: RegulatoryState): boolean {
  return status === 'PUBLISHED';
}

/**
 * Filter regulatory source items for customer-facing consumption.
 * Customer sessions must never receive unapproved or review-pending items.
 */
export function filterCustomerFacingRegulatorySources(items: RegulatorySourceItem[]): RegulatorySourceItem[] {
  return items.filter((item) => isPublishedToCustomer(item.status));
}
