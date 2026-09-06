# Aetheon Energy Intelligence Platform - Deployment Guide (DEPLOYMENT.md)

## 1. Overview

The Aetheon Energy Intelligence Platform is deployed as:
1. **Next.js Web Application**: Hosted on Vercel, AWS ECS, or containerized Docker running on Linux.
2. **Supabase Managed Foundation**: PostgreSQL database with Row Level Security, Auth, and Storage.
3. **Analytics Microservice**: Python FastAPI container running numerical forecasting and mathematical solvers.

---

## 2. Environment Configuration

Copy `.env.example` to `.env.local` for local development or set the variables in your production environment:

```bash
# Next.js App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# Supabase (Auth, Database, Storage)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Internal Analytics Service
ANALYTICS_SERVICE_URL=http://localhost:8000
ANALYTICS_SERVICE_TOKEN=internal-dev-token

# Payment Provider (Razorpay)
RAZORPAY_KEY_ID=rzp_test_key
RAZORPAY_KEY_SECRET=rzp_test_secret
RAZORPAY_WEBHOOK_SECRET=rzp_webhook_secret

# Mode Configuration
NEXT_PUBLIC_DEMO_MODE=true
```

---

## 3. Database Migration Execution

Database migrations are located in `supabase/migrations/`.
To apply migrations against a Supabase or PostgreSQL instance:

```bash
# Using Supabase CLI
supabase db push

# Or using psql directly
cat supabase/migrations/*.sql | psql "$DATABASE_URL"

# Apply deterministic demo seed data
psql "$DATABASE_URL" -f supabase/seed.sql
```

---

## 4. Analytics Service Setup

```bash
cd services/analytics
python -m venv .venv
# On Windows: .venv\Scripts\activate
# On Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 5. Web Application Setup

```bash
# Install dependencies
npm install

# Run typecheck
npm run typecheck

# Run unit tests
npm test

# Run Next.js development server
npm run dev

# Build for production
npm run build
npm run start
```
