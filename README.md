# Project accounting – backend

REST API for a multi-tenant accounting SaaS: double-entry bookkeeping, fiscal years and periods, chart of accounts, VAT, bank statements, purchase and sales invoices, and financial reports. Users can belong to several companies with a different role in each, and a company's books open only once its subscription is active.

The web client lives in the sibling repo [project_accounting_ui](https://github.com/NiklasKrogell/project_accounting_ui).

## Tech stack

- Node.js 22+, TypeScript, Express 4
- PostgreSQL 16 via Prisma 7 (`@prisma/adapter-pg`)
- Zod for request validation, Argon2id for passwords, cookie-based sessions
- S3-compatible object storage for files (Cloudflare R2 in production, S3Mock locally)
- Vitest + Supertest for tests

## Getting started

```bash
docker compose up -d      # Postgres on :5433 and S3Mock on :9090
cp .env.example .env      # defaults point at the containers above
npm install               # also generates the Prisma client
npm run prisma:migrate    # apply migrations to the dev database
npm run dev               # API on http://localhost:4000
```

A newly registered company starts as `PENDING_PAYMENT`. Until payments are wired up, activate it by hand with `npm run activate:company`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with reload (nodemon + ts-node) |
| `npm run build` / `npm start` | Compile to `lib/` and run the build |
| `npm test` | All tests (`test:unit`, `test:integration` run one project) |
| `npm run prisma:migrate` | Create/apply migrations (`prisma migrate dev`) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run activate:company` | Mark a company's subscription active |
| `npm run storage:check` | Write, read back and delete an object in the configured bucket |

The integration tests create their own test database (`TEST_DATABASE_URL`) and bucket, so the containers need to be running.

## Configuration

All settings come from environment variables, which `.env.example` lists and explains: `PORT`, `DATABASE_URL`, `CORS_ORIGIN` (the UI's origin), `TRUST_PROXY` (set it in production behind a reverse proxy) and the `S3_*` storage settings. The server won't start without them.

## Project layout

```
src/
  routes/        route definitions (all /api/* except auth, companies, invitations, user settings sit behind auth + subscription checks)
  controllers/   Zod validation of requests
  services/      business logic and Prisma calls
  middleware/    auth, roles, subscription gating, errors
  lib/           shared helpers (VAT, money, dates, IBAN, sessions, storage…)
prisma/          schema models and migrations
scripts/         one-off maintenance scripts
tests/           unit and integration tests
```

CI (`.github/workflows/ci.yml`) type-checks, applies the migrations, builds and runs the tests against Postgres and S3Mock containers.

See [CLAUDE.md](CLAUDE.md) for the detailed architecture and domain rules.
