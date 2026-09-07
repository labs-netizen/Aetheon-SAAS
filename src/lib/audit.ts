import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEventParams {
  organisation_id: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  actor_id?: string;
  details?: Record<string, any>;
  ip_address?: string;
}

/**
 * Canonical typed helper for writing to tamper-evident audit_logs table.
 * Adheres to unified schema: action, entity_type, entity_id, actor_id, details, organisation_id.
 * Trigger chain_audit_log computes SHA-256 hash chaining automatically.
 */
export async function recordAuditEvent(
  client: SupabaseClient,
  params: AuditEventParams
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await client
      .from('audit_logs')
      .insert({
        organisation_id: params.organisation_id,
        action: params.action,
        entity_type: params.entity_type,
        entity_id: params.entity_id || null,
        actor_id: params.actor_id || null,
        details: params.details || {},
        // Backwards compatibility columns
        event_type: params.action,
        event_payload: params.details || {},
        ip_address: params.ip_address || null,
      });

    if (error) {
      console.error('Failed to insert audit log:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Exception writing audit event:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown audit error' };
  }
}
