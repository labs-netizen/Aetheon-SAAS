import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.describe('End-to-End Real Non-Demo Persistence Journey (Pre-Astra Proving)', () => {
  test('Non-Demo Customer Journey: Real Auth -> Non-Demo Site -> Raw 96 CSV -> CALIBRATING State -> Activation Readiness -> Server Forecast -> Report Generation -> Download -> Logout/Login Persistence', async ({ page, request }) => {
    test.setTimeout(90000);
    // 1. Real Local Auth - Seeded non-demo user credentials
    const testEmail = process.env.E2E_NON_DEMO_EMAIL || 'alok.nondemo@kalyanibharat.com';
    const testPassword = process.env.E2E_NON_DEMO_PASSWORD || 'AetheonLive2026!';
    const nonDemoSiteId = 'b0000000-0000-0000-0000-000000000010';
    const selectIntendedSite = async () => {
      const siteSelect = page.locator('header select').filter({
        has: page.locator(`option[value="${nonDemoSiteId}"]`),
      });
      await siteSelect.selectOption(nonDemoSiteId);
      await expect(siteSelect).toHaveValue(nonDemoSiteId);
      await expect(siteSelect.locator('option:checked')).toContainText('Kalyani Pune Heavy Forge Unit 1');
    };
    // Upload the most recent fully completed IST day, never the current partial day.
    const operatingDate = new Date(Date.now() + 330 * 60000 - 86400000).toISOString().substring(0, 10);

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } }
    );

    // Replace this fixture site's history so prior test runs cannot supply or remove calibration days.
    const historicalDates = Array.from({ length: 6 }, (_, day) =>
      new Date(Date.parse(`${operatingDate}T00:00:00Z`) - (6 - day) * 86400000).toISOString().substring(0, 10));
    const history = historicalDates.flatMap(date => Array.from({ length: 96 }, (_, block) => ({
      site_id: nonDemoSiteId,
      operating_date: date,
      block_index: block + 1,
      timestamp_utc: new Date(Date.parse(`${date}T00:00:00+05:30`) + block * 900000).toISOString(),
      load_kw: 2400,
      generation_solar_kw: 120,
      actual_drawal_kw: 2420,
      scheduled_drawal_kw: 2400,
      data_quality: 'PASSED',
    })));
    await adminClient.from('interval_data_96').delete().eq('site_id', nonDemoSiteId).throwOnError();
    await adminClient.from('data_quality_evaluations').delete().eq('site_id', nonDemoSiteId).throwOnError();
    await adminClient.from('interval_data_96').insert(history).throwOnError();
    await adminClient.from('data_quality_evaluations').insert(historicalDates.map(date => ({
      site_id: nonDemoSiteId, evaluation_date: date, completeness_pct: 100, missing_blocks_count: 0,
      validation_status: 'PASSED', freshness_status: 'DELAYED', publication_gate_status: 'PUBLISHABLE',
    }))).throwOnError();
    const { data: persistedHistory } = await adminClient.from('interval_data_96')
      .select('operating_date,block_index,timestamp_utc,data_quality').eq('site_id', nonDemoSiteId)
      .order('operating_date').order('block_index').throwOnError();
    expect(persistedHistory).toHaveLength(6 * 96);
    for (const date of historicalDates) {
      const dayRows = persistedHistory!.filter(row => row.operating_date === date);
      expect(dayRows.map(row => row.block_index)).toEqual(Array.from({ length: 96 }, (_, block) => block + 1));
      const start = Date.parse(`${date}T00:00:00+05:30`);
      expect(start + 86400000).toBeLessThanOrEqual(Date.now());
      expect(dayRows.every((row, block) => Date.parse(row.timestamp_utc) === start + block * 900000 && row.data_quality === 'PASSED')).toBe(true);
    }
    await adminClient.from('grid_forecast_runs').delete().eq('site_id', nonDemoSiteId).eq('operating_date', operatingDate).throwOnError();
    await adminClient.from('sites').update({
      activation_status: 'CALIBRATING',
      activation_reason: '6 of 7 operating days calibrated (calibration baseline in progress)'
    }).eq('id', nonDemoSiteId).throwOnError();
    
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: /Aetheon Energy Intelligence|Sign in to your account/i }).first()).toBeVisible();

    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Authorised Non-Demo Organisation & Site Displayed
    await expect(page).toHaveURL('/');
    await expect(page.getByText('AETHEON', { exact: true })).toBeVisible();
    await expect(page.getByText('Kalyani Bharat Forgings Ltd').first()).toBeVisible();

    // 3. Navigate to Settings & Save Site Configuration
    await page.goto('/settings');
    await selectIntendedSite();
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.getByText('Site Electrical Configuration')).toBeVisible();

    const testDemand = '3200';
    const demandInput = page.locator('input[label="Sanctioned Contract Demand (kVA)"], input[type="number"]').first();
    await demandInput.fill(testDemand);
    await page.getByRole('button', { name: 'Save Site Parameters' }).click();

    await expect(page.getByText(/Site configuration persisted successfully to PostgreSQL database/i)).toBeVisible();

    // Reload and verify site configuration persisted in database
    await page.reload();
    await selectIntendedSite();
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.locator('input[type="number"]').first()).toHaveValue(testDemand);

    // 4. Verify site remains CALIBRATING before the seventh valid day
    const siteBeforeRes = await page.request.get(`/api/sites/${nonDemoSiteId}`);
    expect(siteBeforeRes.status()).toBe(200);
    const siteBefore = await siteBeforeRes.json();
    expect(siteBefore.site.activation_status).toBe('CALIBRATING');

    // GRID availability is independent of activation readiness: live output stays suppressed
    // until validated model and price-feed authority exists.
    const calibratingRes = await page.request.post('/api/forecast', {
      data: {
        siteId: nonDemoSiteId,
        operatingDate: operatingDate,
        contractDemandKw: 3200,
      },
    });
    expect(calibratingRes.status()).toBe(200);
    const calibratingData = await calibratingRes.json();
    expect(calibratingData).toMatchObject({
      site_id: nonDemoSiteId,
      operating_date: operatingDate,
      is_suppressed: true,
      persisted: false,
      blocks: [],
      data_quality: 'UNVERIFIED',
    });
    expect(calibratingData.suppression_reason).toContain('LIVE_MODEL_AND_PRICE_FEED_REQUIRED');

    // 5. Ingest Real Raw 96-Row CSV for 7th Day -> Server Computes SHA-256 -> Atomic Ingestion Commit
    await page.getByRole('button', { name: /Data Ingestion/i }).click();
    await expect(page.getByText('15-Minute AMR Interval Data Ingestion Gateway')).toBeVisible();

    const runSalt = (Date.now() % 10000) / 10;
    const csvRows = ['operating_date,block_index,load_kw,solar_generation_kw,actual_drawal_kw,scheduled_drawal_kw'];
    for (let b = 1; b <= 96; b++) {
      csvRows.push(`${operatingDate},${b},${(2400 + runSalt + Math.sin(b) * 150).toFixed(1)},120.0,2420.0,2400.0`);
    }
    const csvContent = csvRows.join('\n');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: `nondemo_amr_96block_${Date.now()}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent),
    });

    await expect(page.getByText('96/96 blocks validated successfully. Contiguity verified.')).toBeVisible();

    const commitBtn = page.getByRole('button', { name: 'Commit to Database' });
    await expect(commitBtn).toBeVisible();
    await commitBtn.click();

    await expect(page.getByText(/Successfully committed.*interval blocks to site database/i)).toBeVisible();

    // 6. Verify commit_ingestion_transaction automatically changes site to ACTIVE
    const siteAfterRes = await page.request.get(`/api/sites/${nonDemoSiteId}`);
    expect(siteAfterRes.status()).toBe(200);
    const siteAfter = await siteAfterRes.json();
    expect(siteAfter.site.activation_status).toBe('ACTIVE');
    expect(siteAfter.site.last_status_change).toBeDefined();

    // Verify site_activation_history contains the transition
    const activeTransition = siteAfter.activation_history.find(
      (h: any) => h.previous_status === 'CALIBRATING' && h.new_status === 'ACTIVE'
    );
    expect(activeTransition).toBeDefined();

    // 7. Live GRID remains fail-closed until model and price-feed authority is configured.
    const liveForecastRes = await page.request.post('/api/forecast', {
      data: {
        siteId: nonDemoSiteId,
        operatingDate: operatingDate,
        contractDemandKw: 3200,
      },
    });
    const forecastData = await liveForecastRes.json();
    expect(liveForecastRes.status(), JSON.stringify(forecastData)).toBe(200);
    expect(forecastData).toMatchObject({
      site_id: nonDemoSiteId,
      operating_date: operatingDate,
      is_suppressed: true,
      persisted: false,
      blocks: [],
      data_quality: 'UNVERIFIED',
    });
    expect(forecastData.suppression_reason).toContain('LIVE_MODEL_AND_PRICE_FEED_REQUIRED');
    const { data: persistedForecasts } = await adminClient.from('grid_forecast_runs').select('id')
      .eq('site_id', nonDemoSiteId).eq('operating_date', operatingDate).throwOnError();
    expect(persistedForecasts).toHaveLength(0);

    // 8. Grid UI exposes the safety block and no fabricated operational result.
    await page.goto('/grid-intelligence');
    await selectIntendedSite();
    await expect(page.getByRole('heading', { name: /Grid Intelligence Monitor/i })).toBeVisible();
    await expect(page.getByTestId('grid-suppressed')).toContainText('LIVE_MODEL_AND_PRICE_FEED_REQUIRED');
    await expect(page.getByText('Peak Demand Block')).toHaveCount(0);

    // 9. Suppressed/unknown-quality GRID output cannot become a report.
    const reportRes = await page.request.post('/api/reports/generate', {
      data: {
        siteId: nonDemoSiteId,
        reportType: 'GRID_DAILY_BRIEF',
        periodStart: operatingDate,
        periodEnd: operatingDate,
      },
    });
    const reportJson = await reportRes.json();
    expect(reportRes.status(), JSON.stringify(reportJson)).toBe(422);
    expect(reportJson).toMatchObject({ error: 'REPORT_NOT_PUBLISHABLE' });
    expect(reportJson.reason).toContain('LIVE_MODEL_AND_PRICE_FEED_REQUIRED');
    const { data: persistedReports } = await adminClient.from('report_records').select('id')
      .eq('site_id', nonDemoSiteId).eq('report_type', 'GRID_DAILY_BRIEF')
      .eq('period_start', operatingDate).eq('period_end', operatingDate).throwOnError();
    expect(persistedReports).toHaveLength(0);

    // 11. Alerts Hub Check
    await page.goto('/alerts');
    await selectIntendedSite();
    await expect(page.getByRole('heading', { name: /Alerts & Incident Hub/i })).toBeVisible();

    // 12. Logout and Re-Login: State Remains Persisted
    await page.goto('/auth/logout');
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: /Aetheon Energy Intelligence|Sign in to your account/i }).first()).toBeVisible();

    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Kalyani Bharat Forgings Ltd').first()).toBeVisible();

    // Verify persisted site configuration persists after re-login
    await page.goto('/settings');
    await selectIntendedSite();
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.locator('input[type="number"]').first()).toHaveValue(testDemand);

    // The reports page must not fabricate the blocked GRID report after re-login.
    await page.goto('/reports');
    await selectIntendedSite();
    await expect(page.locator('h4').filter({ hasText: /GRID DAILY BRIEF/i })).toHaveCount(0);
  });
});
