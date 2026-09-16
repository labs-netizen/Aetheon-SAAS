import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260916000032_site_bess_simulation_profiles.sql','utf8');
const route=readFileSync('src/app/api/bess/simulation/route.ts','utf8');
const replay=readFileSync('src/app/api/grid/replay/route.ts','utf8');
const panel=readFileSync('src/features/bess/BessSimulationPanel.tsx','utf8');

describe('Phase 3B authority and advisory boundaries',()=>{
  it('keeps profile writes service-only, RLS-scoped and role checked',()=>{
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON public.site_bess_simulation_profiles FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain("p_actor_role NOT IN ('ORGANISATION_ADMIN','ENERGY_MANAGER')");
    expect(migration).toContain('SET search_path = pg_catalog, public, pg_temp');
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE).*authenticated/i);
  });
  it('preserves live freshness and labels replay independently',()=>{
    expect(route).toContain("historicalReplay: false");
    expect(replay).toContain("historicalReplay: true");
    expect(panel).toContain('HISTORICAL BACKTEST — NOT LIVE OPERATIONAL ADVICE');
    expect(panel).toContain('NOT LANDED ELECTRICITY COST');
    expect(panel).toContain('SITE / LOAD SCALE REQUIRES VERIFICATION');
  });
  it('does not expose autonomous control or fabricate a battery default',()=>{
    expect(panel).toContain('No BMS, inverter, SCADA, bid, trade, or physical dispatch instruction');
    expect(route).not.toMatch(/nameplate_energy_capacity_kwh\s*:\s*2000|max_charge_power_kw\s*:\s*500|max_discharge_power_kw\s*:\s*500/);
  });
});
