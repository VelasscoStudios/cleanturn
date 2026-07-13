# CleanTurn — Implementation Document
**Airbnb cleaning scheduler · internal tool · build-ready spec for agent orchestration**
Version 1.0 · July 2026

> **For the orchestrating agent:** This document is the single source of truth. Build exactly what is specified — no extra features, no speculative abstractions. §12 defines the build phases and how to split work across sub-agents. The file `cleaning-scheduler-prototype.html` in the same folder is the approved visual reference for all UI; match its layout, information hierarchy, and interactions.

---

## 1. Context & design constraints

Internal tool for one property-management business: **1 admin + ~8–15 cleaners + ~30–50 properties**. Owners are billing records, not users.

Non-negotiable constraints, in priority order:
1. **Bulletproof-simple:** boring, proven technology. No microservices, no queues, no Redis, no serverless functions. One container, one database.
2. **Secure:** internal does not mean open. Auth on every route, least-privilege data exposure (cleaners never see other cleaners' jobs, costs stay owner/admin-scoped where specified).
3. **Cheap:** target ≤ €10/month total.
4. **Low-maintenance:** minimal dependencies, pinned versions, automated backups, automated deploys. It should run for years with near-zero intervention.
5. **No scaling work:** never optimize for load. 10 concurrent users max. Correctness and durability over performance.

## 2. Architecture overview

```
┌─────────────────────────── GitHub ────────────────────────────┐
│  repo (main)                                                  │
│  ├── ci.yml       lint + typecheck + tests on every push      │
│  ├── deploy.yml   build Docker image → GHCR → SSH deploy      │
│  ├── sync.yml     schedule: */30 → POST /api/cron/sync        │
│  └── backup-check.yml  daily: verify last backup exists       │
└───────────────────────────────────────────────────────────────┘
                                │ docker compose pull && up -d
                                ▼
┌────────────────────── VPS (Hetzner CX22-class, ~€4/mo) ───────┐
│  Caddy (auto-HTTPS) ──► Next.js app (one container)           │
│                          │                                    │
│                          ▼                                    │
│                        Postgres 16 (container, named volume)  │
│  nightly pg_dump ──► restic/rclone ──► Backblaze B2 (~€0/mo)  │
└───────────────────────────────────────────────────────────────┘
External: Airbnb iCal feeds (pull) · Twilio WhatsApp (push) · Resend email (push)
```

Key decisions and why:
- **Next.js 15 (App Router) monolith.** UI + API in one deployable. Server components for reads, route handlers for writes.
- **Cron via GitHub Actions schedule**, not in-process cron. `sync.yml` runs every 30 min and POSTs to a secret-protected endpoint. Why: survives app restarts, has run history/logs in GitHub UI for free, zero extra infrastructure. (Accept that GH Actions schedules can drift a few minutes — irrelevant here.)
- **Postgres 16** via Prisma. SQLite would work at this scale but Postgres makes backups/restores and ad-hoc queries more standard, and removes any file-locking concerns.
- **Caddy** as reverse proxy: 15-line config, automatic Let's Encrypt renewal forever.
- **No NextAuth.** Two tiny hand-rolled credential flows (admin email+password, cleaner phone+PIN) with `iron-session` sealed cookies. Fewer deps = fewer CVE-driven forced upgrades.

### Pinned stack
| Layer | Choice | Version policy |
|---|---|---|
| Runtime | Node LTS | 22.x, bump only on LTS change |
| Framework | Next.js | 15.x, pin minor |
| ORM | Prisma | 6.x |
| DB | Postgres | 16 (major pinned in compose) |
| Sessions | iron-session | 8.x |
| Validation | zod | 3.x |
| iCal parsing | node-ical | latest at build, then pin |
| Passwords/PINs | bcryptjs | 2.x |
| Email | Resend SDK (or nodemailer+SMTP fallback) | pin |
| WhatsApp | twilio SDK | pin |
| CSS | Tailwind CSS | 4.x |
| Tests | Vitest + Playwright (smoke only) | pin |

Renovate/Dependabot: **security updates only** (config in repo). No routine version bumps.

---

## 3. Database schema

Prisma schema (authoritative — generate migrations from this):

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql", url = env("DATABASE_URL") }

model AdminUser {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String
  createdAt     DateTime @default(now())
}

model Owner {
  id           String     @id @default(cuid())
  name         String
  email        String
  phone        String?
  billingNotes String     @default("")
  active       Boolean    @default(true)
  properties   Property[]
  createdAt    DateTime   @default(now())
}

model Property {
  id          String    @id @default(cuid())
  ownerId     String
  owner       Owner     @relation(fields: [ownerId], references: [id])
  nickname    String
  address     String
  icalUrl     String    @unique
  cleanCost   Decimal   @db.Decimal(8, 2)   // fixed price per clean, billed to owner
  directions  String    @default("")
  mapsUrl     String?
  accessCode  String    @default("")        // shown ONLY to assigned cleaner + admin
  arriveTime  String                        // "11:00" — informational window, not enforced
  outByTime   String                        // "16:00"
  notes       String    @default("")
  active      Boolean   @default(true)
  syncStatus  String    @default("pending") // pending | ok | error
  syncError   String?
  lastSyncAt  DateTime?
  bookings    Booking[]
  jobs        Job[]
  createdAt   DateTime  @default(now())
}

model Cleaner {
  id        String   @id @default(cuid())
  name      String
  phone     String   @unique   // E.164, login identifier + WhatsApp target
  email     String?
  pinHash   String              // bcrypt of 6-digit PIN
  active    Boolean  @default(true)
  jobs      Job[]
  createdAt DateTime @default(now())
}

model Booking {
  id           String   @id @default(cuid())
  propertyId   String
  property     Property @relation(fields: [propertyId], references: [id])
  icalUid      String              // UID from the iCal event
  checkinDate  DateTime @db.Date
  checkoutDate DateTime @db.Date
  status       String   @default("active") // active | cancelled
  job          Job?
  updatedAt    DateTime @updatedAt
  createdAt    DateTime @default(now())

  @@unique([propertyId, icalUid])
}

model Job {
  id              String    @id @default(cuid())
  bookingId       String    @unique
  booking         Booking   @relation(fields: [bookingId], references: [id])
  propertyId      String
  property        Property  @relation(fields: [propertyId], references: [id])
  date            DateTime  @db.Date       // = booking.checkoutDate, always
  cost            Decimal   @db.Decimal(8, 2) // SNAPSHOT of property.cleanCost at creation
  cleanerId       String?
  cleaner         Cleaner?  @relation(fields: [cleanerId], references: [id])
  status          String    @default("unassigned")
  // unassigned | assigned | in_progress | awaiting_confirm | done | cancelled
  sameDayTurnover Boolean   @default(false)
  nextCheckinNote String?   // e.g. "guest arrives 15:00" when same-day
  arrivedAt       DateTime?
  leftAt          DateTime?
  cleanedAt       DateTime?
  paid            Boolean   @default(false)  // paid BY THE OWNER
  paidAt          DateTime?
  updatedAt       DateTime  @updatedAt
  createdAt       DateTime  @default(now())

  @@index([date])
  @@index([cleanerId, date])
  @@index([status, paid])
}

model NotificationLog {
  id        String   @id @default(cuid())
  jobId     String?
  channel   String   // whatsapp | email
  recipient String
  template  String   // job_assigned | job_moved | job_cancelled | admin_alert
  status    String   // sent | failed
  error     String?
  createdAt DateTime @default(now())
}
```

Rules encoded here (do not violate):
- `Job.cost` is snapshotted at creation. Changing `Property.cleanCost` never rewrites existing jobs.
- One job per booking (`bookingId @unique`). Jobs are never deleted, only status `cancelled` — history is billing data.
- `Booking` upsert key is `(propertyId, icalUid)`.
- Money is `Decimal`, never float. Currency is EUR, formatting only in UI.
- Dates: `Job.date`/booking dates are date-only. **All date logic runs in the business timezone** `APP_TIMEZONE` env var (e.g. `Europe/Madrid`). Never use server-local time.

Seed script (`prisma/seed.ts`): creates the admin user from `ADMIN_EMAIL`/`ADMIN_INITIAL_PASSWORD` env vars if no admin exists. Nothing else.

---

## 4. Backend design

### 4.1 Route map

All handlers under `app/api/`. Every handler: zod-validate input → check session/role → act → return typed JSON. Errors: `{ error: string }` with correct status; never leak stack traces.

| Method & path | Auth | Purpose |
|---|---|---|
| POST `/api/auth/admin/login` | public (rate-limited) | email+password → admin session cookie |
| POST `/api/auth/cleaner/login` | public (rate-limited) | phone+PIN → cleaner session cookie |
| POST `/api/auth/logout` | any session | destroy session |
| GET  `/api/schedule?from&to&propertyId&cleanerId&unassigned` | admin | jobs joined with property+cleaner |
| PATCH `/api/jobs/:id/assign` | admin | body `{cleanerId: string \| null}` → assign/unassign, triggers notification |
| PATCH `/api/jobs/:id/status` | cleaner (own job) or admin | advance status; sets `arrivedAt/leftAt/cleanedAt` server-side |
| PATCH `/api/jobs/:id/paid` | admin | `{paid: boolean}` → sets `paidAt` |
| POST `/api/billing/mark-owner-paid` | admin | `{ownerId, month?}` → bulk mark done+unpaid jobs paid |
| GET  `/api/billing?ownerId&status&month` | admin | done jobs grouped by owner with totals |
| CRUD `/api/properties`, `/api/owners`, `/api/cleaners` | admin | standard create/read/update + soft-deactivate (no hard delete) |
| GET  `/api/my/jobs` | cleaner | own jobs only, today + future, plus yesterday if not done |
| POST `/api/cron/sync` | `Authorization: Bearer CRON_SECRET` | run calendar sync (see 4.2) |
| GET  `/api/health` | public | `{ok, dbOk, lastSyncAt}` for uptime monitoring |

Status transition guard (server-enforced state machine):
`assigned → in_progress → awaiting_confirm → done` (cleaner, only on own job, only in this order) · admin may set any status (corrections). `cancelled` only via sync or admin.

### 4.2 Calendar sync (the core algorithm)

Single module `lib/sync.ts`, exported `runSync()` — invoked by the cron endpoint and by an admin "Sync now" button.

```
for each active property (sequentially — politeness to Airbnb, no rate concerns at 50 feeds):
  1. fetch icalUrl with 15s timeout, User-Agent set, 1 retry
     on failure: syncStatus=error, syncError=message; continue to next property
  2. parse VEVENTs (node-ical). Airbnb events: SUMMARY "Reserved" with UID,
     DTSTART=checkin, DTEND=checkout. IGNORE "Airbnb (Not available)" blocks.
  3. upsert bookings by (propertyId, icalUid):
     - new UID           → create Booking + create Job {date: checkout, cost: property.cleanCost}
     - checkout changed  → update Booking + Job.date (KEEP cleaner & status unless done)
                           → notify assigned cleaner "job_moved"
     - UID disappeared, checkout >= today, booking active
                         → Booking.cancelled, Job.cancelled
                           → notify assigned cleaner "job_cancelled"
       (never touch bookings fully in the past)
  4. recompute sameDayTurnover for all future jobs of this property:
     same-day = another active booking of this property has checkin == job.date
     set nextCheckinNote from property.arriveTime context if known (else "same-day turnover")
  5. syncStatus=ok, lastSyncAt=now
after all properties:
  - if any property has had syncStatus=error for > 6h → email admin (dedupe: max 1 email/day/property)
  - if any job within 48h is unassigned → email admin daily digest (max 1/day)
```

Idempotency: the entire algorithm is a reconciliation — running it twice produces no duplicate bookings, jobs, or notifications (notifications fire only on *state transitions*, and `NotificationLog` is checked to dedupe).

### 4.3 Notifications

Module `lib/notify.ts`. Templates (EN, single file, no i18n framework):

- `job_assigned` → cleaner: "New clean: {nickname}, {date}. Arrive {arrive}, out by {outBy}. Details: {APP_URL}/my"
- `job_moved`, `job_cancelled` → cleaner
- `admin_alert` → admin (sync failures, unassigned digest)

Delivery: WhatsApp via Twilio first; on failure fall back to email if the cleaner has one; log every attempt to `NotificationLog`. Both providers behind a 10s timeout; **a notification failure must never fail the calling request** (fire-and-forget with logged errors). WhatsApp requires a Twilio-approved template message for business-initiated sends — the three cleaner templates above must be registered in Twilio; keep wording in sync.

Messages contain **no access codes and no costs** — those live only behind login.

---

## 5. Front-end design

Match `cleaning-scheduler-prototype.html`. Tailwind, mobile-first, no component library, no client state library (React state + server components suffice).

### Routes
| Route | Who | Content |
|---|---|---|
| `/login` | public | two-tab login: Admin (email/password) · Cleaner (phone/PIN) |
| `/admin` | admin | Schedule: day-grouped jobs, filters (property/cleaner/unassigned), red "unassigned in 48h" banner, cleaner-assign dropdown per row, status chips, "Sync now" button with lastSyncAt |
| `/admin/billing` | admin | done jobs grouped by owner; unpaid/paid filter; per-owner totals; "mark paid" per job + "mark all paid" per owner; month filter |
| `/admin/properties` | admin | table + add/edit modal (owner dropdown, nickname, address, iCal URL with where-to-find helper text, cost, arrive/out-by, access code, directions, notes); sync status badge per row |
| `/admin/owners` | admin | table (contact, properties, billing notes, outstanding €) + add/edit modal |
| `/admin/cleaners` | admin | table + add/edit modal (name, phone, email, set/reset 6-digit PIN); activate/deactivate |
| `/my` | cleaner | job cards: Today then Upcoming. Card = nickname, address (link `https://maps.google.com/?q={address}`), blue window banner "Arrive HH:MM — out by HH:MM", ⚡ same-day flag, directions, access code, notes, €cost, single big action button (Arrived → Left → Unit clean → Done) |

### UX rules
- Cleaner view is the product for 8+ of the 10 users: large tap targets, works one-handed, readable outdoors. Test at 375px width.
- Action button does optimistic update with rollback on error.
- Admin schedule defaults to today + 7 days.
- Access code renders on the cleaner card **only when that cleaner is assigned and job date is within ±1 day** (least-privilege even inside the account).
- Empty states and error toasts as in prototype. No spinners longer than skeleton rows.

---

## 6. Security design

Threat model: internet-exposed internal tool. Attackers are bots/opportunists; also limit blast radius of a lost cleaner phone.

**Authentication**
- Admin: email + password (bcrypt, cost 12). Cleaner: phone + 6-digit PIN (bcrypt). PINs are set by admin, random by default, resettable — never stored or emailed in plaintext after creation response.
- Sessions: `iron-session` sealed, `HttpOnly`, `Secure`, `SameSite=Lax`, 30-day rolling for cleaners, 7-day for admin. Session payload: `{role: 'admin'|'cleaner', id}`.
- Rate limiting on both login endpoints: 5 attempts / 15 min / IP+identifier (in-Postgres counter table — no Redis). Generic error message on failure.

**Authorization (enforced server-side in every handler, never in UI alone)**
- `admin` → everything.
- `cleaner` → read own jobs; transition own jobs' status forward; nothing else. Property fields exposed to cleaner queries: nickname, address, directions, notes, window, cost, accessCode (rule in §5). Never: icalUrl, owner data, other cleaners, other jobs.
- Cron endpoint → constant-time compare of `Bearer CRON_SECRET` (32+ random bytes).

**Application hardening**
- zod validation on every input; Prisma parameterization (no raw SQL).
- Mutations via same-site fetch + `SameSite=Lax` cookie; additionally require custom header `X-Requested-With: fetch` on all state-changing routes (cheap CSRF belt-and-braces).
- Security headers via `next.config` / Caddy: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, minimal CSP (`default-src 'self'`; Next requires `'unsafe-inline'` styles — acceptable).
- iCal fetcher: allow only `https:` URLs on `airbnb.com`/`airbnb.*` hosts (SSRF guard); 1MB response cap.
- `robots.txt`: disallow all. No public pages except `/login` and `/api/health`.
- Secrets only in env (GitHub Actions secrets → VPS `.env`, chmod 600). Never in repo, never in client bundle (no `NEXT_PUBLIC_` secrets).
- Dependency policy: lockfile committed; Dependabot security PRs only; `npm audit` in CI as warning, not blocker.

**Server hardening (documented in `docs/server-setup.md`, executed once)**
- Ubuntu LTS, `ufw` allow 22/80/443 only, SSH keys only (no password auth), fail2ban, unattended-upgrades for OS security patches.
- Postgres not exposed publicly (compose-internal network only).
- Twilio/Resend/B2 credentials scoped to minimum (Twilio: messaging only; B2: single-bucket key).

**Data protection**
- Nightly encrypted backups (restic → B2), 30 daily + 6 monthly retention. Restore procedure documented and **tested in CI monthly** (backup-check.yml restores latest dump into a scratch Postgres container and runs `SELECT count(*) FROM "Job"`).
- Access codes stored plaintext in DB by design (cleaners must read them); mitigated by DB non-exposure + encrypted backups. Document this trade-off.

---

## 7. Deployment design

### Repo layout
```
/                     Next.js app (app router)
├── app/              routes + api handlers
├── lib/              sync.ts, notify.ts, auth.ts, db.ts, ratelimit.ts
├── prisma/           schema.prisma, migrations/, seed.ts
├── e2e/              playwright smoke tests
├── Dockerfile        multi-stage, distroless/alpine runner, ~150MB
├── compose.yaml      app + postgres:16 + caddy (+ restic backup sidecar cron)
├── Caddyfile
├── docs/server-setup.md
└── .github/workflows/{ci,deploy,sync,backup-check}.yml
```

### Workflows
- **ci.yml** (push/PR): install → prisma generate → typecheck → lint → vitest → build. Playwright smoke on PRs to main.
- **deploy.yml** (push to main, after CI): build image → push `ghcr.io/<org>/cleanturn:sha` + `:latest` → SSH to VPS → `docker compose pull && docker compose up -d` → app entrypoint runs `prisma migrate deploy` before `next start` → curl `/api/health` (fail = keep previous image running; compose keeps old container until new one is healthy — use `depends_on` + healthcheck).
- ~~**sync.yml**~~ **Superseded**: scheduled sync runs on the droplet itself via a systemd timer (`deploy/cleanturn-sync.timer`, every 10 min, `Persistent=true`) curling `POST 127.0.0.1:3100/api/cron/sync` with the Bearer secret read from a root-generated header file. GitHub Actions cron was rejected: best-effort scheduling (15–60 min drift), auto-disabled on repo inactivity, and an external dependency for a droplet-local job. Check it with `systemctl list-timers cleanturn-sync.timer` / `journalctl -u cleanturn-sync.service`.
- **backup-check.yml**: daily; verifies newest restic snapshot < 26h old; monthly full restore test.

### Environment variables
| Var | Notes |
|---|---|
| `DATABASE_URL` | compose-internal postgres |
| `SESSION_SECRET` | 32+ bytes |
| `CRON_SECRET` | 32+ bytes |
| `APP_URL` | https://clean.yourdomain.com |
| `APP_TIMEZONE` | e.g. Europe/Madrid |
| `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD` | seed only |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM` | |
| `RESEND_API_KEY`, `MAIL_FROM` | |
| `RESTIC_REPOSITORY/PASSWORD`, `B2_ACCOUNT_ID/KEY` | backups |

### Cost
VPS ~€4 + domain ~€1 + B2 ~€0 + Twilio per-message (~€0.01–0.05 × ~10/day) ≈ **€6–9/month**.

---

## 8. Testing & acceptance

**Unit (Vitest), required:** sync reconciliation (new/moved/cancelled/duplicate-run idempotency, using fixture .ics files including Airbnb "Not available" blocks), same-day turnover detection, job state machine guards, cost snapshotting, billing aggregation, rate limiter.

**E2E smoke (Playwright), required:** admin logs in → creates owner → property → cleaner → runs sync against a local fixture iCal server → assigns job → cleaner logs in on mobile viewport → taps Arrived/Left/Unit clean → admin sees done job in Billing → marks paid.

**Acceptance checklist (orchestrator: verify each before declaring done)**
1. Fresh clone + `.env` + `docker compose up` yields a working system with seeded admin.
2. Sync is idempotent: run twice on same fixtures → zero new rows, zero notifications.
3. Cleaner A cannot read/modify cleaner B's job via direct API call (write a test proving 403/404).
4. Unauthenticated requests to every non-public route return 401.
5. Cancelled booking cancels its job and notifies; past bookings untouched.
6. Cost change on property does not alter existing jobs' cost.
7. Billing totals match sum of done+unpaid job costs per owner.
8. `deploy.yml` deploys green on a test VPS; `/api/health` OK; rollback path documented.
9. Backup restore test passes.
10. Lighthouse mobile on `/my` ≥ 90 performance/accessibility.

---

## 9. Explicitly out of scope (do not build)

Owner logins/portal, payment processing (Stripe etc.), payroll for cleaners, photo uploads, chat, push notifications/PWA service worker, multi-admin, i18n framework, analytics, Airbnb official API, Vrbo/Booking feeds (architecture already supports adding an `icalUrl` per platform later — do not pre-build), any caching layer, any queue.

---

## 10. Reference UI

`cleaning-scheduler-prototype.html` (same folder) is the approved mock: replicate its schedule rows, billing owner-groups, property modal (incl. iCal help box), and cleaner card exactly, adjusted only for real data and auth.

---

## 11. Build-order & sub-agent orchestration plan

Phases are sequential; tasks within a phase run as **parallel sub-agents**. Every sub-agent gets: this doc, the prototype file, and its task block. Integration agent reviews all diffs at each phase end and runs the test suite.

**Phase 0 — Foundation (single agent)**
Scaffold Next.js + Tailwind + Prisma + schema §3 + migrations + seed + Dockerfile + compose + Caddyfile + CI workflow + `lib/db.ts`. Output must pass: `docker compose up` → healthcheck OK.

**Phase 1 — Core (3 parallel agents)**
- *A1 Auth & security:* `lib/auth.ts`, iron-session, login/logout endpoints + pages, rate limiter, middleware guarding `/admin/*`, `/my`, `/api/*`; security headers. Tests.
- *A2 Sync engine:* `lib/sync.ts`, `lib/notify.ts` (with provider stubs injectable for tests), cron endpoint, fixture .ics files, full unit test suite for §4.2 rules.
- *A3 CRUD APIs:* properties/owners/cleaners/schedule/jobs/billing handlers per §4.1 with zod schemas + authz per §6. Tests incl. cross-cleaner access denial.

**Phase 2 — UI (3 parallel agents)** *(depends on Phase 1 interfaces; agents code against the API contracts in §4.1)*
- *B1 Admin schedule + billing pages.*
- *B2 Admin properties/owners/cleaners pages + modals.*
- *B3 Cleaner `/my` view + login page,* mobile-first.

**Phase 3 — Delivery (2 parallel agents)**
- *C1 E2E:* Playwright suite incl. fixture iCal server; acceptance checklist §8 automated where possible.
- *C2 Ops:* deploy.yml, sync.yml, backup sidecar + backup-check.yml, `docs/server-setup.md`, `docs/runbook.md` (rotate PIN, restore backup, add property, read sync logs).

**Phase 4 — Integration agent:** run full acceptance checklist, fix gaps, produce `README.md` with 30-minute go-live guide (DNS, VPS bootstrap, GitHub secrets, Twilio template registration, first admin login).
