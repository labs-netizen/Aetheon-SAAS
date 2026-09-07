import { NextRequest, NextResponse } from 'next/server';
import { fetchRenewableReconciliation } from '@/lib/analytics/client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteId, operatingDate, installedCapacityKw, measuredGenerationKwh, gridEmissionFactorTco2ePerMwh } = body;

    if (!siteId || !operatingDate || !installedCapacityKw || !measuredGenerationKwh) {
      return NextResponse.json(
        { error: 'Missing required renewable reconciliation parameters' },
        { status: 400 }
      );
    }

    try {
      const reconciliationResult = await fetchRenewableReconciliation({
        siteId,
        operatingDate,
        installedCapacityKw,
        measuredGenerationKwh,
        gridEmissionFactorTco2ePerMwh,
      });

      return NextResponse.json(reconciliationResult);
    } catch (apiErr) {
      return NextResponse.json(
        { error: 'Analytics service error', details: apiErr instanceof Error ? apiErr.message : String(apiErr) },
        { status: 502 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to reconcile renewable generation', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
