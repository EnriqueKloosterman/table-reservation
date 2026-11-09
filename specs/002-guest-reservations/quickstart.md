# Quickstart: Availability Lookup and Guest Reservations

**Feature**: `002-guest-reservations` | **Plan**: [plan.md](./plan.md) |
**Contract**: [contracts/api.md](./contracts/api.md) | **Data model**: [data-model.md](./data-model.md)

How to run and check this feature end to end. Setup is the one from
[001 quickstart](../001-restaurant-setup/quickstart.md); only the differences are listed.

## Prerequisites

Same as 001: Node.js 24 LTS, `npm install` in `backend/`. Tests need no database. Manual runs
need a plain `mongod` (no replica set required).

## New configuration

Optional keys in `backend/.env` (defaults shown, all integers):

```env
RESERVATION_DURATION_MINUTES=120   # 15–480
TIME_SLOT_INTERVAL_MINUTES=15      # 5–120
MIN_NOTICE_MINUTES=60              # 0–1440
BOOKING_HORIZON_DAYS=60            # 1–365
```

Fail-fast check: `RESERVATION_DURATION_MINUTES=10 npm run dev` → the process exits with code
1 and names `RESERVATION_DURATION_MINUTES`.

## Validation scenarios

### 1. Automated suite (primary check)

```bash
cd backend
npm test && npm run typecheck && npm run lint
```

Expected: all green, including:

- `tests/unit/local-time.test.ts` — DST gaps/folds for America/New_York and Europe/Madrid
  (2026), and a zone without DST.
- `tests/unit/availability.domain.test.ts` — one case per reason, precedence, grid, SC-004
  invariant.
- `tests/integration/reservations.concurrency.test.ts` — SC-002 (20 × 50 rounds), same-email
  race, candidate fallback; `reservation-protection.races.test.ts` — table-removal race in both
  orderings, removal revert, staff changes racing a reservation.
- `tests/contract/*` — 17 operations, 6 public, standard error shape for the new codes.
- `tests/integration/performance.test.ts` — SC-006 with 10,000 seeded reservations.
- `tests/integration/orphan-holds.test.ts` — the `mongosh` listing and cleanup from the README.

### 2. End to end through `/docs` (SC-001, US5)

1. `npm run seed:staff`, `npm run dev`, open `http://localhost:3000/docs`.
2. Sign in (`POST /auth/login`), authorize, then as staff: create tables `T2` (cap 2),
   `T4` (cap 4), `T6` (cap 6); `PUT /schedule` with Saturday Lunch 12:00–15:00 and Dinner
   20:00–23:30; `POST /closed-dates` for an upcoming date.
3. Log out of the docs UI (clear authorization). Without a token:
   - `GET /availability/times?date=<next Saturday>&partySize=2` → Lunch 12:00…13:00 every
     15 min, Dinner 20:00…21:30.
   - `GET /availability?date=<next Saturday>&time=21:45&partySize=4` →
     `available: false`, `reason: "outside_service_hours"`.
   - `POST /reservations` for 3 at 20:30 → `201`, `table.name: "T4"`, `endTime: "22:30"`,
     a 43-character `secretCode`.
   - Repeat the same body → `409 CONFLICT`, `details.reason: "duplicate_reservation"`.
   - Same time, different email, party 8 → `409 NO_AVAILABILITY`, `party_too_large`.
   - Times list for party 4 now excludes the dinner times overlapping 20:30–22:30 only if no
     other table seats 4 (`T6` still does, so they remain).
4. As staff again:
   - `DELETE /tables/<T4 id>` → `409 CONFLICT`, `table_has_upcoming_reservations`.
   - `PATCH /tables/<T4 id>` `{ "capacity": 2 }` → `200` with the reservation in
     `affectedReservations`; the reservation is unchanged.
   - `POST /closed-dates` for that Saturday → `201` listing it; `GET /availability` for that
     date → `closed_date`.

Note: the docs UI "Try it out" sends the same requests as `curl`; on Windows consoles `curl`
may mangle non-ASCII characters in a typed body (use a UTF-8 file with `-d @body.json`).

### 3. Confirm the secret code is not stored in plain text

In `mongosh`: `db.reservations.findOne()` shows `secretCodeHash` (64 hex chars) and no
`secretCode`; no API response other than the creation one contains either field.

## Known debt (also in `backend/README.md`)

- A crash between claiming an interval and inserting the reservation can leave an orphan
  interval that blocks that table/guest time (and table removal) until removed by hand.
  Replica-set transactions are the long-term fix ([research R5](./research.md#r5-enforcing-no-two-overlapping-reservations-per-table-without-transactions)).
- No rate limiting or abuse protection on the public operations.
- A table removal whose restore failed leaves the table removed (`500`); see the README.
