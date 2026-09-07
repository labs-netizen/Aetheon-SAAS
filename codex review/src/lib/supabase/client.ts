import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock-aetheon.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key-placeholder';

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
