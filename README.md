# CleanTurn

CleanTurn is a localhost-only Airbnb cleaning scheduler: one Next.js app that syncs booking calendars from Airbnb iCal feeds, turns checkouts into cleaning jobs, lets an admin assign jobs to cleaners and track billing per property owner, and gives cleaners a mobile-first `/my` view to work through their day (Arrived → Left → Unit clean → Done). It runs entirely on your machine with a local SQLite database — no Docker, no external services, no deploy step.

## Quick start

```bash
npm install
npx prisma migrate dev
npm run seed        # only if migrate dev didn't already run it
npm run dev
```

Open **http://localhost:3100**.

The dev server always binds to port 3100 (`next dev -p 3100`, set in `package.json`) — if something else is already using that port, free it or edit the script.

## Demo credentials

**Admin** — logs in at `/login` under the Admin tab:

| Email | Password |
|---|---|
| `admin@cleanturn.local` | `cleanturn-demo` |

(Sourced from `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD` in `.env` — the seed skips creating an admin if one already exists, so these are only the *initial* credentials.)

**Cleaners** — log in under the Cleaner tab with phone + 6-digit PIN:

| Name | Phone | PIN |
|---|---|---|
| Maria | +15550101 | 111111 |
| Sofia | +15550102 | 222222 |
| Ana | +15550103 | 333333 |
| Lucia | +15550104 | 444444 |
| Carmen | +15550105 | 555555 |

## Tour of the views

- **`/login`** — two tabs (Admin email+password, Cleaner phone+PIN), plus a demo-credentials hint box since this is a localhost demo. Redirects by role on success.
- **`/admin`** — Schedule tab: jobs grouped by day (today → +7, filterable by property/cleaner/unassigned-only), a red banner when cleans are unassigned within 48h, per-row cleaner-assign dropdown, status chips, and a **Sync now** button showing last sync time.
- **`/admin/billing`** — completed (done) jobs grouped by owner, unpaid/paid + month filters, per-owner unpaid totals, "mark paid" per job and "mark all paid" per owner.
- **`/admin/properties`** — property table with sync-status badge; add/edit modal (owner, nickname, address, iCal URL with a where-to-find-it helper box, cost per clean, arrive/out-by window, access code, directions, notes).
- **`/admin/owners`** — owner table (contact, properties, billing notes, outstanding balance) with add/edit modal.
- **`/admin/cleaners`** — cleaner table (name, phone, login method, active status) with add/edit modal, including PIN set/reset.
- **`/my`** — the cleaner's mobile view (test at 375px): Today then Upcoming job cards — nickname, address (opens Google Maps), blue arrive/out-by window, ⚡ same-day-turnover flag, directions, access code (only shown within ±1 day of the job date), notes, cost, and a single big action button that advances the job status.

## How sync works locally

Real Airbnb iCal feeds are replaced by demo feeds the app serves itself:

- `GET /api/dev/ical/[key]` renders a deterministic `.ics` calendar from `lib/fixtures.ts` for each of the 6 seeded demo properties.
- Seeded `Property.icalUrl` values point at these local routes instead of real airbnb.com URLs.
- Clicking **Sync now** in `/admin` (or `POST /api/sync-now`) runs the same reconciliation algorithm as production: new bookings create jobs, moved checkouts update job dates (keeping cleaner/status unless already done), disappeared future bookings cancel their booking + job, and same-day-turnover flags get recomputed.
- Because the seed creates bookings with the exact same iCal UIDs the demo feeds serve, the **first** sync-now after a fresh seed is a no-op — that's intentional, and it's how you can verify idempotency: running sync-now twice in a row always returns `{created: 0, moved: 0, cancelled: 0}` on the second call.
- `POST /api/cron/sync` still exists for when this becomes a real deployment — it requires `Authorization: Bearer <CRON_SECRET>` (see `.env`) and would be hit by a real scheduler (e.g. GitHub Actions cron) instead of the manual button.

## Running tests

```bash
npx tsc --noEmit     # type check
npx vitest run       # unit tests (sync, state machine, billing, rate limiter, visibility/authz)
npm run build        # production build
```

## Deviations from the original spec

This build adapts `docs/implementation.md` (the original production-oriented spec) into a localhost-only MVP. Full rationale and the exact list of adaptations live in `docs/BUILD_BRIEF.md` §1; summary:

| Spec | This build | Why |
|---|---|---|
| Postgres 16 | SQLite via Prisma (`file:./dev.db`) | zero external services for a local demo |
| `Decimal` money | Integer cents (`costCents`, `cleanCostCents`) | avoids float/Decimal-in-SQLite friction; formatted as currency only in the UI |
| Twilio WhatsApp + Resend email | **Parked.** Notifications are disabled via `NOTIFICATIONS_ENABLED=false` in `.env` — `notifyCleaner`/`notifyAdmin` are silent no-ops, and the app works fully without them (cleaners check `/my`, admin watches the schedule + sync badges). Flip the flag to `true` to re-enable the console + `NotificationLog` pipeline; real providers slot into `lib/notify.ts` later | no SMS/email accounts on day one |
| In-Postgres rate-limit table | In-memory `Map` | fine for a single local process; would need a shared store (e.g. Postgres or Redis) behind a real multi-instance deploy |
| No deploy/backup stack | None of `Dockerfile`, `compose.yaml`, Caddy, GitHub Actions CI/CD, restic/B2 backups exist in this build | out of scope for a localhost demo |

For the full production path (Postgres, Docker/Caddy deploy, Twilio/Resend delivery, GitHub Actions cron + CI/CD, encrypted backups, server hardening), see `docs/implementation.md`.
