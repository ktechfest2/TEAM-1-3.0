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

The admin console is at http://localhost:3000/admin (not linked from the public site). The web app calls the API at `NEXT_PUBLIC_API_URL` (default http://localhost:4000).

## Polling unit register

TrustElect uses INEC's polling unit register: **176,846 polling units, 8,809 wards, 774 LGAs, 36 states and the FCT**. Load it with:

```sh
npm run register:fetch -w @trustelect/api    # download and verify (SHA-256) into apps/api/data/
npm run register:import -w @trustelect/api -- apps/api/data/inec-register.csv
```

Imports are idempotent: re-running updates names and adds new units. Any CSV with columns `pu_code, pu_name, ward_name, lga_name, state_name` (optionally `full_code, latitude, longitude, registered_voters`) can be imported the same way. `apps/api/seed/sample-register.csv` is a small fictional register for tests and offline development.

**Data source and credit.** The register is public electoral information published by the Independent National Electoral Commission (INEC). TrustElect loads the copy compiled in [paul1029-ife/polling-unit-finder](https://github.com/paul1029-ife/polling-unit-finder) (data from [saidiadegoke/nigeria-inec-geo](https://github.com/saidiadegoke/nigeria-inec-geo), MIT licence), pinned to commit `3efbaea` and verified by checksum. It is not an official INEC feed; TrustElect is not affiliated with or endorsed by INEC.

## Voter capture app

Voters open `/capture`, verify their phone with an SMS code, choose the election and photograph the EC60E poster with the live camera. Photos queue on the phone when offline and upload automatically when the network returns. Phone verification is controlled by settings in `.env`:

| Setting | Values |
|---|---|
| `CAPTURE_PHONE_VERIFICATION` | `none` (phone number only) or `sms` (6-digit SMS code required) |
| `SMS_PROVIDER` | `log` (development: codes appear in the API log and on screen) or `bulksmslive` (real SMS) |
| `BULKSMSLIVE_API_KEY` | API key from the BulkSMSLive dashboard (required for `bulksmslive`) |
| `SMS_SENDER_NAME` | Sender name on the SMS, max 11 characters (default `TrustElect`) |

Tests never read `.env` and always use the `log` provider, so they cannot send real SMS.

## AI verification of photos

A background worker in the API reads each submitted photo with a vision model through OpenRouter (`OPENROUTER_MODEL`, default `anthropic/claude-sonnet-5.5`). The model only describes what it sees; TrustElect's own rules (`apps/api/src/verification/decide.ts`) decide whether the photo is **accepted**, needs a **retake**, needs the voter to **confirm the figures** (arithmetic does not add up), or is **rejected**. Rejected images are deleted; only a short log entry is kept.

Measure reading accuracy on a folder of labelled photos (each `photo.jpg` with a `photo.json` of correct answers):

```sh
npm run ai:eval -w @trustelect/api -- apps/api/data/ec60e-eval            # default model
npm run ai:eval -w @trustelect/api -- apps/api/data/ec60e-eval anthropic/claude-haiku-5.5
```

Each photo is one paid model call. Set `VERIFICATION_WORKER=off` to pause verification.

## Tamper evidence

Every photo submission, polling unit result (with its versions), declaration and administrator
action is written to an append-only hash chain (`chain_entries`; the database refuses updates and
deletes). The latest hash is published as an anchor every `CHAIN_ANCHOR_MINUTES` (default 10).
Set `CHAIN_ANCHOR_EXTERNAL=opentimestamps` to also timestamp each anchor on the public
OpenTimestamps record (only a hash is sent).

Anyone can download an evidence pack per polling unit or ward and check it at `/verify`; the
check runs in the browser. Operators can check the whole chain and every stored record with:

```bash
npm run chain:verify -w @trustelect/api
```

## Ballot order

Parties are always listed in ballot order, which TrustElect sets **alphabetically by party acronym**. The API enforces it, whatever order parties are submitted in.

## Administrator accounts

Admins sign in with a password and a mandatory authenticator-app code (TOTP). Create the first one with:

```sh
ADMIN_PASSWORD='a long passphrase' npm run admin:create -w @trustelect/api -- \
  --email you@example.org --name "Your Name" --role system_admin
```

Roles: `reviewer`, `declarations_admin`, `approver`, `system_admin`. At first sign-in the admin scans a QR code with an authenticator app. Sessions are server-side, in an HTTP-only, SameSite=Strict cookie; logins are rate-limited and lock for 15 minutes after 5 failures; every action is written to the audit log.

## Deployment

| Part | Where | Address |
|---|---|---|
| Web app (static) | Firebase Hosting, project `trustelect` (free Spark plan) | https://trustelect.web.app |
| API, Postgres | VPS, Docker Compose in `/opt/trustelect` | https://api.example.org |

The web app is a static export: pages load data in the browser from `NEXT_PUBLIC_API_URL`, and admin
and voter sessions travel as Bearer tokens (the API is on another site, where browsers block cookies).
Security headers and the Content-Security-Policy are in `firebase.json`. On the server, Caddy terminates
HTTPS (`deploy/api/Caddyfile`) and the API listens on `127.0.0.1:4100` only.

```bash
deploy/deploy-api.sh   # build the API image here, load it on the server, restart, health check
deploy/deploy-web.sh   # build the static site and publish it to Firebase Hosting
```

Production secrets are only in `/opt/trustelect/.env` and `/opt/trustelect/db_password` on the server.
Migrations run when the API container starts.

## Tests

`npm run test:e2e -w @trustelect/api` runs against its own database, `trustelect_test` (created and
migrated automatically; override with `TEST_DATABASE_URL`, whose name must end in `_test`). It never
touches the development database.

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
