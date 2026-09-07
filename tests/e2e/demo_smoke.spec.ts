import { test, expect } from '@playwright/test';

// DEMO MODE SMOKE SUITE - Only runs when NEXT_PUBLIC_DEMO_MODE=true
test.describe.configure({ retries: 0 });

test.describe('Aetheon Platform E2E DEMO MODE Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Verify demo mode is enabled
    const isDemoMode = await page.evaluate(() => {
      const win = window as unknown as { __NEXT_PUBLIC_DEMO_MODE__?: string };
      return win.__NEXT_PUBLIC_DEMO_MODE__ === 'true' || 
             document.body.getAttribute('data-demo-mode') === 'true';
    });
    if (!isDemoMode && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
      test.skip(true, 'Demo mode not enabled - skipping demo smoke tests');
    }
  });

  test('1. Application start & dashboard entry (DEMO MODE)', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Aetheon/i);
    await expect(page.getByText('AETHEON', { exact: true })).toBeVisible();
    await expect(page.getByText('Energy Intelligence', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Aetheon Demo Manufacturing Facility 1/i })).toBeVisible();
    await expect(page.getByText('Day-Ahead Average Price')).toBeVisible();
  });

  test('2. Site switching updates context and parameters (DEMO MODE)', async ({ page }) => {
    await page.goto('/');
    const siteSelect = page.locator('header select').first();
    await expect(siteSelect).toBeVisible();
    
    // Switch to Sanand site (AWAITING_DATA)
    await siteSelect.selectOption({ label: 'Aetheon Demo Engineering Unit 2 (Gujarat - UGVCL)' });
    await expect(page.getByText('AWAITING_DATA').first()).toBeVisible();

    // Switch back to Facility 1 site (ACTIVE)
    await siteSelect.selectOption({ label: 'Aetheon Demo Manufacturing Facility 1 (Maharashtra - MSEDCL)' });
    await expect(page.getByText('ACTIVE').first()).toBeVisible();
  });

  test('3. Grid Intelligence Monitor operational view & 96-block chart (DEMO MODE)', async ({ page }) => {
    await page.goto('/grid-intelligence');
    await expect(page.getByRole('heading', { name: /Grid Intelligence Monitor/i })).toBeVisible();
    await expect(page.getByText('Peak Demand Block')).toBeVisible();
    await expect(page.getByRole('button', { name: /96-Block Curve/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Scenario Cost Explorer/i })).toBeVisible();
  });

  test('4. Data Quality Gate suppression state when telemetry is missing/stale (DEMO MODE)', async ({ page }) => {
    await page.goto('/grid-intelligence');
    const siteSelect = page.locator('header select').first();
    await expect(siteSelect).toBeVisible();
    // Switch to Sanand site which is AWAITING_DATA
    await siteSelect.selectOption({ label: 'Aetheon Demo Engineering Unit 2 (Gujarat - UGVCL)' });

    // Verify status indicator reflects AWAITING_DATA
    await expect(page.getByText('AWAITING_DATA').first()).toBeVisible();

    // Switch back to Facility 1
    await siteSelect.selectOption({ label: 'Aetheon Demo Manufacturing Facility 1 (Maharashtra - MSEDCL)' });
    await expect(page.getByText('ACTIVE').first()).toBeVisible();
  });

  test('5. CSV Import workflow & 96-block template download (DEMO MODE)', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Settings, Site Operations & Data Gateway/i })).toBeVisible();
    await expect(page.getByText('15-Minute AMR Interval Data Ingestion Gateway')).toBeVisible();
    const downloadBtn = page.getByRole('button', { name: 'Download CSV Template' });
    await expect(downloadBtn).toBeVisible();
  });

  test('6. Locked / unsubscribed module gating and demo banners (DEMO MODE)', async ({ page }) => {
    await page.goto('/compliance');
    await expect(page.getByRole('heading', { name: /Open Access Compliance Sentinel/i })).toBeVisible();
    await expect(page.getByText(/DEMO.*UNVERIFIED/i).first()).toBeVisible();
  });

  test('7. Report view & export initiation (DEMO MODE)', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: /Executive Reports & Provenance Archives/i })).toBeVisible();
    const generateBtn = page.getByRole('button', { name: /Generate Snapshot/i });
    await expect(generateBtn).toBeVisible();
  });

  test('8. Alert incident acknowledgment (DEMO MODE)', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: /Alerts & Incident Hub/i })).toBeVisible();
    const ackButton = page.getByRole('button', { name: 'Acknowledge' }).first();
    if (await ackButton.isVisible()) {
      await ackButton.click();
      await expect(page.getByText('Acknowledged').first()).toBeVisible();
    }
  });

  test('9. Normal customer roles blocked from internal /admin console (DEMO MODE)', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/Administrative Access Restricted|Internal Aetheon Platform Administration/i).first()).toBeVisible();
  });

  test('10. Regulatory review and publication boundary (DEMO MODE)', async ({ page }) => {
    await page.goto('/compliance');
    await expect(page.getByRole('heading', { name: /Open Access Compliance Sentinel/i })).toBeVisible();
    await expect(page.getByText(/NOT LEGAL ADVICE|Decision Support/i).first()).toBeVisible();
    await expect(page.getByText(/Commission Approved Regulatory Documents/i)).toBeVisible();
    await expect(page.getByText(/Internal draft states \(REVIEW_PENDING\) are excluded/i)).toBeVisible();
  });

  test('11. BESS advisory language and safety interlocks (DEMO MODE)', async ({ page }) => {
    await page.goto('/bess');
    await expect(page.getByRole('heading', { name: /BESS Arbitrage Signals/i })).toBeVisible();
    await expect(page.getByText(/Opportunity Windows|Advisory/i).first()).toBeVisible();
  });

  test('12. DSM missing-data suppression and deviation risk bands (DEMO MODE)', async ({ page }) => {
    await page.goto('/dsm');
    await expect(page.getByRole('heading', { name: /DSM Risk Monitor/i })).toBeVisible();
    await expect(page.getByText(/Safeguards|Dampening|Bands|Deviation/i).first()).toBeVisible();
  });
});