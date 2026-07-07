# CleanTurn — Localhost Build Brief (AUTHORITATIVE)

This file adapts `docs/implementation.md` (the product spec) to a **localhost-only MVP**. Where this file and the spec conflict, **this file wins**. The visual reference is `docs/prototype.html` — match its layout, information hierarchy, and interactions.

## 0. Mission

One Next.js app at `http://localhost:3100` containing every view: admin (Schedule, Billing, Properties, Owners, Cleaners), cleaner (`/my`), and `/login`. Started with `npm run dev`. Nothing external: no Docker, no Caddy, no VPS, no GitHub Actions, no Twilio, no Resend, no Backblaze, no Playwright. Port 3100 is canonical (3000 is occupied on this machine) — the `dev` and `start` scripts must pass `-p 3100`.

## 1. Localhost adaptations (deviations from the spec)

| Spec says | This build does |
|---|---|
| Postgres 16 | SQLite via Prisma (`file:./dev.db`) |
| `Decimal` money | **Integer cents** (`cleanCostCents`, `costCents`). € formatting in UI only |
| `@db.Date` date-only columns | **`String` `"YYYY-MM-DD"`** for `Booking.checkinDate/checkoutDate` and `Job.date`. Real `DateTime` for timestamps |
| Twilio WhatsApp + Resend email | `lib/notify.ts` writes a `NotificationLog` row (channel `"console"`) + `console.log`. Same templates and trigger rules as spec §4.3 |
| Real Airbnb iCal feeds | Demo feeds served by the app itself: `GET /api/dev/ical/[key]` renders deterministic `.ics` from `lib/fixtures.ts`. Seeded properties point at these URLs |
| In-Postgres rate-limit table | In-memory `Map` (single process is fine locally) |
| Cron via GitHub Actions | `/api/cron/sync` still exists (Bearer `CRON_SECRET`); locally the admin uses the **Sync now** button |
| HSTS, prod cookie flags | Cookies `secure` only when `NODE_ENV === 'production'`; keep `nosniff` + `X-Frame-Options: DENY` headers |
| node-ical fetches URL | We fetch the text ourselves, parse with node-ical from string |

Everything else stands: route map §4.1, sync algorithm §4.2, notification rules §4.3, authz §6, UI §5.

## 2. Ground rules (every agent)

1. Work only inside this repo. **No git commands, no commits.**
2. Only the Phase-0, integration, and finalize agents may run `npm install`, `prisma migrate`, `npm run build`, or start servers. Phase agents (A1/A2/A3/B1/B2/B3) verify with `npx vitest run <their own test files>` only — the repo will NOT typecheck globally while sibling agents are mid-flight, so do not try.
3. Never edit `package.json` after Phase 0. If you believe a dependency is missing, report it in `issues` instead of installing.
4. Respect the ownership map (§7). Phase-0 files are frozen for A*/B* agents (one exception: A1 may add security headers to `next.config.ts`).
5. TypeScript strict. App Router. Server components read via Prisma directly (guarded with `requireRolePage`); all mutations go through route handlers, called from client components via `lib/client.ts`.
6. Next 15 gotchas: `params` in route handlers and pages is a **Promise** (`const { id } = await params`); `cookies()` from `next/headers` is **async**.
7. Every route handler: zod-validate input → session check via `lib/auth.ts` → for mutations `assertFetchHeader(req)` (return 403 if missing) → act → typed JSON. Errors as `{ error: string }` with correct status. Never leak stack traces.
8. Currency display: cents → `€65` when whole, `€65.50` otherwise.
9. Money is never float. Date-only values are never `Date` objects — always `YYYY-MM-DD` strings compared lexicographically; "today" comes from `lib/dates.ts` (APP_TIMEZONE), never server-local time.

## 3. Dependencies (Phase 0 installs these; the list is final)

- dependencies: `next@^15`, `react@^19`, `react-dom@^19`, `@prisma/client@^6`, `iron-session@^8`, `zod@^3`, `bcryptjs@^2`, `node-ical`
- devDependencies: `prisma@^6`, `typescript@^5`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/bcryptjs`, `tailwindcss@^4`, `@tailwindcss/postcss`, `vitest@^3`, `tsx`
- scripts: `"dev": "next dev -p 3100"`, `"build": "next build"`, `"start": "next start -p 3100"`, `"seed": "tsx prisma/seed.ts"`, `"test": "vitest run"`; plus `"prisma": { "seed": "tsx prisma/seed.ts" }`

## 4. Prisma schema (verbatim — do not alter)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model AdminUser {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
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
  id             String    @id @default(cuid())
  ownerId        String
  owner          Owner     @relation(fields: [ownerId], references: [id])
  nickname       String
  address        String
  icalUrl        String    @unique
  cleanCostCents Int
  directions     String    @default("")
  mapsUrl        String?
  accessCode     String    @default("")
  arriveTime     String
  outByTime      String
  notes          String    @default("")
  active         Boolean   @default(true)
  syncStatus     String    @default("pending") // pending | ok | error
  syncError      String?
  lastSyncAt     DateTime?
  bookings       Booking[]
  jobs           Job[]
  createdAt      DateTime  @default(now())
}

model Cleaner {
  id        String   @id @default(cuid())
  name      String
  phone     String   @unique
  email     String?
  pinHash   String
  active    Boolean  @default(true)
  jobs      Job[]
  createdAt DateTime @default(now())
}

model Booking {
  id           String   @id @default(cuid())
  propertyId   String
  property     Property @relation(fields: [propertyId], references: [id])
  icalUid      String
  checkinDate  String // YYYY-MM-DD
  checkoutDate String // YYYY-MM-DD
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
  date            String // YYYY-MM-DD, always = booking.checkoutDate
  costCents       Int // snapshot of property.cleanCostCents at creation
  cleanerId       String?
  cleaner         Cleaner?  @relation(fields: [cleanerId], references: [id])
  status          String    @default("unassigned") // unassigned|assigned|in_progress|awaiting_confirm|done|cancelled
  sameDayTurnover Boolean   @default(false)
  nextCheckinNote String?
  arrivedAt       DateTime?
  leftAt          DateTime?
  cleanedAt       DateTime?
  paid            Boolean   @default(false)
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
  channel   String // console
  recipient String
  template  String // job_assigned | job_moved | job_cancelled | admin_alert
  status    String // sent | failed
  error     String?
  createdAt DateTime @default(now())
}
```

Hard rules encoded here: `Job.costCents` is snapshotted at creation and never rewritten by price changes. Jobs are never deleted, only status `cancelled` (billing history). Booking upsert key is `(propertyId, icalUid)`.

## 5. Frozen Phase-0 library contracts

`lib/auth.ts` (iron-session sealed cookie; admin session 7d, cleaner 30d rolling):
```ts
export const SESSION_COOKIE = 'cleanturn_session'
export type SessionData = { role: 'admin' | 'cleaner'; id: string }
export async function getSession(): Promise<SessionData | null>
export async function createSession(data: SessionData): Promise<void>
export async function destroySession(): Promise<void>
export async function requireAdminApi(): Promise<SessionData | null>   // null ⇒ handler returns 401 {error:"Unauthorized"}
export async function requireCleanerApi(): Promise<SessionData | null>
export async function requireRolePage(role: 'admin' | 'cleaner'): Promise<SessionData> // redirect('/login') otherwise
export function assertFetchHeader(req: Request): boolean // header X-Requested-With === 'fetch'
```

`lib/db.ts`: `export const prisma` — PrismaClient singleton (globalThis pattern).

`lib/dates.ts`: `todayStr(): string` (YYYY-MM-DD in `APP_TIMEZONE` via Intl) · `addDays(d: string, n: number): string` · `fmtDay(d: string): string` (e.g. "Monday, Jul 6") · `monthOf(d: string): string` ("2026-07").

`lib/client.ts` (importable from client components): `apiFetch<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T>` — JSON in/out, sets `Content-Type` and `X-Requested-With: fetch`, throws `Error(json.error)` on non-2xx.

`lib/fixtures.ts`:
- `demoProperties`: 6 entries — keys `sunset-loft`, `palm-villa`, `marina-studio`, `old-town-2br`, `garden-house`, `beach-flat-5`. Copy nickname/address/cost/access code/arrive/out-by/directions/notes from `docs/prototype.html`. Owners: David Kim (first two), Elena Rossi (next two), Mueller Family (last two) with the prototype's contact/billing notes.
- `demoEvents(key: string, today: string): { uid: string; checkin: string; checkout: string }[]` — deterministic offsets per property: several past checkouts (−9…−1 days), 1–2 checkouts today, several at +1…+6; across the portfolio at least 3 same-day turnover pairs (one booking's checkout equals the next booking's checkin at the same property). Stable uids: `<key>-<n>@cleanturn.demo`.
- `eventsToIcs(events): string` — VCALENDAR with VEVENTs, `SUMMARY:Reserved`, `DTSTART;VALUE=DATE`/`DTEND;VALUE=DATE`. Also append one `SUMMARY:Airbnb (Not available)` VEVENT so the parser must skip it.

`lib/notify.ts` — **implemented by A2, imported by A3 to this exact contract**:
```ts
export async function notifyCleaner(template: 'job_assigned' | 'job_moved' | 'job_cancelled', jobId: string): Promise<void>
export async function notifyAdmin(message: string): Promise<void>
```
Both: load whatever they need themselves, write a `NotificationLog` row, `console.log` the message, **never throw into the caller**. Templates per spec §4.3 — no access codes, no costs in message text.

## 6. Seed (`prisma/seed.ts` — skip everything if an AdminUser already exists)

- Admin from env `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD` (bcrypt cost 12).
- Cleaners: Maria `+15550101` PIN `111111` · Sofia `+15550102` `222222` · Ana `+15550103` `333333` · Lucia `+15550104` `444444` · Carmen `+15550105` `555555` (bcrypt PIN hashes).
- Owners + properties from `lib/fixtures.ts`; `icalUrl` = `${APP_URL}/api/dev/ical/<key>`.
- For every `demoEvents()` event: create Booking + Job exactly as sync would (costCents snapshot, `date` = checkout, sameDayTurnover computed). Past jobs → status `done`, cleaners assigned round-robin, plausible arrived/left/cleaned timestamps, roughly half `paid` (with `paidAt`). Today's jobs → mix: some `assigned`, one `in_progress`, at least one `unassigned`. Future → mix assigned/unassigned.
- Because seeded bookings carry the same icalUids the demo feeds serve, the first "Sync now" is a no-op. That is intentional — it demonstrates sync idempotency.

## 7. Ownership map (do not touch files outside your list)

- **Phase 0**: `package.json`, lockfile, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env`, `.env.example`, `.gitignore`, `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/migrations/**`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx` (role redirect), `app/api/health/route.ts`, `app/api/dev/ical/[key]/route.ts`, `lib/db.ts`, `lib/auth.ts`, `lib/dates.ts`, `lib/client.ts`, `lib/fixtures.ts`
- **A1 (auth)**: `middleware.ts` (coarse: no session cookie on `/admin*` or `/my*` → redirect `/login`), `lib/ratelimit.ts`, `app/api/auth/**`, `tests/ratelimit.test.ts`, plus security headers in `next.config.ts`
- **A2 (sync)**: `lib/ical.ts`, `lib/sync-core.ts`, `lib/sync.ts`, `lib/notify.ts`, `app/api/cron/sync/route.ts`, `app/api/sync-now/route.ts`, `tests/sync.test.ts`
- **A3 (CRUD/jobs)**: `lib/validation.ts`, `lib/state.ts`, `lib/billing.ts`, `app/api/schedule/**`, `app/api/jobs/**`, `app/api/billing/**`, `app/api/properties/**`, `app/api/owners/**`, `app/api/cleaners/**`, `app/api/my/**`, `tests/state.test.ts`, `tests/billing.test.ts`, `tests/visibility.test.ts`
- **B1 (admin shell + schedule + billing)**: `app/admin/layout.tsx`, `app/admin/page.tsx`, `app/admin/billing/**`, `app/admin/_components/**`
- **B2 (admin CRUD pages)**: `app/admin/properties/**`, `app/admin/owners/**`, `app/admin/cleaners/**` (colocate client components inside those dirs)
- **B3 (login + cleaner view)**: `app/login/**`, `app/my/**`

## 8. Env (Phase 0 writes `.env` AND `.env.example`)

`DATABASE_URL="file:./dev.db"` · `SESSION_SECRET=<openssl rand -hex 32>` · `CRON_SECRET=<openssl rand -hex 32>` · `APP_URL=http://localhost:3100` · `APP_TIMEZONE=America/Edmonton` · `ADMIN_EMAIL=admin@cleanturn.local` · `ADMIN_INITIAL_PASSWORD=cleanturn-demo`

## 9. Sync specifics (A2)

- `runSync()` implements spec §4.2 and returns counts `{ created: number; moved: number; cancelled: number; errors: number }`.
- **Local short-circuit**: if a property's `icalUrl` contains `/api/dev/ical/`, do NOT fetch over HTTP — extract the key, generate the ICS text in-process via `lib/fixtures.ts` (`eventsToIcs(demoEvents(key, todayStr()))`), and still run it through `lib/ical.ts` so the parser is exercised. Otherwise: real fetch with 15s timeout, 1 retry, SSRF guard (https only, hostname `airbnb.com` / `*.airbnb.*`), 1MB response cap.
- Moved booking: update Booking + Job.date, keep cleaner & status unless done; if a `done` job's checkout moves to a future date, keep cleaner, reset status to `assigned`, clear arrived/left/cleaned timestamps. Notify `job_moved` when an assigned cleaner exists.
- Disappeared UID with checkout >= today and booking active → cancel Booking + Job, notify `job_cancelled`. Never touch bookings fully in the past.
- Recompute `sameDayTurnover` for all future jobs of the property (another active booking with checkin == job.date); set `nextCheckinNote`.
- Notifications fire only on actual state transitions — a no-op rerun writes **zero** NotificationLog rows.
- Admin alerts (feed failing > 6h, unassigned-within-48h digest), deduped to max 1/day each via NotificationLog lookback → `notifyAdmin`.

## 10. UI notes (B1/B2/B3)

- `app/globals.css` already contains the prototype's `:root` CSS variables and its component classes (`.chip.*`, `.flag`, `.job`, `.ccard`, `.action-btn.*`, `.day-head`, `.owner-group`, `.bill-row`, `.modal*`, `.fgroup`, `.ical-box`, table styles, etc.). Use those classes plus Tailwind utilities. **Do not edit globals.css.**
- The backend is complete and green before you start — read the actual route handlers you call to match request/response shapes exactly.
- Admin schedule defaults to today → +7 days; filters via URL searchParams. Billing status filter defaults to `unpaid`; month filter `YYYY-MM`.
- Access code appears in cleaner API responses only when assigned && |job.date − today| ≤ 1 day (A3 enforces server-side; B3 just renders it when present).
- `/my` action button: optimistic update with rollback on error. After admin mutations: `router.refresh()`.
- Login page: two tabs (Admin email+password / Cleaner phone+PIN), generic error message, redirect by role on success; include a demo-credentials hint box (this is a localhost demo).
- Cleaner view is the product: design for 375px width, big tap targets.

## 11. Definition of done (finalize gate)

`npx tsc --noEmit` clean · `npx vitest run` all green · `npm run build` clean · live smoke on a booted server: health OK; unauthenticated API → 401; admin login + schedule; **Sync now twice → second run returns all-zero counts**; cleaner isolation (Maria sees only her jobs, cross-cleaner status PATCH rejected, no icalUrl/owner data in her responses); access-code ±1-day rule; billing totals + mark-owner-paid; login rate limiter returns 429 after 5 failures · README quick-start is accurate.
