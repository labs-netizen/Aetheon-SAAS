import nextEnvPkg from '@next/env';
import { createClient } from '@supabase/supabase-js';
const { loadEnvConfig } = nextEnvPkg;

// Load environment variables from .env.local without exposing secrets
loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is required to seed auth users. Ensure it is set in .env.local or the environment.'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Authoritative canonical demonstration users matching docs/PRODUCT_SPECIFICATION.md
const seedUsers = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    email: 'rajesh.demo@demo.aetheonlabs.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Rajesh Sharma (Aetheon Demo Admin)', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    email: 'vikram.demo@demo.aetheonlabs.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Vikram Desai (Aetheon Demo Energy Manager)', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000003',
    email: 'sunil.demo@demo.aetheonlabs.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Sunil Pawar (Aetheon Demo Operator)', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000004',
    email: 'anita.demo@demo.aetheonlabs.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Anita Roy (Aetheon Demo Finance Viewer)', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000005',
    email: 'analyst.internal@demo.aetheonlabs.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Aetheon Support Analyst', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000006',
    email: 'regulatory.internal@demo.aetheonlabs.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Aetheon Regulatory Reviewer', is_platform_admin: false },
  },
];

async function seed() {
  console.log('Seeding canonical demonstration users in Supabase auth.users...');
  for (const user of seedUsers) {
    try {
      const { data, error } = await supabase.auth.admin.createUser({
        id: user.id,
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: user.user_metadata,
      });
      if (error) {
        if (error.message.includes('already exists') || error.status === 422) {
          // Update password and metadata if user already exists
          const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
            email: user.email,
            password: user.password,
            email_confirm: true,
            user_metadata: user.user_metadata,
          });
          if (updateError) {
            console.warn(`User ${user.email} update warning:`, updateError.message);
          } else {
            console.log(`Updated user ${user.email}`);
          }
        } else {
          console.warn(`User ${user.email} creation note:`, error.message);
        }
      } else {
        console.log(`Created user ${user.email}`);
      }
    } catch (e) {
      console.warn(`Failed to seed ${user.email}:`, e.message);
    }
  }

  // Remove any obsolete demo users if present
  try {
    await supabase.auth.admin.deleteUser('c0000000-0000-0000-0000-000000000099');
  } catch (_) {}

  console.log('Auth user seeding complete.');
}

seed().catch(console.error);
