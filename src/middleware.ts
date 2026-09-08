import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Demo mode may be enabled ONLY by trusted server configuration.
  // Browser headers (x-demo-mode) or cookies (aetheon_demo) must NEVER bypass authentication.
  const env = process.env;
  const isDemoMode = env['NEXT_PUBLIC_DEMO_MODE'] === 'true' || env['DEMO_MODE'] === 'true';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock-aetheon.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key-placeholder';

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // In demo mode, bypass strict login gates to allow presentation & evaluation
  if (isDemoMode) {
    return response;
  }

  // Public paths
  if (
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/_next') ||
    pathname.includes('.')
  ) {
    return response;
  }

  // If unauthenticated, redirect to enterprise login
  if (!user) {
    const redirectUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
