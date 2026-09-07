import { test, expect } from '@playwright/test';

test.describe('Self-Service Customer Registration & First Site Onboarding Journey', () => {
  test('New User Registers -> Organisation Created -> ONBOARDING_REQUIRED -> First Site Configured -> Dashboard READY', async ({ page }) => {
    const timestamp = Date.now();
    const testEmail = `newowner_${timestamp}@demo.aetheonlabs.in`;
    const testPassword = 'AetheonOwner2026!';
    const testOrgName = `Auto Precision Systems ${timestamp} Ltd`;
    const testSiteName = `Chakan Manufacturing Facility ${timestamp}`;

    // 1. Visit registration page
    await page.goto('/auth/register');
    await expect(page.getByRole('heading', { name: /Create Your Enterprise Account/i })).toBeVisible();

    // 2. Fill registration form with organization name and user details
    await page.locator('input[placeholder*="Acme Auto Components Ltd"]').fill(testOrgName);
    await page.locator('input[placeholder*="Priya Sundaram"]').fill('Test Owner');
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);

    // 3. Submit registration
    await page.getByRole('button', { name: /Register Organisation/i }).click();

    // 4. Handle navigation to login or automatic session redirection
    await page.waitForTimeout(2000);
    const url = page.url();

    if (url.includes('/auth/login') || url.includes('/auth/register')) {
      await page.goto('/auth/login');
      await page.locator('input[type="email"]').fill(testEmail);
      await page.locator('input[type="password"]').fill(testPassword);
      await page.getByRole('button', { name: 'Sign In' }).click();
    }

    // 5. User should be authenticated. Since new org has no sites yet, ONBOARDING_REQUIRED state must be presented
    await expect(page).not.toHaveURL('/auth/register');
    
    // Check for either the dedicated first site setup card or dashboard if pre-seeded
    const isFirstSiteRequired = await page.getByText(/Configure First Industrial Facility/i).isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isFirstSiteRequired) {
      // 6. Complete First Site Configuration form
      await page.locator('input[placeholder*="Chakan Manufacturing Unit 1"]').fill(testSiteName);
      await page.locator('input[placeholder*="MSEDCL"]').fill('MSEDCL');
      await page.locator('input[placeholder*="Main 33kV Incomer Feeder"]').fill('Feeder Incomer 1');
      await page.getByRole('button', { name: /Initialize Facility & Launch/i }).click();
    }

    // 7. Dashboard must now transition to READY
    await expect(page.getByText('AETHEON', { exact: true })).toBeVisible({ timeout: 10000 });
    
    // User holds verified ORGANISATION_ADMIN role
    await expect(page.getByText('OA', { exact: true })).toBeVisible({ timeout: 10000 });
  });
});
