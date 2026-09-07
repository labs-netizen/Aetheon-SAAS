/**
 * Webhook Cryptographic Verification & Replay Protection
 * Implements HMAC-SHA256 signature verification with timing-safe comparison,
 * timestamp skew validation, and idempotency tracking.
 */

import crypto from 'crypto';

// In-memory cache of processed webhook event IDs for replay defense
const PROCESSED_WEBHOOK_EVENTS = new Map<string, number>();

// Maximum permitted timestamp skew: 300 seconds (5 minutes)
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

/**
 * Verify Razorpay HMAC-SHA256 signature
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  if (!rawBody || !signature || !secret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch {
    return false;
  }
}

/**
 * Check if a webhook event ID has already been processed or violates timestamp window
 */
export function isWebhookReplay(eventId: string, timestampSeconds?: number): boolean {
  if (!eventId) {
    return true;
  }

  // 1. Check timestamp drift if provided
  if (timestampSeconds) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const skew = Math.abs(nowSeconds - timestampSeconds);
    if (skew > MAX_TIMESTAMP_SKEW_SECONDS) {
      return true; // Skewed or expired event
    }
  }

  // 2. Check deduplication cache
  return PROCESSED_WEBHOOK_EVENTS.has(eventId);
}

/**
 * Record a webhook event ID as processed
 */
export function recordProcessedWebhook(eventId: string): void {
  if (eventId) {
    PROCESSED_WEBHOOK_EVENTS.set(eventId, Date.now());

    // Prune entries older than 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, time] of PROCESSED_WEBHOOK_EVENTS.entries()) {
      if (time < cutoff) {
        PROCESSED_WEBHOOK_EVENTS.delete(id);
      }
    }
  }
}
