# CleanTurn — MVP Spec
**Airbnb cleaning scheduler for property managers**
Version 0.1 · July 2026 · Owner: Admin

---

## 1. Problem

Today's workflow: check every Airbnb calendar manually → copy check-ins/check-outs into Excel → assign cleaners → screenshot filtered views → send to each cleaner over WhatsApp → repeat daily. At 30+ properties and 8+ cleaners this takes significant time every day and is error-prone (missed bookings, stale screenshots after changes).

## 2. Solution in one sentence

The app pulls bookings automatically from each property's Airbnb iCal feed, turns every checkout into a cleaning job on that day, lets the admin assign a cleaner from a dropdown, and gives each cleaner a login where they see only their jobs and tap three status buttons.

## 3. Users & roles

| Role | Access |
|---|---|
| **Admin** | Everything: properties, owners, cleaners, schedule, assignments, billing |
| **Cleaner** | Only their own assigned jobs; can update job status |
| **Owner** | *Not a login in v1.* Owners exist as records for billing; they don't access the app. (Owner read-only portal = possible phase 2.) |

No self-registration. Admin creates cleaner accounts.

## 4. Core logic

### 4.1 Booking sync
- Each property has one **Airbnb iCal URL** (Calendar → Availability → Connect calendars → Export).
- A sync job fetches every feed **every 30 minutes** (Airbnb refreshes feeds roughly every 2–3 hours; more frequent polling adds nothing).
- Each iCal event = one booking with check-in and check-out dates. Airbnb feeds do not include guest names — only "Reserved" and a reservation URL. That's fine for cleaning purposes.

### 4.2 Job generation (the rule)
> **Every checkout creates one cleaning job on the checkout day.** (Per your rule: always clean on checkout day.)

- If a new booking appears → job auto-created, status `Unassigned`.
- If a booking's checkout date moves → the job moves with it; if already assigned, the assignment is kept and the cleaner is notified of the date change.
- If a booking is cancelled (event disappears from feed) → job is cancelled; assigned cleaner is notified.
- **Same-day turnover flag:** if another booking checks in on the same day at the same property, the job shows an urgent ⚡ badge. Cleaner sees "guest arrives today."

### 4.3 Job statuses (cleaner taps, in order)
1. `Assigned` → cleaner taps **"Arrived"** → `In progress`
2. Taps **"Left"** → `Awaiting confirm` *(optional step — can be merged with 3 if you prefer 2 buttons)*
3. Taps **"Unit clean"** → `Done` ✅

Admin sees status changes live on the dashboard. Timestamps are recorded for each tap (useful later for payroll/duration).

## 5. Screens

### 5.1 Admin — Schedule (home screen)
- Day-by-day list (default: today + next 7 days). Filters: property, cleaner, unassigned-only.
- Each row: property nickname + address · cleaning window (arrive/out-by) · cost per clean · same-day ⚡ flag · **cleaner dropdown** · status chip.
- Assigning from the dropdown = the whole workflow. One click replaces the Excel + screenshot ritual.
- Red counter at top: "3 unassigned cleans in next 48h."

### 5.2 Admin — Properties
- Add/edit per property:
  - **Owner** — dropdown of owners; every clean at this property is billed to them.
  - **Nickname + address**
  - **iCal URL**
  - **Cleaning cost** — fixed price per clean (e.g. €65). Every job inherits it; sums shown per cleaner/period later make payroll trivial.
  - **Directions** — free text and/or a Google Maps link (parking, entrance, "blue gate behind the bakery").
  - **Security/access code** — door code, lockbox code, alarm code. Shown to the cleaner only on their assigned job.
  - **Cleaning window** — expected arrival time and must-be-out-by time (e.g. arrive 11:00, out by 16:00). Shown prominently on the cleaner's job card.
  - **Notes** — linen location, supplies, quirks.
- All jobs are assigned manually via the dropdown (no default/auto cleaner).
- "Last synced" timestamp + error badge if a feed fails.

### 5.3 Admin — Cleaners
- Add/edit: name, phone (WhatsApp), email, PIN/password.
- Toggle active/inactive.

### 5.4 Admin — Owners
- Add/edit: name, email, phone, billing notes (e.g. "pays monthly by transfer").
- Shows their properties and outstanding balance.

### 5.5 Admin — Billing (paid vs unpaid)
- Every **completed** clean becomes a billable line: property · date · cost · owner · **Unpaid / Paid** status.
- View grouped **by owner**, split into two buckets: **Unpaid** (with running total per owner) and **Paid**.
- One click: **Mark paid** per clean, or **"Mark all paid"** per owner (e.g. after their monthly transfer). Records `paid_at`.
- Filter by month; owner totals at a glance answer "who owes me what?".
- Export/statement per owner (simple CSV or printable page) = phase 1.5 — data model already supports it.

### 5.6 Cleaner — My Jobs (mobile-first)
- Login: phone number + PIN (keep it dead simple).
- Today's jobs on top, then upcoming. Each card shows: property nickname · address (tap → opens Google Maps) · **directions** · **security/access code** · **cleaning window ("Arrive 11:00 — out by 16:00")** · **pay for the clean (€)** · notes · ⚡ flag if same-day turnover · the current status button.
- One big button per card showing the *next* action: **Arrived → Left → Unit clean**.
- Nothing else. No settings, no chat, no calendar view in v1.

## 6. Notifications

| Event | Cleaner gets |
|---|---|
| Job assigned to them | WhatsApp/SMS + email: "New clean: {property}, {date}. See your schedule: {link}" |
| Job date changed | Same channels, "Clean moved to {date}" |
| Job cancelled | Same channels |
| Daily 7:00 digest (optional, phase 1.5) | "You have {n} cleans today: {list}" |

Admin gets an email if: an iCal feed fails to sync for >6h, or a checkout in the next 48h is still unassigned.

- In-app = the source of truth (the cleaner's job list is always current).
- WhatsApp via Twilio's WhatsApp API (or plain SMS fallback). This is the only paid external dependency (~$0.005–0.05/message).

## 7. Data model (minimal)

```
Owner      id, name, email, phone, billing_notes, active
Property   id, owner_id, nickname, address, ical_url, clean_cost, directions, maps_url?,
           access_code, arrive_time, out_by_time, notes, active
Cleaner    id, name, phone, email, pin_hash, active
Booking    id, property_id, ical_uid, checkin_date, checkout_date, status(active|cancelled)
Job        id, booking_id, property_id, date, cleaner_id?, cost(snapshot of clean_cost at creation),
           status(unassigned|assigned|in_progress|awaiting_confirm|done|cancelled),
           same_day_turnover(bool), arrived_at?, left_at?, cleaned_at?,
           paid(bool, default false), paid_at?
```

Billing is derived, not duplicated: a job's owner = its property's owner; the Billing screen is just `Job WHERE status=done` grouped by owner and `paid`.

`Job.cost` is snapshotted at creation so changing a property's price later doesn't rewrite history — done jobs keep the price they were cleaned at.

Jobs are derived from bookings but stored separately so assignments/status survive re-syncs. Sync matches on `ical_uid`.

## 8. Tech recommendation (MVP)

Keep it boring and cheap:

- **One web app** (responsive; cleaners use it on their phones — no app store needed). Suggested stack: Next.js (or plain Node/Express + a few pages) + SQLite/Postgres, hosted on Railway/Render/Fly (~$5–10/mo).
- **Cron job** every 30 min: fetch iCals (they're plain text files — trivial to parse with an ical library), upsert bookings, regenerate jobs, fire notifications on diffs.
- **Auth:** admin = email+password; cleaners = phone+PIN. Session cookie. No OAuth, no magic links.
- **Notifications:** Twilio (WhatsApp/SMS) + any SMTP for email.

Rough build effort for a competent developer: **1–2 weeks** for everything above.

### Explicitly OUT of scope for v1
Payment processing/payroll export (costs are recorded per job, so a "total per cleaner per month" report is an easy phase 1.5 add), photos of completed cleans, inventory/linen tracking, multi-admin, cleaner availability/shift management, any auto-assignment (all assignments are manual by design), native mobile apps, Airbnb API integration (iCal is enough), other platforms (Vrbo/Booking.com iCals can be added later — same mechanism).

## 9. Success criteria

- Zero manual calendar checking: bookings appear on their own.
- Daily scheduling ritual drops from ~30–60 min to <5 min (just filling the cleaner dropdowns).
- No more screenshots: cleaners self-serve their live schedule.
- The admin can see at a glance what's unassigned and what's done today.
- "Who owes me what?" answered in one screen — no reconciling Excel against bank transfers.

## 10. Buy-vs-build note

Tools like Turno (TurnoverBnB), Breezeway, and ResortCleaning already do this for ~$6–10/property/month. At 30+ properties that's ~$200–300+/mo, and they bundle features you don't want. Building the MVP above costs ~$10/mo to run and matches your exact workflow — but it's worth a 30-minute trial of Turno before committing to a build, purely as due diligence.
