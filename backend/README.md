# Table Reservation — Backend

## Overview

HTTP JSON API for a single restaurant: staff sign-in (JWT), tables, weekly service hours and
closed dates, plus public availability lookups and guest reservations with automatic table
assignment. Express 5 + Mongoose + Zod, strict TypeScript (ESM). The OpenAPI document is
generated from the Zod schemas and is the contract with the future frontend.

Code layout (`src/modules/<module>/`): `*.routes.ts` declares each operation with
`defineRoute` (path, auth, schemas, docs, error codes), `*.controller.ts` holds the HTTP
handlers, `*.service.ts` the business logic and persistence, `*.model.ts` the Mongoose model
and `*.domain.ts` pure rules. Cross-cutting code lives in `src/shared/`.

## Requirements

- Node.js 24 LTS (minimum 22.12)
- MongoDB for running the server (local `mongod`, Docker `mongo:8` or Atlas). The tests need
  no running database.

## Setup

```bash
cd backend
npm install
cp .env.example .env     # then edit the values
npm run seed:staff       # create the first staff account (see below)
npm run dev
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Starts the server with reload (`tsx watch`), loading `.env` if present. |
| `npm run build` | Compiles to `dist/` with `tsc`. |
| `npm start` | Runs the compiled server (`dist/src/server.js`), loading `.env` if present. |
| `npm test` | Runs every test once (Vitest: unit, integration, contract). |
| `npm run test:watch` | Runs the tests in watch mode. |
| `npm run typecheck` | Type-checks without emitting (`tsc --noEmit`). |
| `npm run lint` | Lints with ESLint + typescript-eslint. |
| `npm run seed:staff` | Creates a staff account from `STAFF_*` variables (idempotent). |

## Configuration

All configuration comes from environment variables (`.env` is loaded with Node's
`--env-file-if-exists`). They are validated at startup: on any invalid value the process
prints **every** invalid key and exits with code 1 before connecting to anything. Never commit
`.env`; `.env.example` holds placeholders only.

| Key | Required | Default | Rule |
|---|---|---|---|
| `MONGODB_URI` | yes | — | Non-empty MongoDB connection string. |
| `JWT_SECRET` | yes | — | At least 32 characters. |
| `JWT_EXPIRES_IN` | no | `8h` | `<integer><s\|m\|h\|d>`, e.g. `30m`, `8h`, `2d`. |
| `RESTAURANT_TIME_ZONE` | yes | — | IANA time zone (e.g. `Europe/Madrid`) or `UTC`. Decides "today" for closed dates. |
| `CORS_ORIGINS` | no | `http://localhost:5173` | Comma-separated list of allowed origins; each must be a URL. |
| `PORT` | no | `3000` | Integer 1–65535. |
| `RESERVATION_DURATION_MINUTES` | no | `120` | Whole number 15–480. Length of every reservation. |
| `TIME_SLOT_INTERVAL_MINUTES` | no | `15` | Whole number 5–120. Spacing of the start times listed by `GET /availability/times`. |
| `MIN_NOTICE_MINUTES` | no | `60` | Whole number 0–1440. A reservation must start at least this long after now (`0` = no minimum). |
| `BOOKING_HORIZON_DAYS` | no | `60` | Whole number 1–365. How many days ahead (today plus this many, inclusive) can be booked. |
| `SMTP_URL` | no | unset | `smtp://` or `smtps://` URL of the mail server (may hold credentials: it is never logged). Unset = emails are **skipped** and only logged as `email_skipped`. |
| `EMAIL_FROM` | iff `SMTP_URL` | — | Sender mailbox, `a@b.c` or `Name <a@b.c>`. Required when `SMTP_URL` is set, ignored otherwise. |
| `EMAIL_TIMEOUT_MS` | no | `10000` | Whole number 100–120000. A send that takes longer is abandoned and logged as `EmailTimeout`. |
| `RESTAURANT_NAME` | no | `the restaurant` | 1–100 characters; used in the email subjects and bodies. |
| `CANCEL_LINK_BASE_URL` | no | `http://localhost:5173/cancel` | `http(s)` URL without a fragment. The confirmation email links to `<this>#code=<secret code>`. |
| `STAFF_NAME` | seed only | — | 1–100 characters after trimming. |
| `STAFF_EMAIL` | seed only | — | Valid email; stored trimmed and lowercased. |
| `STAFF_PASSWORD` | seed only | — | 1–1024 characters. Stored only as a scrypt hash. |

The four booking-rule keys are digits only (`""`, `1.5`, `-1` and `1e2` are refused) and, like
the rest, are checked at startup. "Now", "today", the notice and the horizon are evaluated in
`RESTAURANT_TIME_ZONE`; reservation instants are stored in UTC.

## Public operations (no sign-in)

| Operation | What it does |
|---|---|
| `GET /availability?date=&time=&partySize=` | Yes/no for a party at a time, with a `reason` when it cannot be seated: `too_soon`, `too_far_ahead`, `closed_date`, `closed_day`, `outside_service_hours`, `party_too_large`, `no_table_free` (first applicable, in that order). The table is never revealed. |
| `GET /availability/times?date=&partySize=` | Bookable start times of a date, grouped by service period; an empty list carries one `reason`. Every listed time is accepted by the other two operations if nothing changed in between. |
| `POST /reservations` | Creates a confirmed reservation and assigns the smallest suitable free table (then natural name order). The response includes a `secretCode` that is shown **only there**: it is stored only as a SHA-256 hash and never logged or returned again. The guest also gets a confirmation email (see below). |
| `POST /reservations/cancel` | Cancels an upcoming confirmed reservation with the secret code, sent **only in the body**. |

Refusals of `POST /reservations`: `400 VALIDATION_ERROR`; `409 CONFLICT` with
`details.reason = "duplicate_reservation"` (the same email, trimmed and lowercased, already
holds an overlapping reservation); `409 NO_AVAILABILITY` with `details.reason` (any of the
reasons above; `no_table_free` also means the request lost a race for the last table). The
answers are snapshots (`Cache-Control: no-store`).

Staff operations changed by this feature: `DELETE /tables/{id}` answers
`409 CONFLICT` (`table_has_upcoming_reservations`) while the table holds a reservation that has
not ended; `POST /closed-dates`, `PUT /schedule` and `PATCH /tables/{id}` are applied even when
they contradict upcoming reservations and list them in `affectedReservations` (confirmed
reservations only, each with `status: "confirmed"`; the change itself never modifies, moves or
cancels them, staff cancel them one by one with `POST /reservations/{id}/cancel`).

## Confirmation email and cancellation

After a successful `POST /reservations` the guest receives a **confirmation email** (details, a
link `CANCEL_LINK_BASE_URL#code=<code>` and the code as text; never the table name). It is sent
in the background: a slow or failing mail server never delays or changes the response, a failure
is logged as one `email_failed` JSON line (kind, reservation id, short reason, time; never the
code, the address, the name or the server message), and nothing is retried.

```bash
# Guest: the code goes in the body, never in the URL
curl -X POST http://localhost:3000/reservations/cancel   -H 'Content-Type: application/json' -d '{"code":"<secret code>"}'

# Staff: bearer token required, no body
curl -X POST http://localhost:3000/reservations/<id>/cancel   -H "Authorization: Bearer $TOKEN"
```

Both answer `200 { id, status: "cancelled", date, startTime, endTime, partySize, cancelledAt }`
(`Cache-Control: no-store`) and send the guest a cancellation email (`You cancelled` /
`The restaurant cancelled`, no code, no link). Refusals: `404 NOT_FOUND` ("Reservation not
found", one answer for every unknown code or id), `409 ALREADY_CANCELLED` (safe to repeat),
`409 CANNOT_CANCEL` (the start time has been reached), `401` (staff only), `400` (guest body).
A cancelled reservation stays stored but frees its table and the guest's slot and no longer
counts in any rule or report.

To see the emails locally run [Mailpit](https://mailpit.axllent.org) and point the app at it:

```bash
docker run -p 1025:1025 -p 8025:8025 axllent/mailpit
# .env: SMTP_URL=smtp://localhost:1025  EMAIL_FROM=reservations@example.test
# inbox at http://localhost:8025
```

## Staff accounts

There is no API to create staff. Run:

```bash
npm run seed:staff
```

It reads `MONGODB_URI` and `STAFF_NAME` / `STAFF_EMAIL` / `STAFF_PASSWORD`, normalizes the
email, and prints `created` or `already exists`. It is idempotent: running it again with the
same email (in any case or with spaces) changes nothing, including the stored name and
password. An invalid variable is reported before connecting (exit code 1).

## Testing

```bash
npm test
```

Tests use [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server): one
in-memory `mongod` per run, with a separate database per test file. On the **first run** it
downloads a `mongod` binary (network access needed once; cached under
`~/.cache/mongodb-binaries`). Suites:

- `tests/unit/` — pure functions (config, normalization, password, schedule and date rules).
- `tests/integration/` — every user story through HTTP, including the concurrency suites
  (20 simultaneous requests × 50 rounds for one table) and a p95 latency smoke test (SC-006,
  with 100 tables, 500 closed dates and 10,000 reservations).
- `tests/contract/` — SC-002 (every protected operation refuses requests without a token),
  SC-003 (every error has the standard shape), SC-004 (the OpenAPI document matches the
  mounted routes, fully described).

On Windows, running the whole suite many times in a few minutes can exhaust the ephemeral TCP
ports (`EADDRINUSE`) because closed connections linger in `TIME_WAIT`. The heavy suites reuse
connections (`tests/helpers/keep-alive.ts`), so a few consecutive runs are fine; if it happens,
wait a couple of minutes.

## API docs

- Swagger UI: `http://localhost:3000/docs` — sign in with `POST /auth/login`, copy `token`,
  click **Authorize**, paste it, then call any protected operation. The token survives page
  reloads.
- OpenAPI 3.1 document: `http://localhost:3000/openapi.json`.
- Design-time contract: [`specs/001-restaurant-setup/contracts/api.md`](../specs/001-restaurant-setup/contracts/api.md).

## Known debt

Accepted for this feature (see the spec's assumptions):

- **No sign-in rate limiting or lockout.** Repeated login attempts are not throttled; there is
  no `429`.
- **No server-side token revocation.** Sign-out means the client discards its token; a token
  stays valid until `expiresAt`, unless its staff account is deleted.
- **No token refresh.** After `expiresAt` the client signs in again.

Added by the reservations feature:

- **No rate limiting or abuse protection on the public operations.** `GET /availability`,
  `GET /availability/times` and `POST /reservations` are open and unthrottled.
- **Retries have no idempotency key.** Repeating a `POST /reservations` whose success response
  was lost is refused as `409 duplicate_reservation`, and the secret code cannot be recovered.
  A retry after a `500` can also be refused as a duplicate if an orphan hold remains (below).
- **Orphan holds (FR-031).** Reservations are protected from double booking by per-day
  documents (`tabledays` per table, `guestdays` per email) whose `intervals` are claimed with an
  atomic conditional update; there are no transactions on a plain `mongod`. An *orphan* is an
  interval whose `reservationId` has no document in `reservations`. It can appear when the
  process stops between claiming and storing, when releasing an interval fails after another
  failure, or when the database could not confirm whether a reservation was stored (the hold is
  then kept on purpose). An orphan only **hides** a time: it can never allow a double booking.
  Effects: that table (or that email) looks taken for the interval, and an orphan table interval
  blocks removing the table. In the normal flow intervals live for milliseconds, so one that
  has not ended and was created more than a few minutes ago is an orphan.

  List them in `mongosh` (read-only; intervals that have not ended and whose reservation does
  not exist):

  ```js
  const orphans = (collection) =>
    db[collection].aggregate([
      { $unwind: "$intervals" },
      { $match: { "intervals.end": { $gt: new Date() } } },
      { $lookup: { from: "reservations", localField: "intervals.reservationId",
                   foreignField: "_id", as: "reservation" } },
      { $match: { reservation: { $size: 0 } } },
      { $project: { _id: 0, tableId: 1, email: 1, date: 1, interval: "$intervals" } },
    ]).toArray();
  orphans("tabledays");   // table holds
  orphans("guestdays");   // guest holds
  ```

  Remove one by hand (use the `date`, the `tableId` or `email`, and the `reservationId` printed
  above; check first that it is old enough and that `db.reservations.findOne({ _id: … })` is
  `null`):

  ```js
  db.tabledays.updateOne({ tableId: ObjectId("…"), date: "2026-11-14" },
                         { $pull: { intervals: { reservationId: ObjectId("…") } } });
  db.guestdays.updateOne({ email: "guest@mail.com", date: "2026-11-14" },
                         { $pull: { intervals: { reservationId: ObjectId("…") } } });
  ```

  Replica-set transactions are the long-term fix.
- **A table removal whose restore failed (FR-029).** `DELETE /tables/{id}` removes the table, then
  re-checks for a reservation that raced in; if one did, it puts the table back. If putting it
  back fails (twice), the staff member gets `500 INTERNAL_ERROR` and the table **stays
  removed**. Reservations keep referring to it and no double booking is possible. Recreate the
  table with the same name (the name was freed) or restore it in `mongosh`:
  `db.tables.updateOne({ _id: ObjectId("…") }, { $set: { removed: false, removedAt: null } })`.
- **`PUT /schedule` scans every upcoming reservation** to build `affectedReservations` (the
  check runs inside MongoDB and only the affected reservations are returned). With 10,000
  upcoming reservations its p95 is about 0.25 s in the performance test (limit 1 s); the cost
  grows linearly with the number of upcoming reservations.

Added by the confirmation email and cancellation feature:

- **A failed release leaves a `cancelled` reservation holding its intervals** (`500
  INTERNAL_ERROR`, no email) until a repeated cancellation request repairs it (it then answers
  `409 ALREADY_CANCELLED`). Until then the time looks taken; it can never cause a double booking.
- **Failed emails are not retried.** There is no queue; the failure is only logged.
- **No rate limiting on `POST /reservations/cancel`.** The secret code has 256 random bits, so
  guessing is not practical, but the operation is open and unthrottled.
- **SMTP is optional.** Without `SMTP_URL` emails are skipped and only an `email_skipped` line is
  logged, so a guest never receives their code by email in that setup.
