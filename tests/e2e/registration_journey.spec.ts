import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required for tests');
}

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

    // 4. Confirm created test user's email via admin client so sign-in succeeds
    await page.waitForTimeout(2000);
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { users } } = await adminClient.auth.admin.listUsers();
    const createdUser = users.find(u => u.email === testEmail);
    if (createdUser) {
      await adminClient.auth.admin.updateUserById(createdUser.id, { email_confirm: true });
    }

    // 5. Navigate to login and sign in as the new owner
    await page.goto('/auth/login');
    await page.locator('input[type="email"]').fill(testEmail);
    await page.locator('input[type="password"]').fill(testPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 6. User should be authenticated. Since new org has no sites yet, ONBOARDING_REQUIRED state must be presented
    await expect(page).toHaveURL('/');
    
    // ONBOARDING_REQUIRED MUST appear (Requirement 42: Not optional)
    await expect(page.getByText(/Configure First Industrial Facility/i)).toBeVisible({ timeout: 15000 });
    
    // 6. Complete First Site Configuration form
    await page.locator('input[placeholder*="Chakan Manufacturing Unit 1"]').fill(testSiteName);
    await page.locator('input[placeholder*="MSEDCL"]').fill('MSEDCL');
    await page.locator('input[placeholder*="Main 33kV Incomer Feeder"]').fill('Feeder Incomer 1');
    await page.getByRole('button', { name: /Initialize Facility & Launch/i }).click();

    // 7. Dashboard must now transition to READY
    await expect(page.getByText('AETHEON', { exact: true })).toBeVisible({ timeout: 15000 });
    
    // User holds verified ORGANISATION_ADMIN role
    await expect(page.getByText('OA', { exact: true })).toBeVisible({ timeout: 10000 });

    // 8. Database / API Assertions (Requirement 42)

    // 8a. Verify organisation exists
    const { data: org, error: orgErr } = await adminClient
      .from('organisations')
      .select('*')
      .eq('name', testOrgName)
      .single();
    expect(orgErr).toBeNull();
    expect(org).toBeDefined();
    expect(org.name).toBe(testOrgName);

    // 8b. Verify membership role = ORGANISATION_ADMIN
    const { data: membership, error: memErr } = await adminClient
      .from('memberships')
      .select('*')
      .eq('organisation_id', org.id)
      .single();
    expect(memErr).toBeNull();
    expect(membership).toBeDefined();
    expect(membership.role).toBe('ORGANISATION_ADMIN');

    // 8c. Verify site exists and required fields match entered values
    const { data: site, error: siteErr } = await adminClient
      .from('sites')
      .select('*')
      .eq('organisation_id', org.id)
      .eq('name', testSiteName)
      .single();
    expect(siteErr).toBeNull();
    expect(site).toBeDefined();
    expect(site.name).toBe(testSiteName);
    expect(site.discom).toBe('MSEDCL');
    expect(site.metering_point).toBe('Feeder Incomer 1');
    expect(site.voltage_category).toBeDefined();
    expect(site.contract_demand_value).toBeDefined();

    // 8d. Verify site access exists
    const { data: access, error: accessErr } = await adminClient
      .from('site_access')
      .select('*')
      .eq('site_id', site.id)
      .eq('user_id', membership.user_id);
    expect(accessErr).toBeNull();
    expect(access?.length ?? 0).toBeGreaterThanOrEqual(1);

    // 8e. Verify activation history exists
    const { data: history, error: histErr } = await adminClient
      .from('site_activation_history')
      .select('*')
      .eq('site_id', site.id);
    expect(histErr).toBeNull();
    expect(history?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
