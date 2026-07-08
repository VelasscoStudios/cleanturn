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

## Cleanup

Delete any users/rows you created (via the same API with the admin jar) so the dev DB stays as you found it.
