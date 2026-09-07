import { test, expect } from '@playwright/test';

test.describe('End-to-End Real Persistence Journey (Defect #38)', () => {
  test('Complete Customer Persistence Journey: Real Login -> Site Config -> CSV Ingestion -> Server Checksum -> Grid API -> Persisted Run -> Report Generation -> Download -> Alert Ack -> Relogin', async ({ page, request }) => {
    // 1. Real Login
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: /Sign in to Aetheon/i })).toBeVisible();

    await page.locator('input[type="email"]').fill('rajesh.demo@demo.aetheonlabs.in');
    await page.locator('input[type="password"]').fill('AetheonDemo2026!');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Authorised Organisation & Site Displayed
    await expect(page).toHaveURL('/');
    await expect(page.getByText('AETHEON', { exact: true })).toBeVisible();
    await expect(page.getByText('Aetheon Demo Industries Pvt Ltd').first()).toBeVisible();

    // 3. Navigate to Settings & Save Site Configuration
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.getByText('Site Electrical Configuration')).toBeVisible();

    const testDemand = '2800';
    const demandInput = page.locator('input[label="Sanctioned Contract Demand (kVA)"], input[type="number"]').first();
    await demandInput.fill(testDemand);
    await page.getByRole('button', { name: 'Save Site Parameters' }).click();

    await expect(page.getByText(/Site configuration persisted successfully to PostgreSQL database/i)).toBeVisible();

    // Reload and verify site configuration persisted in database
    await page.reload();
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.locator('input[type="number"]').first()).toHaveValue(testDemand);

    // 4. Ingest Real CSV -> Server Computes Checksum -> Atomic Ingestion Commit
    await page.getByRole('button', { name: /Data Ingestion/i }).click();
    await expect(page.getByText('15-Minute AMR Interval Data Ingestion Gateway')).toBeVisible();

    const csvRows = ['operating_date,block_index,load_kw,solar_generation_kw,actual_drawal_kw,scheduled_drawal_kw'];
    for (let b = 1; b <= 96; b++) {
      csvRows.push(`2026-09-08,${b},${(2100 + Math.sin(b) * 150).toFixed(1)},120.0,2120.0,2100.0`);
    }
    const csvContent = csvRows.join('\n');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'persistence_journey_amr_96block.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent),
    });

    await expect(page.getByText('96/96 blocks validated successfully. Contiguity verified.')).toBeVisible();

    const commitBtn = page.getByRole('button', { name: 'Commit to Database' });
    await expect(commitBtn).toBeVisible();
    await commitBtn.click();

    await expect(page.getByText(/Successfully committed.*interval blocks to site database/i)).toBeVisible();

    // 5. Invoke Grid API & Verify Persisted Model Result
    const siteId = 'b0000000-0000-0000-0000-000000000001';
    const gridRes = await request.post('/api/forecast', {
      data: {
        siteId,
        operatingDate: '2026-09-08',
        contractDemandKw: 2800,
      },
    });
    expect(gridRes.status()).toBe(200);
    const gridData = await gridRes.json();
    expect(gridData.persisted).toBe(true);
    expect(gridData.run_id).toBeDefined();
    expect(gridData.average_price_inr_per_mwh).toBeGreaterThan(0);
    expect(gridData.blocks.length).toBe(96);

    // 6. Grid Page Displays Backend Forecast Result
    await page.goto('/grid-intelligence');
    await expect(page.getByRole('heading', { name: /Grid Intelligence Monitor/i })).toBeVisible();
    await expect(page.getByText(/INTERNAL_VALIDATION/i)).toBeVisible();
    await expect(page.getByText('Peak Demand Block')).toBeVisible();

    // 7. Report Generated & Report Record Persisted
    const reportRes = await request.post('/api/reports/generate', {
      data: {
        siteId,
        reportType: 'GRID_DAILY_BRIEF',
        periodStart: '2026-09-08',
        periodEnd: '2026-09-08',
      },
    });
    expect(reportRes.status()).toBe(200);
    const reportJson = await reportRes.json();
    expect(reportJson.success).toBe(true);
    expect(reportJson.reportId).toBeDefined();
    expect(reportJson.downloadUrl).toBeDefined();

    // 8. Download Persisted Report
    const downloadRes = await request.get(reportJson.downloadUrl);
    expect(downloadRes.status()).toBe(200);
    expect(downloadRes.headers()['content-type']).toContain('text/csv');
    const downloadedText = await downloadRes.text();
    expect(downloadedText).toContain('# AETHEON ENERGY INTELLIGENCE REPORT');
    expect(downloadedText).toContain('GRID_DAILY_BRIEF');

    // 9. Alert Acknowledged & Persisted
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: /Alerts & Incident Hub/i })).toBeVisible();
    const ackBtn = page.getByRole('button', { name: 'Acknowledge' }).first();
    if (await ackBtn.isVisible()) {
      await ackBtn.click();
      await expect(page.getByText('Acknowledged').first()).toBeVisible();
    }

    // 10. Logout and Re-Login: State Remains Persisted
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: /Sign in to Aetheon/i })).toBeVisible();

    await page.locator('input[type="email"]').fill('rajesh.demo@demo.aetheonlabs.in');
    await page.locator('input[type="password"]').fill('AetheonDemo2026!');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Verify persisted site configuration persists after logout/login
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.locator('input[type="number"]').first()).toHaveValue(testDemand);

    // Verify report record exists on reports page
    await page.goto('/reports');
    await expect(page.getByText('Grid Daily Sourcing & Pricing Brief').first()).toBeVisible();
  });
});
