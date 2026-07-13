---
name: verify
description: How to run and drive CleanTurn locally to verify changes end-to-end (dev server, admin/cleaner login, API curl recipes, Playwright UI click-through).
---

# Verifying CleanTurn changes

## Launch

```bash
npm run dev            # next dev on http://localhost:3100
```

Check first whether something already listens on 3100 (`lsof -nP -iTCP:3100 -sTCP:LISTEN`) — a dev server is often already running and hot-reloads edits.

## Dev credentials

The local admin comes from `.env` (`ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD`), seeded into `prisma/dev.db`. Don't assume the seed defaults — read `.env`. Cleaners log in with phone + 6-digit PIN.

## Driving the API with curl

All mutating routes require the `X-Requested-With: fetch` header (CSRF guard) and the session cookie:

```bash
curl -s -c admin.jar -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_INITIAL_PASSWORD>"}' \
  http://localhost:3100/api/auth/admin/login
curl -s -b admin.jar http://localhost:3100/api/admins   # then hit any admin API
```

Gotcha: login is rate-limited (5 per 15 min per IP+email and per email); successes clear the counters, but don't burn failed attempts carelessly.

## Driving the UI with Playwright

No project Playwright dep. Use the npx cache install with an explicit browser binary:

```js
import { chromium } from "file:///Users/christianvelasco/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
const browser = await chromium.launch({
  executablePath: "/Users/christianvelasco/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
});
```

(Adjust paths if versions moved: `find ~/.npm/_npx -maxdepth 3 -name playwright -type d`, `ls ~/Library/Caches/ms-playwright`.)

- Login form fields: `#admin-email`, `#admin-password`, then `button[type="submit"]`; wait for `**/admin`.
- Modals close via CSS class only — the DOM element stays mounted. Wait for table content with scoped selectors (`tbody b:has-text(...)`), never bare `text=` (it substring-matches hidden modal text too).
- Click buttons with `button:has-text("...")`, not `text=...`.

## Driving the sync loop (bookings/cancellations)

Dev properties point at `/api/dev/ical/<key>` feeds generated from `lib/fixtures.ts` (`demoEvents`); UIDs are `<key>-<index>@cleanturn.demo`. To simulate a new booking, append a `[checkinOffset, checkoutOffset]` pair to a property's plan (new index → new UID → create); removing it again simulates a cancellation. Trigger syncs with `POST /api/cron/sync` + `Authorization: Bearer <CRON_SECRET from .env>`.

Gotcha: `next dev` hot-reloads `fixtures.ts` asynchronously — a sync fired immediately after the edit may still see the old feed. Poll the sync until the expected counts appear instead of asserting on the first call.

Schedule page assertions: jobs render as `.job` divs, status chips as `.chip.<status>` (e.g. `.chip.cancelled`). Use `/admin?days=14` to widen the window. A cancelled UID that reappears in the feed is deliberately NOT resurrected — delete its booking+job rows via prisma before re-testing a create with the same UID.

## Cleanup

Delete any users/rows you created (via the same API with the admin jar, or prisma directly) so the dev DB stays as you found it, and restore any fixture edits.
