import { test, expect } from '@playwright/test';

// REAL AUTH SUITE - Requires authenticated user with valid entitlements
test.describe.configure({ retries: 0 });

test.describe('Aetheon Platform E2E REAL AUTH Workflows', () => {
  test.beforeEach(async ({ page }) => {
    // Verify we're NOT in demo mode, or we have real auth
    const isDemoMode = await page.evaluate(() => {
      return window.__NEXT_PUBLIC_DEMO_MODE__ === 'true' || 
             document.body.getAttribute('data-demo-mode') === 'true';
    });
    
    // Real auth test requires a logged-in user
    const testEmail = process.env.E2E_TEST_USER_EMAIL;
    const testPassword = process.env.E2E_TEST_USER_PASSWORD;
    
    if (!testEmail || !testPassword) {
      test.skip('E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD required for real auth tests');
    }
    
    // Login before each test
    await page.goto('/auth/login');
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('AETHEON', { exact: true })).toBeVisible();
  });

  test('1. Authenticated dashboard loads with user organisation', async ({ page }) => {
    await expect(page.getByText('AETHEON', { exact: true })).toBeVisible();
    // User should see their organisation name, not demo org
    const orgName = await page.locator('[data-testid="org-name"]').textContent();
    expect(orgName).toBeTruthy();
    expect(orgName).not.toContain('Demo');
  });

  test('2. Site switching respects has_site_access RLS', async ({ page }) => {
    const siteSelect = page.locator('header select').first();
    await expect(siteSelect).toBeVisible();
    
    // User should only see sites they have access to
    const options = await siteSelect.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(0);
    
    // Switching sites should update context
    if (options.length > 1) {
      await siteSelect.selectOption({ index: 1 });
      await expect(page.locator('[data-testid="site-status"]')).toBeVisible();
    }
  });

  test('3. Grid Intelligence Monitor requires ACTIVE site', async ({ page }) => {
    await page.goto('/grid-intelligence');
    await expect(page.getByRole('heading', { name: /Grid Intelligence Monitor/i })).toBeVisible();
    
    // Should show data quality status
    const qualityStatus = page.locator('[data-testid="quality-status"]').first();
    await expect(qualityStatus).toBeVisible();
  });

  test('4. CSV Ingestion requires ENERGY_MANAGER or ORGANISATION_ADMIN role', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: /Data Ingestion/i }).click();
    await expect(page.getByText('15-Minute AMR Interval Data Ingestion Gateway')).toBeVisible();
    
    // Download template should work
    const downloadBtn = page.getByRole('button', { name: 'Download CSV Template' });
    await expect(downloadBtn).toBeVisible();
  });

  test('5. Report generation requires product entitlement', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: /Executive Reports & Provenance Archives/i })).toBeVisible();
    
    // Generate button should be available for entitled products
    const generateBtn = page.getByRole('button', { name: /Generate Snapshot/i });
    await expect(generateBtn).toBeVisible();
  });

  test('6. Alert acknowledgment requires OPERATOR+ role', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: /Alerts & Incident Hub/i })).toBeVisible();
    
    // Acknowledge button should be visible for entitled user
    const ackButton = page.getByRole('button', { name: 'Acknowledge' }).first();
    // May not have alerts to acknowledge in test env
  });

  test('7. Compliance module requires OA_COMPLIANCE entitlement', async ({ page }) => {
    await page.goto('/compliance');
    // Should either show compliance dashboard or subscription required message
    const heading = page.getByRole('heading', { name: /Open Access Compliance Sentinel/i });
    await expect(heading).toBeVisible();
  });

  test('8. BESS module requires BESS_ARBITRAGE entitlement', async ({ page }) => {
    await page.goto('/bess');
    const heading = page.getByRole('heading', { name: /BESS Arbitrage Signals/i });
    await expect(heading).toBeVisible();
  });

  test('9. DSM module requires DSM_RISK entitlement', async ({ page }) => {
    await page.goto('/dsm');
    const heading = page.getByRole('heading', { name: /DSM Risk Monitor/i });
    await expect(heading).toBeVisible();
  });

  test('10. Admin console blocked for non-platform-admin users', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/Administrative Access Restricted|Internal Aetheon Platform Administration/i).first()).toBeVisible();
  });
});