'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const empty = { flexible_load_kw: '', maximum_shift_energy_kwh_per_day: '', maximum_upward_shift_kw_per_block: '',
  maximum_downward_shift_kw_per_block: '', earliest_shift_block: '', latest_shift_block: '',
  maximum_shift_duration_blocks: '', critical_blocks: '', energy_conservation_required: '',
  minimum_operating_load_kw: '', maximum_operating_load_kw: '' };

export function FlexibilityProfileForm({ siteId }: { siteId: string }) {
  const [form, setForm] = useState<Record<keyof typeof empty, string>>(empty);
  const [feedback, setFeedback] = useState('FLEXIBILITY_PROFILE_REQUIRED');
  const [saving, setSaving] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const bearer = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('AUTHENTICATED_SESSION_REQUIRED');
    return { Authorization: `Bearer ${session.access_token}` };
  };
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/grid/flexibility-profile?site_id=${encodeURIComponent(siteId)}`, { headers: await bearer() });
        const body = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error(body.error || 'FLEXIBILITY_PROFILE_LOOKUP_FAILED');
        if (!body.configured) { setForm(empty); setFeedback('FLEXIBILITY_PROFILE_REQUIRED'); return; }
        const p = body.profile;
        setForm({ flexible_load_kw: String(p.flexible_load_kw), maximum_shift_energy_kwh_per_day: String(p.maximum_shift_energy_kwh_per_day),
          maximum_upward_shift_kw_per_block: String(p.maximum_upward_shift_kw_per_block),
          maximum_downward_shift_kw_per_block: String(p.maximum_downward_shift_kw_per_block),
          earliest_shift_block: String(p.earliest_shift_block), latest_shift_block: String(p.latest_shift_block),
          maximum_shift_duration_blocks: String(p.maximum_shift_duration_blocks), critical_blocks: p.critical_blocks.join(','),
          energy_conservation_required: String(p.energy_conservation_required),
          minimum_operating_load_kw: p.minimum_operating_load_kw === null ? '' : String(p.minimum_operating_load_kw),
          maximum_operating_load_kw: p.maximum_operating_load_kw === null ? '' : String(p.maximum_operating_load_kw) });
        setFeedback('Configured');
      } catch (error) { if (active) setFeedback(error instanceof Error ? error.message : String(error)); }
    })();
    return () => { active = false; };
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: keyof typeof empty, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setFeedback('Saving…');
    try {
      const required = ['flexible_load_kw','maximum_shift_energy_kwh_per_day','maximum_upward_shift_kw_per_block',
        'maximum_downward_shift_kw_per_block','earliest_shift_block','latest_shift_block','maximum_shift_duration_blocks'] as const;
      if (required.some((key) => !form[key].trim()) || !form.energy_conservation_required) throw new Error('ALL_EXPLICIT_FLEXIBILITY_LIMITS_REQUIRED');
      const profile = { ...Object.fromEntries(required.map((key) => [key, Number(form[key])])),
        critical_blocks: form.critical_blocks.trim() ? form.critical_blocks.split(',').map((v) => Number(v.trim())) : [],
        energy_conservation_required: form.energy_conservation_required === 'true',
        minimum_operating_load_kw: form.minimum_operating_load_kw.trim() ? Number(form.minimum_operating_load_kw) : null,
        maximum_operating_load_kw: form.maximum_operating_load_kw.trim() ? Number(form.maximum_operating_load_kw) : null };
      const response = await fetch('/api/grid/flexibility-profile', { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await bearer()) }, body: JSON.stringify({ site_id: siteId, profile }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'FLEXIBILITY_PROFILE_SAVE_FAILED');
      setFeedback('Configured and auditable. Grid recommendations will use only these explicit limits.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  const fields: Array<[keyof typeof empty, string, string]> = [
    ['flexible_load_kw','Flexible load','kW'], ['maximum_shift_energy_kwh_per_day','Maximum shifted energy/day','kWh'],
    ['maximum_upward_shift_kw_per_block','Maximum upward shift/block','kW'],
    ['maximum_downward_shift_kw_per_block','Maximum downward shift/block','kW'],
    ['earliest_shift_block','Earliest shift block','1–96'], ['latest_shift_block','Latest shift block','1–96'],
    ['maximum_shift_duration_blocks','Maximum source duration','blocks'],
    ['minimum_operating_load_kw','Minimum operating load (optional)','kW'],
    ['maximum_operating_load_kw','Maximum operating load (optional)','kW'],
  ];
  return <Card variant="default" data-testid="flexibility-profile-form"><CardHeader><div>
    <CardTitle>Site Flexibility Profile</CardTitle><CardDescription>Explicit customer constraints for advisory load shifting. No flexibility is inferred.</CardDescription>
  </div></CardHeader><form onSubmit={save} className="space-y-4 p-6 pt-0">
    <div className="grid gap-3 md:grid-cols-3">{fields.map(([key,label,unit]) => <label key={key} className="text-xs text-slate-300">{label} ({unit})
      <input type="number" min="0" step="any" value={form[key]} onChange={(e) => update(key,e.target.value)}
        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" /></label>)}</div>
    <label className="block text-xs text-slate-300">Critical/non-shiftable blocks (comma-separated 1–96)
      <input value={form.critical_blocks} onChange={(e) => update('critical_blocks',e.target.value)}
        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" /></label>
    <label className="block text-xs text-slate-300">Rebound / energy conservation requirement
      <select value={form.energy_conservation_required} onChange={(e) => update('energy_conservation_required',e.target.value)}
        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"><option value="">Select explicitly</option>
        <option value="true">Required</option><option value="false">Not contractually required (optimizer remains energy-conserving)</option></select></label>
    <div className="text-xs text-amber-200" data-testid="flexibility-profile-status">{feedback}</div>
    <div className="flex justify-end"><Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Save Flexibility Profile'}</Button></div>
  </form></Card>;
}
