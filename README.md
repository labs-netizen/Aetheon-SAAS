# Aetheon Energy Intelligence Platform (`aetheon-saas`)

Enterprise algorithmic decision-support platform engineered specifically for Indian Commercial & Industrial (C&I) electricity consumers.

The platform provides standardized recurring digital intelligence across five key energy domains:
- **Grid Intelligence Monitor**: 96-block Day-Ahead price & demand forecasting, Daily Grid Brief, and landed cost optimization.
- **Open Access Compliance Sentinel**: Statutory compliance tracking, DISCOM charges (CSS, AS, Wheeling), and SLDC calendar.
- **DSM Risk Monitor**: Real-time 15-minute scheduled vs. actual deviation tracking under CERC/SERC regulations.
- **BESS Arbitrage Signals**: Degradation-aware advisory charge/discharge opportunity window recommendations for C&I batteries.
- **Renewable Portfolio Monitor**: Generation reconciliation (measured/modelled/estimated) and avoided carbon emission accounting.

---

## 1. Operating Boundary & Disclaimers

> [!IMPORTANT]
> The Aetheon platform produces **algorithmic decision support** for operational planning.
> The platform does **not** execute autonomous electricity exchange bids, submit binding SLDC schedules, dispatch physical plant equipment, control BMS/SCADA systems, or provide formal legal opinions.

---

## 2. Technology Stack

- **Application Frontend**: Next.js 14 App Router, React 18, TypeScript (Strict), Tailwind CSS, Lucide React, Recharts.
- **Database & Auth**: PostgreSQL managed via Supabase with Row Level Security (RLS) policies.
- **Analytics Service**: Python 3.12, FastAPI, Pydantic, NumPy, Pandas.
- **Validation**: Zod (TypeScript) and Pydantic (Python).
- **Testing**: Vitest, React Testing Library, Pytest.

---

## 3. Getting Started

### Prerequisites
- Node.js >= 18.18 (tested on Node.js v24)
- Python >= 3.10 (tested on Python 3.12)
- Git

### Installation

```bash
# Clone repository
git clone <repo-url> aetheon-saas
cd aetheon-saas

# Install Node.js dependencies
npm install

# Copy environment template
cp .env.example .env.local
```

### Running Local Development Servers

```bash
# 1. Start the Next.js portal application (port 3000)
npm run dev

# 2. (Optional) Start Python Analytics Service (port 8000)
cd services/analytics
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 4. Demo Mode & Seed Data

The application operates out of the box in **DEMO MODE**:
- Pre-seeded with **Aetheon Demo Industries Pvt Ltd** and **Chakan Auto Components Plant 1** (33kV, 2,500 kVA, MSEDCL).
- Prominent `DEMO DATA / UNVERIFIED` badges appear across all modules.
- Includes a live 15-minute AMR CSV uploader in **Settings & Ingestion** with pre-configured template downloads.

---

## 5. Verification & Testing

```bash
# Run TypeScript Typecheck
npm run typecheck

# Run Vitest Unit & Security Integration Tests
npm test

# Run Next.js Production Build
npm run build

# Run Python Analytics Unit Tests
cd services/analytics
pytest tests/ -v
```

---

## 6. Architecture & Audit Documentation

Detailed technical documentation is located in the `docs/` directory:
- [System Architecture](docs/ARCHITECTURE.md)
- [Architectural Decisions Log](docs/DECISIONS.md)
- [Implementation Status Matrix](docs/IMPLEMENTATION_STATUS.md)
- [Data Model & SQL Schema](docs/DATA_MODEL.md)
- [Data Sources & Gateway](docs/DATA_SOURCES.md)
- [Security & Governance Architecture](docs/SECURITY.md)
- [Product Modules Specification](docs/MODULES.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Handoff to Astra (Audit Checklist)](docs/HANDOFF_TO_ASTRA.md)
