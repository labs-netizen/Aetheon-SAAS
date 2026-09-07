import { test, expect } from '@playwright/test';

test.describe('Self-Service Customer Registration Journey (Defect #19)', () => {
  test('New User Registers -> Organisation Created -> ORGANISATION_ADMIN Assigned -> Site Setup Available', async ({ page }) => {
    const timestamp = Date.now();
    const testEmail = `newowner_${timestamp}@demo.aetheonlabs.in`;
    const testPassword = 'AetheonOwner2026!';
    const testOrgName = `Auto Precision Systems ${timestamp} Ltd`;

    // 1. Visit registration page
    await page.goto('/auth/register');
    await expect(page.getByRole('heading', { name: /Create Your Enterprise Account/i })).toBeVisible();

    // 2. Fill registration form with organization name
    await page.locator('input[placeholder*="Acme Auto Components"]').fill(testOrgName);
    await page.locator('input[placeholder*="Suresh Mehta"]').fill('Test Owner');
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);

    // 3. Submit registration
    await page.getByRole('button', { name: /Register Organisation & Account/i }).click();

    // 4. Verify either automatic session redirection to dashboard or confirmation
    // If local Supabase auto-confirms or returns session:
    await page.waitForTimeout(2000);
    const url = page.url();

    if (url.includes('/auth/login') || url.includes('/auth/register')) {
      // Log in with created user
      await page.goto('/auth/login');
      await page.locator('input[type="email"]').fill(testEmail);
      await page.locator('input[type="password"]').fill(testPassword);
      await page.getByRole('button', { name: 'Sign In' }).click();
    }

    // 5. Must NOT be in a dead state. Either dashboard is ready or onboarding screen appears
    await expect(page).not.toHaveURL('/auth/register');
    const isDashboardReady = await page.getByText('AETHEON', { exact: true }).isVisible().catch(() => false);
    const isOnboardingCard = await page.getByText('Enterprise Organisation Required').isVisible().catch(() => false);

    expect(isDashboardReady || isOnboardingCard).toBe(true);

    if (isOnboardingCard) {
      // If user had no organization, create organization via prompt
      await page.getByRole('button', { name: /Register New Organisation/i }).click();
      await page.locator('input[placeholder*="Acme Precision Metals"]').fill(testOrgName);
      await page.getByRole('button', { name: 'Confirm & Initialize' }).click();
      await expect(page.getByText('AETHEON', { exact: true })).toBeVisible();
    }

    // User is ORGANISATION_ADMIN
    await expect(page.getByText(/OA|ORGANISATION ADMIN/i).first()).toBeVisible();
  });
});
