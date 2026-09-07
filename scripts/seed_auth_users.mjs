import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:15431';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const seedUsers = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    email: 'rajesh.sharma@demo-aetheon.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Rajesh Sharma (Admin)', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    email: 'vikram.desai@demo-aetheon.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Vikram Desai (Energy Manager)', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000003',
    email: 'sunil.pawar@demo-aetheon.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Sunil Pawar (Operator)', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000004',
    email: 'anita.roy@demo-aetheon.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Anita Roy (Finance Viewer)', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000005',
    email: 'analyst@aetheonlabs.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Aetheon Support Analyst', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000006',
    email: 'regulatory@aetheonlabs.in',
    password: 'AetheonDemo2026!',
    user_metadata: { full_name: 'Aetheon Regulatory Reviewer', is_platform_admin: false },
  },
  {
    id: 'c0000000-0000-0000-0000-000000000099',
    email: 'admin@aetheonlabs.in',
    password: 'AetheonSuperAdmin2026!',
    user_metadata: { full_name: 'Platform Superadmin', is_platform_admin: true },
  },
];

async function seed() {
  console.log('Seeding auth.users in local Supabase...');
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
        if (error.message.includes('already exists') || error.message.includes('unique')) {
          console.log(`User ${user.email} already exists.`);
        } else {
          console.error(`Error creating user ${user.email}:`, error.message);
        }
      } else {
        console.log(`Successfully created user: ${user.email} (${data.user.id})`);
      }
    } catch (e) {
      console.error(`Exception for ${user.email}:`, e);
    }
  }
  console.log('Auth users seed complete.');
}

seed().catch(console.error);
