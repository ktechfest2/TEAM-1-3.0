# TrustElect

TrustElect is a citizen election evidence platform. Voters photograph the EC60E result poster at their polling unit. The platform verifies each photograph, builds confidence from independent witnesses, adds up citizen-collated results from the polling unit to national level, and shows where officially declared results match, do not match, or are disputed. Every photograph and decision is recorded in a tamper-evident hash chain.

All results shown by the platform are **citizen-collated and unofficial**.

## Repository layout

| Path | Contents |
|---|---|
| `apps/web` | Next.js + Tailwind CSS: live-camera capture app, public results and comparison site, admin console |
| `apps/api` | NestJS API: verification, witness, counting and comparison engines, hash chain, messaging webhooks |
| `packages/shared` | Types and constants shared by both apps (trust model, area levels) |
| `docker-compose.yml` | Local PostgreSQL (host port 5442) |

## Requirements

- Node.js 24 or later
- Docker (for the local database)

## Getting started

```sh
cp .env.example .env
npm install
npm run db:up          # start PostgreSQL in Docker
npm run db:migrate     # apply database migrations
npm run build -w @trustelect/shared
npm run dev:api        # API on http://localhost:4000
npm run dev:web        # web on http://localhost:3000
```

The admin console is at http://localhost:3000/admin (not linked from the public site). The web app proxies `/api/*` to the API, so admin cookies stay first-party.

## Polling unit register

The register (state, LGA, ward and polling unit codes and names) is imported from a CSV with columns `pu_code, pu_name, ward_name, lga_name, state_name` and optionally `latitude, longitude, registered_voters`:

```sh
npm run register:import -w @trustelect/api -- path/to/register.csv
```

Imports are idempotent: re-running updates names and adds new units. For development, `apps/api/seed/sample-register.csv` holds a fictional LGA (`24-99`) with 30 polling units, all named `SAMPLE …`.

## Administrator accounts

Admins sign in with a password and a mandatory authenticator-app code (TOTP). Create the first one with:

```sh
ADMIN_PASSWORD='a long passphrase' npm run admin:create -w @trustelect/api -- \
  --email you@example.org --name "Your Name" --role system_admin
```

Roles: `reviewer`, `declarations_admin`, `approver`, `system_admin`. At first sign-in the admin scans a QR code with an authenticator app. Sessions are server-side, in an HTTP-only, SameSite=Strict cookie; logins are rate-limited and lock for 15 minutes after 5 failures; every action is written to the audit log.

## Common commands

| Command | What it does |
|---|---|
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | Type-check all workspaces |
| `npm test` | Run unit tests |
| `npm run test:e2e -w @trustelect/api` | Run API end-to-end tests (needs the database) |
| `npm run build` | Build shared, API and web |
| `npm run db:generate` | Generate a migration after changing `apps/api/src/database/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |

## Design principles

Every screen must:

- show where each number comes from: witnesses, confidence, coverage, last update;
- stay calm and neutral: no party colours, parties in ballot order, nothing ranked or celebrated;
- show status in words and an icon, never colour alone;
- keep the "Citizen-collated, unofficial" label visible next to totals;
- work fast on low-end phones and slow networks, with no trackers;
- meet WCAG 2.2 AA.

Design tokens live in `apps/web/src/app/globals.css`.

## Privacy

Telemetry is disabled for development tools (`DISABLE_TELEMETRY`, `NEXT_TELEMETRY_DISABLED`). Phone numbers are stored only as a keyed hash and an encrypted value readable by administrators.
