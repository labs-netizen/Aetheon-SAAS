import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/auth/login', request.url), { status: 302 });
}

export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/auth/login', request.url), { status: 302 });
}
