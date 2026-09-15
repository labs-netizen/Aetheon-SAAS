import { NextRequest, NextResponse } from 'next/server';
import { authorizeMarketDataAdmin } from '@/lib/auth/market-data-admin';

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDataAdmin(req);
  if (!auth.authorized) return auth.response;
  return NextResponse.json({ authorized: true, role: auth.accessRole });
}
