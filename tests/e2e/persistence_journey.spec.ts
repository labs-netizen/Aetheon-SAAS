import { test, expect } from '@playwright/test';

test.describe('End-to-End Real Persistence Journey (Section 32)', () => {
  test('Complete Customer Persistence Journey: Login -> Configure -> Ingest -> Persist -> Report -> Logout -> Relogin', async ({ page, request }) => {
    // 1. Navigate to Login Page
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: /Sign in to Aetheon/i })).toBeVisible();

    // Fill credentials for Org Admin (Rajesh Sharma)
    await page.locator('input[type="email"]').fill('rajesh.demo@demo.aetheonlabs.in');
    await page.locator('input[type="password"]').fill('AetheonDemo2026!');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Verified Entry into Dashboard
    await expect(page).toHaveURL('/');
    await expect(page.getByText('AETHEON', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Aetheon Demo Manufacturing Facility 1/i })).toBeVisible();

    // 3. Navigate to Settings & Site Parameters
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.getByText('Site Electrical Configuration')).toBeVisible();

    // Update contract demand parameter
    const testDemand = '2750';
    const demandInput = page.locator('input[label="Sanctioned Contract Demand (kVA)"], input[type="number"]').first();
    await demandInput.fill(testDemand);
    await page.getByRole('button', { name: 'Save Site Parameters' }).click();

    // Verify persistence confirmation message
    await expect(page.getByText(/Site configuration persisted successfully to PostgreSQL database/i)).toBeVisible();

    // Reload browser and verify the persisted value remains
    await page.reload();
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.locator('input[type="number"]').first()).toHaveValue(testDemand);

    // 4. Ingest Valid 96-Block CSV & Commit
    await page.getByRole('button', { name: /Data Ingestion/i }).click();
    await expect(page.getByText('15-Minute AMR Interval Data Ingestion Gateway')).toBeVisible();

    // Generate valid 96-block CSV payload
    const csvRows = ['operating_date,block_index,load_kw,solar_generation_kw,actual_drawal_kw,scheduled_drawal_kw'];
    for (let b = 1; b <= 96; b++) {
      csvRows.push(`2026-09-08,${b},${(2000 + Math.sin(b) * 200).toFixed(1)},150.0,2050.0,2000.0`);
    }
    const csvContent = csvRows.join('\n');

    // Upload file via hidden file input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'e2e_persisted_amr_96block.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent),
    });

    // Verify parser validates 96 blocks
    await expect(page.getByText('96/96 blocks validated successfully. Contiguity verified.')).toBeVisible();

    // Click Commit to Database
    const commitBtn = page.getByRole('button', { name: 'Commit to Database' });
    await expect(commitBtn).toBeVisible();
    await commitBtn.click();

    // Verify persistent commit confirmation
    await expect(page.getByText(/Successfully committed/i)).toBeVisible();

    // 5. Generate and Download Real Report
    const siteId = 'b0000000-0000-0000-0000-000000000001';
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

    // Download real CSV report file
    const downloadRes = await request.get(reportJson.downloadUrl);
    expect(downloadRes.status()).toBe(200);
    expect(downloadRes.headers()['content-type']).toContain('text/csv');
    const downloadedCsv = await downloadRes.text();
    expect(downloadedCsv).toContain('# AETHEON ENERGY INTELLIGENCE REPORT');
    expect(downloadedCsv).toContain('operating_date,block_index');

    // 6. Log out and Log back in to verify persistent state
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: /Sign in to Aetheon/i })).toBeVisible();

    // Log back in
    await page.locator('input[type="email"]').fill('rajesh.demo@demo.aetheonlabs.in');
    await page.locator('input[type="password"]').fill('AetheonDemo2026!');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Verify site parameters remain persisted after re-authentication
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Site Parameters' }).click();
    await expect(page.locator('input[type="number"]').first()).toHaveValue(testDemand);
  });
});
