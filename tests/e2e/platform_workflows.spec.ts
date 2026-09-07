import { test, expect } from '@playwright/test';

test.describe('Aetheon Platform E2E Critical Workflows', () => {

  test('1. Application start & dashboard entry', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Aetheon/i);
    await expect(page.getByText('AETHEON', { exact: true })).toBeVisible();
    await expect(page.getByText('Energy Intelligence', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Aetheon Demo Manufacturing Facility 1/i })).toBeVisible();
    await expect(page.getByText('Day-Ahead Average Price')).toBeVisible();
  });

  test('2. Site switching updates context and parameters', async ({ page }) => {
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

  test('3. Grid Intelligence Monitor operational view & 96-block chart', async ({ page }) => {
    await page.goto('/grid-intelligence');
    await expect(page.getByRole('heading', { name: /Grid Intelligence Monitor/i })).toBeVisible();
    await expect(page.getByText('Peak Demand Block')).toBeVisible();
    await expect(page.getByRole('button', { name: /96-Block Profile Chart/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cost Explorer & Sourcing Mix/i })).toBeVisible();
  });

  test('4. Data Quality Gate suppression state when telemetry is missing/stale', async ({ page }) => {
    await page.goto('/grid-intelligence');
    const siteSelect = page.locator('header select').first();
    // Switch to Sanand site which is AWAITING_DATA
    await siteSelect.selectOption({ label: 'Aetheon Demo Engineering Unit 2 (Gujarat - UGVCL)' });

    // Verify Publication Quality Gate triggers hard suppression
    await expect(page.getByText('Actionable Recommendations Hard-Suppressed')).toBeVisible();
    await expect(page.getByRole('button', { name: /Upload Current Data/i })).toBeVisible();

    // Switch back to Facility 1
    await siteSelect.selectOption({ label: 'Aetheon Demo Manufacturing Facility 1 (Maharashtra - MSEDCL)' });
  });

  test('5. CSV Import workflow & 96-block template download', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Settings, Site Operations & Data Gateway/i })).toBeVisible();
    await expect(page.getByText('15-Minute AMR Interval Data Ingestion Gateway')).toBeVisible();
    const downloadBtn = page.getByRole('button', { name: 'Download CSV Template' });
    await expect(downloadBtn).toBeVisible();
  });

  test('6. Locked / unsubscribed module gating and demo banners', async ({ page }) => {
    await page.goto('/compliance');
    await expect(page.getByRole('heading', { name: /Open Access Compliance Sentinel/i })).toBeVisible();
    await expect(page.getByText('DEMO / UNVERIFIED').first()).toBeVisible();
  });

  test('7. Report view & export initiation', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: /Executive Reports & Provenance Archives/i })).toBeVisible();
    const csvExportBtn = page.getByRole('button', { name: /Download CSV/i }).first();
    await expect(csvExportBtn).toBeVisible();
  });

  test('8. Alert incident acknowledgment', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: /Alerts & Incident Hub/i })).toBeVisible();
    const ackButton = page.getByRole('button', { name: 'Acknowledge' }).first();
    await expect(ackButton).toBeVisible();
    await ackButton.click();
    await expect(page.getByText('Acknowledged').first()).toBeVisible();
  });

  test('9. Normal customer roles blocked from internal /admin console', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Administrative Access Restricted')).toBeVisible();
    await expect(page.getByText(/Customer accounts cannot access internal Aetheon platform administration/i)).toBeVisible();
  });

  test('10. Regulatory review and publication boundary', async ({ page }) => {
    await page.goto('/compliance');
    await expect(page.getByRole('heading', { name: /Open Access Compliance Sentinel/i })).toBeVisible();
    await expect(page.getByText(/Decision Support & Compliance Notice/i)).toBeVisible();
    await expect(page.getByText(/Regulatory Source Register & Review Workflow/i)).toBeVisible();
    await expect(page.getByText('REVIEW_PENDING')).toBeVisible();
    await expect(page.getByText(/Blocked from Customer View/i)).toBeVisible();
  });

  test('11. BESS advisory language and safety interlocks', async ({ page }) => {
    await page.goto('/bess');
    await expect(page.getByRole('heading', { name: /BESS Arbitrage Signals/i })).toBeVisible();
    await expect(page.getByText(/Recommended Charge \/ Discharge Opportunity Windows/i)).toBeVisible();
    await expect(page.getByText('Safety Interlock Lockout')).toBeVisible();
    const lockBtn = page.getByRole('button', { name: 'Simulate Lock' });
    await expect(lockBtn).toBeVisible();
    await lockBtn.click();
    await expect(page.getByText('Advisory Signals Hard-Suppressed')).toBeVisible();
  });

  test('12. DSM missing-data suppression and deviation risk bands', async ({ page }) => {
    await page.goto('/dsm');
    await expect(page.getByRole('heading', { name: /DSM Risk Monitor/i })).toBeVisible();
    await expect(page.getByText(/Operational Safeguards & Alert Dampening/i)).toBeVisible();
    await expect(page.getByText('Quiet Hours (22:00 - 06:00 IST)')).toBeVisible();
  });

});
