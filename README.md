# PackagePulse

PackagePulse is a developer tool for examining npm package metadata, public repository signals, and version-specific OSV vulnerability reports. Its score is an explainable heuristic, not a security verdict.

## Architecture

- `apps/web`: React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, and Lucide.
- `apps/api`: Express, TypeScript, Zod validation, npm Registry, GitHub REST, OSV, Prisma, and optional BullMQ monitoring.
- `apps/api/prisma`: PostgreSQL models and additive SQL migrations.
- Workspace: pnpm monorepo.

The API keeps external-service requests on the server. GitHub authentication is optional and never sent to the browser. npm and GitHub requests have an 8-second timeout. Missing repository data is displayed as unavailable; health signals with missing inputs are omitted and the remaining weights are renormalized.

## Implemented

- Responsive landing, search, package detail, comparison, sign-up, login, and dashboard pages.
- Real npm search, package metadata, and versions routes.
- GitHub repository metadata when a GitHub URL is present and accessible.
- Health score with signal breakdown and 30/25/20/15/10 weights (repository activity, release freshness, adoption, metadata completeness, repository release history).
- Version-specific OSV query.
- Prisma schema for users, tracked packages, and snapshots.
- Cookie-based JWT authentication with `HttpOnly`, origin-checked state changes, `SameSite=None; Secure` in production for separate Vercel/Render origins, and bcrypt password hashing.
- User-scoped package tracking and monitoring controls, comparison API, input validation, Helmet, and consistent JSON errors.

## Not implemented yet

- Email/webhook alert delivery. Monitoring stores snapshots and changes, but does not send alerts.
- UI component primitives from shadcn/ui are not installed; the current interface uses small local components and custom Tailwind-compatible CSS.

The dashboard requires an account and PostgreSQL. Browser storage is not used as a substitute for account persistence.

## Requirements

- Node.js 20 or later
- pnpm 9 or later
- PostgreSQL (Neon for hosted deployment)

## Local development

1. Copy `apps/api/.env.example` to `apps/api/.env` and configure pooled `DATABASE_URL`, direct `DIRECT_URL`, and a random `SESSION_SECRET` (at least 32 random bytes).
2. Copy `apps/web/.env.example` to `apps/web/.env` if the API is not at `http://localhost:4000`.
3. Install and generate the Prisma client: `pnpm install`, then `pnpm db:generate`.
4. Apply the schema: `pnpm db:migrate`.
5. Run both apps with `pnpm dev`.
6. If Redis is running, start the worker separately with `pnpm --filter @packagepulse/api dev:worker`.

Web runs at `http://localhost:5173`; API runs at `http://localhost:4000`. The API health route (`GET /api/health`) confirms process availability only, not database readiness.

## Environment variables

### API (`apps/api/.env`)

| Variable | Purpose |
| --- | --- |
| `PORT` | API port; defaults to `4000` |
| `NODE_ENV` | Set to `production` for secure cookies |
| `DATABASE_URL` | PostgreSQL connection string |
| `DIRECT_URL` | Direct PostgreSQL connection used by Prisma migrations (Neon: remove `-pooler` from the host) |
| `SESSION_SECRET` | Secret used to sign 7-day session JWTs |
| `WEB_ORIGIN` | Exact allowed web origin for credentialed CORS |
| `GITHUB_TOKEN` | Optional GitHub token to improve API rate limits |
| `REDIS_URL` | Optional Redis connection for the BullMQ monitoring worker |
| `MONITOR_INTERVAL_MS` | Monitoring interval in milliseconds; defaults to six hours |

### Web (`apps/web/.env`)

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Public API base URL; defaults to `http://localhost:4000` |

Never put backend secrets in a `VITE_` variable or commit `.env` files.

## API routes

- `GET /api/health`
- `GET /api/packages/search?q=react`
- `GET /api/packages/:name`
- `GET /api/packages/:name/versions`
- `GET /api/packages/:name/health`
- `GET /api/packages/:name/security?version=1.0.0`
- `POST /api/packages/compare` with `{ "packages": ["react", "vue"] }` (2–3 entries)
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/tracked-packages`, `POST /api/tracked-packages`, `DELETE /api/tracked-packages/:id`
- `PATCH /api/tracked-packages/:id/monitoring` with `{ "enabled": true }`
- `GET /api/dashboard`

Scoped package names should be URL-encoded as one path segment (for example `%40scope%2Fname`).

## Verification

`pnpm typecheck` and `pnpm build` run workspace TypeScript checks and production builds. `pnpm test` runs the API unit tests. `pnpm db:generate` generates the Prisma client; `pnpm db:migrate` applies checked-in migrations. No command is reported as passing until it has actually run successfully.

## Deployment preparation

### Render full stack

Connect this repository to Render as a Blueprint. The included `render.yaml` defines the API, static web app, and BullMQ worker, and wires the frontend/API origins automatically. The API uses Render's free plan (which can spin down when idle); the monitoring worker uses the smallest always-on worker plan and incurs Render compute charges. Set the pooled Neon connection string as `DATABASE_URL`, the direct Neon connection string as `DIRECT_URL`, and the Upstash TLS connection string as `REDIS_URL` for the API and worker. Render generates `SESSION_SECRET` and applies checked-in Prisma migrations before starting the API. `GITHUB_TOKEN` is optional and can be added to the API service if GitHub rate limits become an issue.

## Monitoring behavior

Tracked packages default to monitoring enabled and can be individually paused. The BullMQ worker schedules a deduplicated discovery job, queues per-package checks with retries, stores version/health/advisory snapshots, records check errors, and prunes snapshots older than 90 days. Set `REDIS_URL` on the API and worker. In local development without Redis, the API process runs periodic checks in-process; this fallback is not suitable for multiple production instances.

## Limitations

Public npm, GitHub, and OSV data can be incomplete or temporarily unavailable. A response with zero OSV records means no known records were returned for that version, not that a package is secure. A health score is not a quality or security guarantee. Monitoring records snapshots and status but does not send alerts.
