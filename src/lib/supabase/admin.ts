import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    if (process.env.NODE_ENV === 'test') {
      // In explicit test environment without live credentials, provide local fallback
      return createClient(
        supabaseUrl || 'http://127.0.0.1:15431',
        supabaseServiceKey || 'mock-service-key-placeholder',
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );
    }
    throw new Error(
      'CONFIGURATION_ERROR: SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are mandatory for server admin operations.'
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
