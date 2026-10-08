# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Backend for a multi-tenant accounting SaaS ("project accounting"). Node.js + Express + TypeScript + Prisma 7 (PostgreSQL via `@prisma/adapter-pg`). Companies subscribe (pay-before-use); users can belong to multiple companies with different roles per company; core domain is double-entry bookkeeping (journal entries, fiscal years/periods, chart of accounts).

## Commands

```bash
npm run dev                    # start dev server (nodemon + ts-node, watches src/)
npm run build                  # prisma generate && tsc -p . -> lib/
npm start                      # run built server (node lib/index.js)

npm run prisma:generate        # regenerate Prisma client (also runs on postinstall)
npm run prisma:migrate         # prisma migrate dev
npm run db:studio              # prisma studio

npm test                       # vitest run (unit + integration)
npm run test:unit              # vitest run --project unit
npm run test:integration       # vitest run --project integration

npx vitest run tests/unit/dateOnly.test.ts   # run a single test file
npx tsc -p . --noEmit          # type-check only (what CI runs)

npm run activate:company       # ts-node scripts/activate-company.ts — manually mark a company subscription ACTIVE
```

Local Postgres for dev is provided by `docker-compose.yml` (port **5433**, db `project_accounting`, user/pass `postgres`/`postgres`). Integration tests provision their own dedicated test database (see `tests/integration/globalSetup.ts`, `testDb.ts`) using `TEST_DATABASE_URL`.

CI (`.github/workflows/ci.yml`, runs on push to `main`/`niklas-dev` and PRs to `main`): `npm ci` → `tsc --noEmit` → `prisma migrate deploy` → `npm run build` → `npm test`, against a real Postgres 16 service container.

## Architecture

### Request flow
`src/index.ts` creates the HTTP server (graceful shutdown on SIGINT/SIGTERM, 10s force-exit) around the app built by `src/app.ts` — the app factory is kept separate from `.listen()` so it can be imported directly in integration tests. Middleware order: Helmet → CORS (credentials on, origin pinned to `env.CORS_ORIGIN`) → JSON body parsing (100kb limit) → cookie-parser → Morgan (non-test envs only) → routes → `notFound` → `errorHandler`.

Routes are aggregated in `src/routes/index.ts`: `/health` and `/api/auth` and `/api/companies` are public (each does its own internal gating); every other `/api/*` route is gated behind `requireAuth` + `requireActiveSubscription`. Route → controller (Zod validation of body/params/query) → service (business logic, Prisma calls) → `AppError` thrown on failure, caught by the centralized `errorHandler` (translates `AppError`, `ZodError` → 400, Prisma `P2002` → 409, else 500 with detail only in dev).

### Auth & sessions
Cookie-based sessions, not JWT (`src/lib/session.ts`): a random 32-byte base64url token is issued to the client, but only its SHA256 hash is stored server-side, so a DB breach doesn't leak usable tokens. Sessions have a 30-day TTL with a sliding window — `lastUsedAt` is bumped (and expiry extended) once it's over a day old. `requireAuth` (`src/middleware/requireAuth.ts`) resolves the cookie to a session, attaches `req.auth = { user, session, membership }`, and **re-verifies company membership on every request** so revoking access is instant, not cached. State-changing requests (non-GET/HEAD) are checked against `Origin` matching `env.CORS_ORIGIN` as CSRF protection. Passwords are Argon2id; login uses a dummy hash comparison on unknown emails to avoid timing leaks. Email verification and password reset both use one-time tokens (`VerificationToken`, 1-hour TTL) sent via `src/lib/mailer.ts`.

### Multi-tenancy
`Company` has a `subscriptionStatus` (`PENDING_PAYMENT` / `ACTIVE` / `PAST_DUE` / `CANCELED`); `requireActiveSubscription` gates access accordingly. `CompanyUser` is the membership join table (composite `userId`+`companyId`, carries `role` — `VIEWER < LEDGER < ACCOUNTANT < ADMIN` — and `isAdmin`). A user can hold different roles in different companies. Sessions track an `activeCompanyId` so "switch company" is just updating the session row. Almost every domain table carries a `companyId` and services must filter by it; some tables (e.g. `AccountingPeriod`) denormalize `companyId` from their parent for indexed lookups.

### Accounting domain
- **Journal entries** (`src/services/journal-entry.service.ts`): double-entry, lines carry `debit`/`credit` amounts that must balance (compared in cents to avoid float rounding) inside a `prisma.$transaction`. Voucher numbers are allocated atomically per company+voucherType via an `upsert` on `VoucherCounter` to serialize concurrent numbering.
- **VAT** (`src/lib/vat.ts`): line amounts are net. A line with a `vatRate` gets a generated row (`JournalEntryLine.isVat`) on the VAT account `ChartOfAccounts` names for its side — `vatReceivableAccountId` for debit lines, `vatPayableAccountId` for credit lines — and the entry must balance with those rows counted. The service derives `vatAmount` and the VAT rows itself on every create/update; clients send only the entered lines. The UI mirrors `vatCents` to preview the rows, so change the rounding in both.
- **Fiscal guards** (`src/services/fiscal-guard.service.ts`): postings are only allowed on dates covered by both an `OPEN` `FiscalYear` and an `OPEN` `AccountingPeriod`. A GiST `EXCLUDE` constraint at the DB level prevents overlapping fiscal years per company (see migration `20260709204556_add_fiscal_years_and_periods`).
- Date-only columns (fiscal year/period boundaries, journal entry dates) are normalized to UTC midnight via `src/lib/dateOnly.ts` — always use it rather than raw `Date` construction when writing to these columns.
- `src/lib/defaultChartOfAccounts.ts` seeds a default chart of accounts for new companies; `AccountMainClass` enum defines the standard grouping (REVENUE, MATERIALS_AND_SERVICES, PERSONNEL_EXPENSES, etc.).

### Prisma setup
This is **Prisma 7**: the connection URL lives in `prisma.config.ts` (not `datasource.url` in schema), and the generated client is checked into `src/generated/prisma/` and used through `@prisma/adapter-pg` rather than Prisma's bundled query engine. The schema itself is split into topic files under `prisma/models/` (`auth.prisma`, `users.prisma`, `companies.prisma`, `accounting.prisma`, `fiscal.prisma`) with `prisma/schema.prisma` only holding generator config — edit the relevant model file, not schema.prisma directly. `src/lib/prisma.ts` exports a singleton client stashed on `globalThis` so it survives nodemon reloads.

### Validation & error handling
Zod schemas live alongside their controllers (reusable primitives like `dateOnlySchema`, `idParamsSchema` are in `src/lib/apiSchemas.ts`). Controllers validate and hand parsed input to services; services never see raw request objects. Async route handlers are wrapped in `src/lib/asyncHandler.ts` so rejected promises reach `next(err)` instead of crashing the process. Throw `AppError` (`src/lib/AppError.ts`, carries an HTTP status + `isOperational`) for any expected business-logic failure rather than a plain `Error`.

### Tests
Unit tests (`tests/unit/`) cover pure logic (date normalization, chart-of-accounts seeding, period generation) with no DB. Integration tests (`tests/integration/`) run against a dedicated provisioned Postgres database, execute **sequentially** (`fileParallelism: false` in `vitest.config.ts`) since they share that DB, and use a 30s test / 60s hook timeout. `tests/integration/helpers.ts` has shared setup utilities (e.g. creating an authenticated request context).
