import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.describe('End-to-End Real Non-Demo Persistence Journey (Pre-Astra Proving)', () => {
  test('Non-Demo Customer Journey: Real Auth -> Non-Demo Site -> Raw 96 CSV -> CALIBRATING State -> Activation Readiness -> Server Forecast -> Report Generation -> Download -> Logout/Login Persistence', async ({ page, request }) => {
    test.setTimeout(90000);
    // 1. Real Local Auth - Seeded non-demo user credentials
    const testEmail = process.env.E2E_NON_DEMO_EMAIL || 'alok.nondemo@kalyanibharat.com';
    const testPassword = process.env.E2E_NON_DEMO_PASSWORD || 'AetheonLive2026!';
    const nonDemoSiteId = 'b0000000-0000-0000-0000-000000000010';
    const todayDate = new Date().toISOString().substring(0, 10);

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } }
    );

    // Deterministic state: site has 6 historical days and remains CALIBRATING before 7th day
    await adminClient.from('interval_data_96').delete().eq('site_id', nonDemoSiteId).eq('operating_date', todayDate);
    await adminClient.from('data_quality_evaluations').delete().eq('site_id', nonDemoSiteId).eq('evaluation_date', todayDate);
    await adminClient.from('grid_forecast_runs').delete().eq('site_id', nonDemoSiteId).eq('operating_date', todayDate);
    await adminClient.from('sites').update({
      activation_status: 'CALIBRATING',
      activation_reason: '6 of 7 operating days calibrated (calibration baseline in progress)'
    }).eq('id', nonDemoSiteId);
    
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
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.getByText('Site Electrical Configuration')).toBeVisible();

    const testDemand = '3200';
    const demandInput = page.locator('input[label="Sanctioned Contract Demand (kVA)"], input[type="number"]').first();
    await demandInput.fill(testDemand);
    await page.getByRole('button', { name: 'Save Site Parameters' }).click();

    await expect(page.getByText(/Site configuration persisted successfully to PostgreSQL database/i)).toBeVisible();

    // Reload and verify site configuration persisted in database
    await page.reload();
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.locator('input[type="number"]').first()).toHaveValue(testDemand);

    // 4. Verify site remains CALIBRATING before the seventh valid day
    const siteBeforeRes = await page.request.get(`/api/sites/${nonDemoSiteId}`);
    expect(siteBeforeRes.status()).toBe(200);
    const siteBefore = await siteBeforeRes.json();
    expect(siteBefore.site.activation_status).toBe('CALIBRATING');

    // Live site forecast must suppress with CALIBRATING requirement before 7th day
    const calibratingRes = await page.request.post('/api/forecast', {
      data: {
        siteId: nonDemoSiteId,
        operatingDate: todayDate,
        contractDemandKw: 3200,
      },
    });
    expect(calibratingRes.status()).toBe(200);
    const calibratingData = await calibratingRes.json();
    expect(calibratingData.is_suppressed).toBe(true);
    expect(calibratingData.suppression_reason).toContain('CALIBRATING');

    // 5. Ingest Real Raw 96-Row CSV for 7th Day -> Server Computes SHA-256 -> Atomic Ingestion Commit
    await page.getByRole('button', { name: /Data Ingestion/i }).click();
    await expect(page.getByText('15-Minute AMR Interval Data Ingestion Gateway')).toBeVisible();

    const runSalt = (Date.now() % 10000) / 10;
    const csvRows = ['operating_date,block_index,load_kw,solar_generation_kw,actual_drawal_kw,scheduled_drawal_kw'];
    for (let b = 1; b <= 96; b++) {
      csvRows.push(`${todayDate},${b},${(2400 + runSalt + Math.sin(b) * 150).toFixed(1)},120.0,2420.0,2400.0`);
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

    // 7. Server-Authoritative Forecast Path -> Persisted Run
    const liveForecastRes = await page.request.post('/api/forecast', {
      data: {
        siteId: nonDemoSiteId,
        operatingDate: todayDate,
        contractDemandKw: 3200,
      },
    });
    expect(liveForecastRes.status()).toBe(200);
    const forecastData = await liveForecastRes.json();
    expect(forecastData.persisted).toBe(true);
    expect(forecastData.run_id).toBeDefined();
    expect(Boolean(forecastData.is_suppressed)).toBe(false);
    expect(forecastData.blocks.length).toBe(96);
    expect(forecastData.average_price_inr_per_mwh).toBeGreaterThan(0);

    // 8. Grid Intelligence Monitor UI Displays Backend Forecast Result
    await page.goto('/grid-intelligence');
    await expect(page.getByRole('heading', { name: /Grid Intelligence Monitor/i })).toBeVisible();
    await expect(page.getByText('Peak Demand Block')).toBeVisible();

    // 9. Report Generated & Persisted
    const reportRes = await page.request.post('/api/reports/generate', {
      data: {
        siteId: nonDemoSiteId,
        reportType: 'GRID_DAILY_BRIEF',
        periodStart: todayDate,
        periodEnd: todayDate,
      },
    });
    expect(reportRes.status()).toBe(200);
    const reportJson = await reportRes.json();
    expect(reportJson.success).toBe(true);
    expect(reportJson.reportId).toBeDefined();
    expect(reportJson.downloadUrl).toBe(`/api/reports/${reportJson.reportId}/download`);

    // 10. Download Persisted Report via Canonical Route
    const downloadRes = await page.request.get(reportJson.downloadUrl);
    expect(downloadRes.status()).toBe(200);
    expect(downloadRes.headers()['content-type']).toContain('text/csv');
    const downloadedText = await downloadRes.text();
    expect(downloadedText).toContain('# AETHEON ENERGY INTELLIGENCE REPORT');
    expect(downloadedText).toContain('GRID_DAILY_BRIEF');
    expect(downloadedText).not.toContain('metric_key,value,unit');

    // 11. Alerts Hub Check
    await page.goto('/alerts');
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
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.locator('input[type="number"]').first()).toHaveValue(testDemand);

    // Verify generated report persists on reports page
    await page.goto('/reports');
    await expect(page.locator('h4').filter({ hasText: /GRID DAILY BRIEF/i }).first()).toBeVisible();
  });
});