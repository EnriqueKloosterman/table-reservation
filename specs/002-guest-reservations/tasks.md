---

description: "Task list for feature 002-guest-reservations (Availability Lookup and Guest Reservations)"
---

# Tasks: Availability Lookup and Guest Reservations

**Input**: Design documents from `/specs/002-guest-reservations/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle II (Test-First, NON-NEGOTIABLE): Vitest + Supertest tests are written first and **observed failing (RED)** before implementation, with mongodb-memory-server for persistence. Every story phase starts with test tasks followed by an explicit "run and confirm RED" task. Verification-only suites (`auth-coverage`, `error-shape`, `performance`) may pass when first extended; they prove they can fail through the same temporary mutation check used in 001 (plan.md "Complexity Tracking").

**Organization**: Tasks are grouped by user story. Foundational code (config, errors, time, pure domain, models, claims) is shared by all stories and has its own tests first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 (user stories of spec.md)
- All paths are relative to the repository root; all code lives under `backend/`

## Conventions used by every task

- **No new dependencies** (plan.md, research R15): `Intl`, `node:crypto` and Mongoose only.
- Module layering as in 001: `*.routes.ts` only declares operations with `defineRoute` and sets `handler: controller.<name>`; HTTP handlers live in `*.controller.ts` (`create<Module>Controller(deps)`, typed with `RouteHandler<P, Q, B>`, reading `res.locals.input`); services stay HTTP-free; pure logic lives in `*.domain.ts`.
- ESM + TypeScript strict (`nodenext`): relative imports use the `.js` extension. Schema modules import `z` from `backend/src/shared/openapi/zod.ts`, never from `zod`.
- Error body shape: `{ "error": { "code", "message", "details"? } }`. New code `NO_AVAILABILITY` → 409 with `details: { reason }`; new `CONFLICT` cases carry `details: { reason: "duplicate_reservation" | "table_has_upcoming_reservations" }`; 001 `CONFLICT` cases keep no details.
- Reasons (closed set, snake_case): `too_soon`, `too_far_ahead`, `closed_date`, `closed_day`, `outside_service_hours`, `party_too_large`, `no_table_free`.
- Check order: route match (404) → auth (401, staff only) → validation (400) → not found (404) → duplicate / conflict (409 `CONFLICT`) → availability (409 `NO_AVAILABILITY`). Validation completes before any read or write.
- Instants (`startAt`, `endAt`, `createdAt`) are UTC `Date`s; `date` (`YYYY-MM-DD`), `startTime`/`endTime`/`time` (`HH:mm`) are restaurant-local text. "Now" always comes from the injected `Clock`, never `Date.now()` directly.
- Overlap rule (everywhere): `a.start < b.end && b.start < a.end` (half-open).
- Every integration test pins `now` with a fixed clock; at least one file uses a non-UTC `RESTAURANT_TIME_ZONE`.
- Fixtures: a period must be long enough for the scenario (e.g. dinner 18:00–23:30); with the default 120 minutes a 22:00 start never fits, so the spec's "18:00–22:00 then 22:00" scenarios are tested as 18:00–20:00 held, 19:00 refused, 20:00 accepted (research R14).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new directories. Nothing to install.

- [X] T001 Create the directories `backend/src/shared/time/`, `backend/src/modules/availability/` and `backend/src/modules/reservations/`; no `package.json` change and no new package

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config keys, error code, time helpers, pure availability domain, models and atomic claims that every story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests first (write, then confirm RED)

- [X] T002 [P] Extend `backend/tests/unit/env.test.ts`: `RESERVATION_DURATION_MINUTES` (default 120), `TIME_SLOT_INTERVAL_MINUTES` (default 15), `MIN_NOTICE_MINUTES` (default 60), `BOOKING_HORIZON_DAYS` (default 60) parse as whole numbers from strings within the research R1 ranges (`RESERVATION_DURATION_MINUTES` 15–480, `TIME_SLOT_INTERVAL_MINUTES` 5–120, `MIN_NOTICE_MINUTES` 0–1440 so `0` means no minimum notice, `BOOKING_HORIZON_DAYS` 1–365), bounds included; negatives, decimals, empty and non-numeric values and anything outside the range fail fast with a clear message naming the key (so `0` is refused for every key except `MIN_NOTICE_MINUTES`, and values above 1440 are refused everywhere); the existing default-config `toEqual` is updated to include the four keys
- [X] T003 [P] Create `backend/tests/unit/local-time.test.ts` for `localToUtc`, `utcToLocal`, `addDays`, `dayOfWeek`, `overlaps` (research R2/R3/R4): round trip in UTC, `Europe/Madrid` and `America/New_York`; DST gap (e.g. 2026-03-29 02:30 Madrid) → `null`; DST fold (2026-10-25 02:30 Madrid) → the first (earlier) instant; `addDays` across month/year/leap day; `dayOfWeek("2026-11-14") === "saturday"`; `overlaps` true for intersecting ranges, false when ranges touch (`22:00` end vs `22:00` start), true for containment
- [X] T004 [P] Create `backend/tests/unit/availability.domain.test.ts` for `checkAvailability` over a `DaySnapshot` (data-model.md): one case per reason (`too_soon` past date and notice boundary, `too_far_ahead` with the inclusive horizon day still allowed, `closed_date`, `closed_day`, `outside_service_hours` including 21:30 available / 21:45 refused for dinner 20:00–23:30 with 120 minutes, and a DST-gap time, `party_too_large` also with zero tables, `no_table_free`); precedence pairs per research R7 (every adjacent pair of reasons applying together reports the earlier one); touching-end intervals do not overlap; available answer returns ordered candidate tables; a removed table is never in `snapshot.tables`
- [X] T005 [P] Create `backend/tests/unit/availability-times.domain.test.ts` for `listBookableTimes`: grid from period start every `slotIntervalMinutes` up to the last start that ends by period end (lunch 12:00–15:00 → 12:00…13:00); periods grouped in chronological order with stored names; only periods with at least one time appear; empty-list reason order of FR-008 (date before today → `too_soon`, `too_far_ahead`, `closed_date`, `closed_day`, `party_too_large`, then `outside_service_hours` when no period is long enough, then `too_soon` when minimum notice removes every remaining time, else `no_table_free`); non-empty list has no reason; **SC-004 property test**: over a full week including a closed date, DST dates and partially booked tables, every listed time passes `checkAvailability` and every grid time that passes is listed
- [X] T006 [P] Create `backend/tests/unit/choose-tables.test.ts` for `chooseTables`: filters `capacity >= partySize` and no overlapping interval; sorts by capacity ascending then name with `Intl.Collator("en", { numeric: true, sensitivity: "base" })` ("T2" before "T10", case-insensitive); returns the whole ordered list; empty when none qualifies
- [X] T007 [P] Extend `backend/tests/contract/error-shape.test.ts`: `NO_AVAILABILITY` maps to 409 with `details: { reason }` for every reason value; a `CONFLICT` with `details.reason` keeps the standard body shape; 001 conflicts still have no `details`; `ErrorResponse.details` in `/openapi.json` is a `oneOf` including `{ reason }`
- [X] T008 [P] Create `backend/tests/integration/interval-claims.test.ts` (mongodb-memory-server) for `claimInterval`/`releaseInterval` (data-model.md): first claim creates the calendar document by upsert; non-overlapping second claim succeeds; overlapping claim returns `false` and changes nothing; touching ranges both succeed; **20 concurrent claims for one overlapping range → exactly one `true`** and the stored `intervals` have no overlap; concurrent first claims on a missing document exercise the `11000` retry path; a non-`11000` database error (stubbed model) is rethrown and never returned as `false`; `releaseInterval` removes only the caller's own `reservationId` and is a no-op for an unknown id; unique indexes `{ tableId, date }` and `{ email, date }` exist after `initModels()` and a duplicate calendar document insert fails with `11000`
- [X] T009 Run T002–T008 and record that they FAIL (RED) for the right reason (missing modules / keys / code) before continuing

### Implementation

- [X] T010 Add the four keys to `EnvSchema` in `backend/src/config/env.ts` (`RESERVATION_DURATION_MINUTES` default 120, `TIME_SLOT_INTERVAL_MINUTES` default 15, `MIN_NOTICE_MINUTES` default 60, `BOOKING_HORIZON_DAYS` default 60; whole numbers within the R1 ranges 15–480, 5–120, 0–1440 and 1–365 respectively, fail fast), document them with their defaults in `backend/.env.example`, and expose them in the app config object
- [X] T011 [P] Extend `backend/src/shared/errors/app-error.ts`: add `NO_AVAILABILITY` to `ErrorCode` and `ERROR_STATUS` (409), `noAvailability(reason)` returning an `AppError` with `details: { reason }`, and an optional `details` argument to `conflict(message, details?)`
- [X] T012 [P] Update `backend/src/shared/openapi/common.ts` and `backend/src/shared/openapi/route.ts`: add `NO_AVAILABILITY` to `ERROR_CODES`, make `ErrorResponse.details` a `oneOf` (field-error array | `{ database: "down" }` | `{ reason: <availability reason> }` | `{ reason: <conflict reason> }`), define the `AvailabilityReason` and `ConflictReason` Zod enums, and add `CODE_MEANING.NO_AVAILABILITY` listing the seven reasons in precedence order
- [X] T013 [P] Create `backend/src/shared/time/local-time.ts` with `localToUtc(date, time, timeZone)` (`null` for a DST gap, earliest instant for a fold), `utcToLocal(instant, timeZone)` → `{ date, time }`, `addDays(date, n)`, `dayOfWeek(date)` → `DayName`, `overlaps(a, b)`; use `Intl.DateTimeFormat` only (research R2); reuse `toMinutes` from `backend/src/modules/schedule/schedule.domain.ts` and `todayInTimeZone` from `backend/src/modules/closed-dates/closed-dates.domain.ts`
- [X] T014 Create `backend/src/modules/availability/availability.domain.ts` with the types `Reason`, `Rules`, `TableInfo`, `Interval`, `DaySnapshot` and the pure functions `chooseTables`, `checkAvailability` (order too_soon → too_far_ahead → closed_date → closed_day → outside_service_hours → party_too_large → no_table_free; whole reservation inside one period on wall-clock minutes; `endAt = startAt + duration` in real time; horizon inclusive; minimum notice `startAt < now + minNotice`) and `listBookableTimes` (runs `checkAvailability` on each grid time; FR-008 empty-list reason order) per data-model.md and research R3/R7/R9. No I/O, no `Date.now()` (depends on T013)
- [X] T015 [P] Create `backend/src/modules/reservations/reservation.model.ts` with the `Reservation` schema exactly as in data-model.md: `status` enum `["confirmed"]` default `"confirmed"`; `tableId` required ObjectId ref `Table`; `date`; `startTime`; `endTime`; `startAt`; `endAt`; `partySize` integer 1–50; `guestName` trimmed 1–100; `guestEmail` trimmed lowercased ≤ 254; `guestPhone` trimmed 7–20; `secretCodeHash` with `select: false`; `createdAt` set by the service (`timestamps` off); indexes `{ tableId: 1, endAt: 1 }`, `{ endAt: 1 }`, `{ date: 1 }`; no overlap index; wrap in `registerModel()`; make sure `secretCodeHash` is stripped from any serialization
- [X] T016 [P] Create `backend/src/modules/reservations/calendar.model.ts` with `TableDay` (`tableId`, `date`, `intervals: [{ reservationId, start, end }]` with `_id: false`; unique index `{ tableId: 1, date: 1 }`) and `GuestDay` (`email`, `date`, same `intervals`; unique index `{ email: 1, date: 1 }`), both wrapped in `registerModel()`; confirm in `backend/src/db/connection.ts` that `initModels()` awaits index builds and that startup fails if a unique index cannot be built (fix if it does not)
- [X] T017 Create `backend/src/modules/reservations/interval-claims.ts` with `claimInterval(model, key, { reservationId, start, end }) → Promise<boolean>` (conditional `$push` using `intervals: { $not: { $elemMatch: { start: { $lt: end }, end: { $gt: start } } } }`, `upsert: true`, one retry without upsert on `11000` and `matchedCount === 1`, any other error rethrown) and `releaseInterval(model, key, reservationId)` (`$pull` of only the caller's own interval) per data-model.md (depends on T016)
- [X] T018 [P] Create test helpers in `backend/tests/helpers/`: `seed-restaurant.ts` (`seedRestaurant({ tables, schedule, closedDates })` writing through the models), `reserve-as.ts` (POST `/reservations` with defaults), `fixed-clock.ts` (`fixedClock(iso)` returning a `Clock`), and extend `build-test-app.ts` so the clock, the four booking-rule values, the time zone and the optional reserve-flow test hook can be injected
- [X] T019 Run T002–T008 and confirm they now PASS (GREEN); run `npm run typecheck` and `npm run lint` in `backend/`

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Check whether a party can be seated (Priority: P1) 🎯 MVP

**Goal**: Public `GET /availability` answers yes/no with a reason.

**Independent Test**: Configure tables, a weekly schedule and a closed date as staff; query the public operation for in-hours, outside-hours, closed-date, closed-day, oversized-party, fully booked and out-of-window cases and confirm each answer and reason.

### Tests for User Story 1 (write first, confirm RED)

- [X] T020 [P] [US1] Create `backend/tests/integration/availability.test.ts` covering acceptance scenarios 1–9 against `GET /availability` with a pinned clock: capacities 2/4/6 and Saturday dinner 20:00–23:30 → party 4 at 20:30 available; party 8 → `party_too_large`; closed date → `closed_date`; weekday without periods → `closed_day`; 17:00 with lunch+dinner → `outside_service_hours`; 21:30 available and 21:45 `outside_service_hours`; all suitable tables held (seed `TableDay` intervals) → `no_table_free`; past date / inside minimum notice → `too_soon`, beyond horizon → `too_far_ahead`; malformed date, invalid time, `partySize` of `0`, `51`, `04`, `4.0`, `abc`, repeated `partySize`, unknown query parameter → 400 `VALIDATION_ERROR` with `query.<name>` fields, all offending fields at once; response echoes `date`, `time`, `partySize`; `reason` present iff `available` is false; the table is never revealed; response carries `Cache-Control: no-store`; no `Authorization` header needed; a removed table is never considered; a non-UTC time zone puts "today" in restaurant time. Also update the pinned 001 contract expectations in `backend/tests/contract/auth-coverage.test.ts` (public set 3 → 4, adding `GET /availability`) and `backend/tests/contract/openapi-coverage.test.ts` (operations 14 → 15), recorded RED before T022–T026, so the 001 suites stay GREEN as routes are added (the final 6 / 17 totals are reached one route at a time in T020, T030, T040)
- [X] T021 [US1] Run T020 and record that it FAILS (RED)

### Implementation for User Story 1

- [X] T022 [P] [US1] Create `backend/src/modules/availability/availability.schemas.ts`: strict query schema `AvailabilityQuery` (`date` reusing `CalendarDateSchema`, `time` reusing the 001 `HH:mm` pattern, `partySize` string `^[1-9][0-9]?$` transformed to a number and checked `≤ 50`; a repeated parameter arrives as an array and fails), response schema `AvailabilityResponse` (`date`, `time`, `partySize`, `available`, optional `reason` using `AvailabilityReason`), with `.openapi()` examples and descriptions
- [X] T023 [US1] Create `backend/src/modules/availability/availability.snapshot.ts` with `loadDaySnapshot(date, deps)`: reads the weekly schedule periods for `dayOfWeek(date)`, whether `date` is a closed date, non-removed tables, and the `TableDay` documents of that date (≤ 100 reads by unique-index prefix), and builds a `DaySnapshot` with `now` from the injected clock and `Rules` from config
- [X] T024 [US1] Create `backend/src/modules/availability/availability.service.ts` with `checkAvailabilityFor({ date, time, partySize })` → loads the snapshot, runs `checkAvailability`, returns `{ date, time, partySize, available, reason? }` without the candidate tables
- [X] T025 [US1] Create `backend/src/modules/availability/availability.controller.ts` (`createAvailabilityController(deps)` with `check`, setting `Cache-Control: no-store`) and `backend/src/modules/availability/availability.routes.ts` declaring public `GET /availability` with `defineRoute` (no `security`, description starting "Public — no sign-in required.", summary, reason order in the description, parameter examples, `200`, `400`, `500`)
- [X] T026 [US1] Register the availability routes in `backend/src/app.ts` and wire the service dependencies (models, clock, config)
- [X] T027 [US1] Run T020 and confirm it PASSES (GREEN); run `npm run typecheck` and `npm run lint`

**Checkpoint**: User Story 1 is fully functional and independently testable (MVP slice with US2).

---

## Phase 4: User Story 2 - Reserve a table as a guest (Priority: P1)

**Goal**: Public `POST /reservations` creates a confirmed reservation with automatic table assignment and a secret code, with no double booking under concurrency.

**Independent Test**: Configure the restaurant, create a reservation through the public operation, confirm the response (details, assigned table, secret code) and that the table is no longer offered for overlapping times.

### Tests for User Story 2 (write first, confirm RED)

- [ ] T028 [P] [US2] Create `backend/tests/unit/secret-code.test.ts`: `generateSecretCode()` returns 43 base64url characters (256 bits), two calls differ, `hashSecretCode` returns SHA-256 hex (64 chars) and is deterministic, the hash differs from the code
- [ ] T029 [P] [US2] Create `backend/tests/unit/reservations.schemas.test.ts`: body is strict (unknown field refused); `date` real calendar date; `time` `HH:mm` 00:00–23:59; `partySize` JSON integer 1–50 (string, decimal, 0, 51 refused); `name` trimmed 1–100; `email` trimmed, lowercased, valid syntax, ≤ 254 (display name and lists refused); `phone` trimmed 7–20 chars of `^\+?[0-9 ()-]+$` with at least 7 digits (letters, 6 digits, `+` in the middle refused); every offending field reported at once
- [ ] T030 [P] [US2] Create `backend/tests/integration/reservations.test.ts` covering acceptance scenarios 1–3, 5–7 and 9 of US2 via `POST /reservations` with a pinned clock: party 3 gets the capacity-4 table and the 201 body has `id`, `status: "confirmed"`, `date`, `startTime`, `endTime`, `partySize`, `guest { name, email, phone }` (stored values: name/phone trimmed, email trimmed + lowercased), `table { name }`, `createdAt`, `secretCode`, and no `Location` header; capacity-4 tables "T2" and "T10" → "T2"; the only table for 6 held 18:00–20:00 → 19:00 refused with 409 `NO_AVAILABILITY` `no_table_free`, 20:00 accepted (same table); closed date / outside hours / party too large → 409 `NO_AVAILABILITY` with the matching reason and nothing stored (no `Reservation`, `TableDay` or `GuestDay` change); invalid name/email/phone → 400 listing every offending field and nothing stored; same email (" Ana@Mail.com ") overlapping → 409 `CONFLICT` `details.reason = "duplicate_reservation"` revealing nothing about the other reservation, same email non-overlapping (start at the end instant) succeeds; duplicate beats unavailability when both apply; the stored document has `secretCodeHash` and never the plain code; no later operation or error body or log line contains the code; after a reservation, `GET /availability` for an overlapping time reports `no_table_free` for the held table; a nonexistent DST-gap time → `outside_service_hours`; `Cache-Control: no-store`. Also raise the pinned 001 contract expectations (public set 4 → 5 adding `POST /reservations`, operations 15 → 16) in `auth-coverage.test.ts` and `openapi-coverage.test.ts`, recorded RED before T034–T038
- [ ] T031 [P] [US2] Create `backend/tests/integration/reservations.concurrency.test.ts` (real mongodb-memory-server, `Promise.all`): **SC-002** 20 simultaneous requests for one remaining suitable table, repeated 50 rounds, each with a test-only `afterClaim` pause to force contention → exactly one 201 and 19 × 409 `NO_AVAILABILITY/no_table_free` per round, a round with zero successes fails, and after every round: no overlapping intervals in any `TableDay`/`GuestDay`, every interval has a `Reservation` (no orphans), no `Reservation` on a removed table; two simultaneous identical requests with the same email and free tables → one 201 and one `CONFLICT/duplicate_reservation`; candidate fallback with several tables (smallest suitable used first, no overlap); a pair where the first request is forced to fail after its guest claim (the second may get `duplicate_reservation`, and a third attempt after the first finishes succeeds)
- [ ] T032 [P] [US2] Create `backend/tests/integration/reservations.failures.test.ts` (stubbing model calls through injected dependencies): `Reservation.create` rejects with a definite error → 500 `INTERNAL_ERROR`, table and guest intervals both released; unknown insert outcome with the write having succeeded (stub: write then network error) → `exists` finds it → 201 and intervals kept; unknown outcome where the write did not happen → 500 and both intervals released; unknown outcome where `exists` also fails → 500 and both intervals kept; a database error during a claim → 500 (never `duplicate_reservation` or `no_table_free`) and earlier claims released; a failing `releaseInterval` does not mask the original answer and does not stop the other release; post-store verification (FR-030): a closed date, schedule replacement, capacity reduction or table removal applied between the claim and the insert (injected through the test hook) → reservation deleted, both intervals released, 409 `NO_AVAILABILITY` with the matching reason; if the delete fails, intervals kept and 500; reads failing at step 9 keep the reservation and answer 201
- [ ] T033 [US2] Run T028–T032 and record that they FAIL (RED)

### Implementation for User Story 2

- [ ] T034 [P] [US2] Create `backend/src/modules/reservations/secret-code.ts`: `generateSecretCode()` = `randomBytes(32).toString("base64url")` and `hashSecretCode(code)` = SHA-256 hex, both from `node:crypto` (research R8)
- [ ] T035 [P] [US2] Create `backend/src/modules/reservations/reservations.schemas.ts`: strict `CreateReservationBody` (rules of T029; trim/lowercase transforms; phone ≥ 7 digits refine), `ReservationConfirmation` response (as in contracts/api.md, including `secretCode` described as "returned only here"), and `AffectedReservation` item schema (`id`, `date`, `startTime`, `endTime`, `partySize`, `guestName`, `tableName`) for US4; add a request example matching contracts/api.md
- [ ] T036 [US2] Create `backend/src/modules/reservations/reservations.service.ts` with `createReservation(input)` following research R6 exactly: normalize → `startAt`/`endAt` → duplicate pre-read of `GuestDay` (`CONFLICT` `duplicate_reservation`) → fresh snapshot + `checkAvailability` (`NO_AVAILABILITY`) → new `ObjectId` → claim guest interval → claim candidate table intervals in `chooseTables` order with a table re-read (`removed: false`, `capacity >= partySize`) and release/continue on failure, no candidate → release guest interval and `no_table_free` → insert `Reservation` with `_id = reservationId`, `createdAt` from the clock, `secretCodeHash` → unknown-outcome handling via `Reservation.exists` (FR-027b) → post-store verification of closed date, schedule and assigned table with rollback (`deleteOne` then release both; reasons `closed_date`, `closed_day`, `outside_service_hours`, else `no_table_free`) → return confirmation with the plain secret code. Release in reverse order, catch and log a failing release without stopping the other, never log the code, map database failures to `INTERNAL_ERROR`. Accept an optional test-only `afterClaim` hook through the service dependencies (production wiring never sets it) (depends on T017, T034, T035)
- [ ] T037 [US2] Create `backend/src/modules/reservations/reservations.controller.ts` (`create`, status 201, `Cache-Control: no-store`, no `Location`) and `backend/src/modules/reservations/reservations.routes.ts` declaring public `POST /reservations` with `defineRoute` (public description, body example from contracts/api.md, responses `201`, `400`, `409 CONFLICT` documenting `duplicate_reservation`, `409 NO_AVAILABILITY` documenting the reasons and the lost-race meaning of `no_table_free`, `500`, plus the retry note)
- [ ] T038 [US2] Register the reservation routes in `backend/src/app.ts` and wire dependencies (models, clock, config, secret-code helpers, optional test hook only in `buildTestApp`)
- [ ] T039 [US2] Run T028–T032 and confirm they PASS (GREEN), re-running the concurrency suite several times to check it is stable; run `npm run typecheck` and `npm run lint`

**Checkpoint**: User Stories 1 and 2 work independently; the system takes reservations without double booking.

---

## Phase 5: User Story 3 - List bookable times for a date (Priority: P2)

**Goal**: Public `GET /availability/times` lists bookable start times grouped by service period.

**Independent Test**: Configure a day with lunch and dinner, reserve some tables, and confirm the listed times exclude exactly the times with no suitable free table and nothing outside the service periods or booking window.

### Tests for User Story 3 (write first, confirm RED)

- [ ] T040 [P] [US3] Create `backend/tests/integration/availability-times.test.ts` covering acceptance scenarios 1–7 against `GET /availability/times`: lunch 12:00–15:00 party 2 → 12:00, 12:15 … 13:00 under the period's stored name; the only table for 6 held 20:00–22:00 → no listed time overlapping it for party 6; closed date / closed day / party larger than every table → `periods: []` with `closed_date` / `closed_day` / `party_too_large`; fully booked open day → `no_table_free`; today late enough that notice rules out everything → `too_soon`; today only lists times respecting the minimum notice; periods in chronological order and periods without times omitted; non-empty result has no `reason`; validation (bad date, bad `partySize`, unknown or repeated parameter, missing parameter) → 400; `Cache-Control: no-store`; no sign-in needed. Also raise the pinned 001 contract expectations (public set 5 → 6 adding `GET /availability/times`, operations 16 → 17) in `auth-coverage.test.ts` and `openapi-coverage.test.ts`, recorded RED before T043–T045
- [ ] T041 [US3] Add to the same file the **SC-004 HTTP check across one full week** including a closed date: for every day, every listed time is accepted by `GET /availability` (`available: true`) and by `POST /reservations` (201, on a fresh database state per time), and every grid time not listed is refused by `GET /availability`
- [ ] T042 [US3] Run T040–T041 and record that they FAIL (RED)

### Implementation for User Story 3

- [ ] T043 [P] [US3] Extend `backend/src/modules/availability/availability.schemas.ts` with the strict `TimesQuery` (`date`, `partySize`; both required) and `TimesResponse` (`date`, `partySize`, `periods: [{ name, times }]`, optional `reason` iff `periods` is empty) with examples from contracts/api.md
- [ ] T044 [US3] Add `listTimesFor({ date, partySize })` to `backend/src/modules/availability/availability.service.ts` using `loadDaySnapshot` + `listBookableTimes`
- [ ] T045 [US3] Add the `times` handler (`Cache-Control: no-store`) to `backend/src/modules/availability/availability.controller.ts` and declare public `GET /availability/times` in `backend/src/modules/availability/availability.routes.ts` (public description, the FR-008 reason order, parameter examples, `200`, `400`, `500`)
- [ ] T046 [US3] Run T040–T041 and confirm they PASS (GREEN); run `npm run typecheck` and `npm run lint`

**Checkpoint**: User Stories 1–3 work independently.

---

## Phase 6: User Story 4 - Configuration changes respect existing reservations (Priority: P2)

**Goal**: Table removal is refused while upcoming reservations exist; closed-date creation, schedule replacement and table update report the affected upcoming reservations without changing them.

**Independent Test**: Create a reservation, try to remove its table (refused), remove a table without upcoming reservations (allowed), and apply each of the three contradicting changes and check the reported list.

### Tests for User Story 4 (write first, confirm RED)

- [ ] T047 [P] [US4] Create `backend/tests/unit/affected.domain.test.ts` for `isInsideSchedule({ startTime, endTime }, periods)`: inside one period; starting before the period start; ending after the period end; ending exactly at the period end (inside); spanning two periods (not inside); empty periods (not inside)
- [ ] T048 [P] [US4] Update the 001 tests that pin exact bodies so the additive change is expected, recorded RED first: `backend/tests/integration/tables.test.ts` (`PATCH /tables/{id}` returns `{ id, name, capacity, affectedReservations: [] }`), `backend/tests/integration/schedule.test.ts` (`PUT /schedule` returns `{ days, affectedReservations: [] }`), `backend/tests/integration/closed-dates.test.ts` (`POST /closed-dates` returns `{ date, reason, affectedReservations: [] }`)
- [ ] T049 [P] [US4] Create `backend/tests/integration/reservation-protection.test.ts` covering US4 scenarios 1–6: removing a table with a reservation that has not ended → 409 `CONFLICT` `details.reason = "table_has_upcoming_reservations"`, table untouched (`removedAt` still null); all reservations ended → 204 soft delete and past reservations still show the table name; interval ending exactly now does not block, one ending one millisecond later does; an orphan `TableDay` interval blocks removal; a removed table is never considered by availability or reservation; schedule change / closed date / capacity edit never modify, move or cancel reservations (documents unchanged); closed date on 2026-12-24 with a 6-guest reservation at "T5", schedule replacement leaving it outside service hours, and "T5" reduced to capacity 4 → each succeeds and lists exactly that reservation (`id`, `date`, `startTime`, `endTime`, `partySize`, `guestName`, `tableName`); changes touching nothing return `[]`; a rename never affects reservations; capacity not in the body → `[]`; list ordered by start instant then `id`, only reservations with `endAt > now`; after the closed date, `GET /availability` for that date is `closed_date` while the reservation stays confirmed with its table; 401 without a token and the 001 error lists unchanged
- [ ] T050 [P] [US4] Create `backend/tests/integration/reservation-protection.races.test.ts` (`Promise.all` plus the test-only `afterClaim` hook): removal racing a reservation in **both orderings** over many rounds → after every round no `Reservation` references a removed table, and the outcome is either (removal 204, reservation on another table or refused) or (removal 409, reservation stored), never a reservation on a removed table; the removal's re-check detects a claim made between its pre-check and its write, reverts (`removed: false`, `removedAt: null`) and answers 409; a stubbed failing revert (retried once) → 500 `INTERNAL_ERROR` and the table stays removed; FR-030 races: a closed date, schedule replacement or capacity reduction applied while a reservation is created → the reservation is either listed in the staff response or refused with `NO_AVAILABILITY`, never neither
- [ ] T051 [US4] Run T047–T050 and record that they FAIL (RED)

### Implementation for User Story 4

- [ ] T052 [P] [US4] Create `backend/src/modules/reservations/affected.domain.ts` with the pure `isInsideSchedule({ startTime, endTime }, periods)` on wall-clock minutes (`start <= startTime && endTime <= end` for some period)
- [ ] T053 [US4] Create `backend/src/modules/reservations/affected.ts` with `affectedByClosedDate(date, now)`, `affectedBySchedule(days, now)` and `affectedByCapacity(tableId, newCapacity, now)` per research R11: query only reservations with `endAt > now` (closed date by `{ date }`, schedule filtered in memory with `isInsideSchedule` against the reservation's weekday via `dayOfWeek(date)`, capacity by `{ tableId, partySize: { $gt: newCapacity } }`), sort by `startAt` then `id`, resolve `tableName` with one `Table.find({ _id: { $in } })` that includes removed tables, and return `AffectedReservation[]` (depends on T052)
- [ ] T054 [US4] Update `backend/src/modules/tables/tables.service.ts`: `removeTable` follows research R10 (404 if unknown or already removed → pre-check `TableDay.exists({ tableId, "intervals.end": { $gt: now } })` → 409 `conflict(..., { reason: "table_has_upcoming_reservations" })` without touching the table → `findOneAndUpdate({ _id, removed: false }, { removed: true, removedAt: now })` (null → 404) → re-check; if an interval appeared revert, retry the revert once, 409 on success, `INTERNAL_ERROR` if the revert still fails, logging it); `updateTable` computes `affectedReservations` after the change only when `capacity` is in the body (otherwise `[]`)
- [ ] T055 [P] [US4] Update `backend/src/modules/schedule/schedule.service.ts` so `replaceSchedule` returns `{ days, affectedReservations }`, computed after the write with `affectedBySchedule`
- [ ] T056 [P] [US4] Update `backend/src/modules/closed-dates/closed-dates.service.ts` so `addClosedDate` returns `{ date, reason, affectedReservations }`, computed after the write with `affectedByClosedDate`
- [ ] T057 [US4] Update the Zod schemas, controllers and route definitions of the four 001 operations so `/openapi.json` follows: `backend/src/modules/tables/tables.schemas.ts` and `tables.routes.ts` (`PATCH` response with `affectedReservations`; `DELETE` documents `409 CONFLICT` with `table_has_upcoming_reservations`, `500`, and drops the "not enforced in this feature" note), `backend/src/modules/schedule/schedule.schemas.ts` and `schedule.routes.ts`, `backend/src/modules/closed-dates/closed-dates.schemas.ts` and `closed-dates.routes.ts`; `affectedReservations` is described as always present, complete, ordered, informational (depends on T035, T053–T056)
- [ ] T058 [US4] Run T047–T050 and the full 001 suites and confirm GREEN; run the race suite several times for stability; run `npm run typecheck` and `npm run lint`

**Checkpoint**: User Stories 1–4 work independently; existing reservations are protected and staff are informed.

---

## Phase 7: User Story 5 - Discoverable public operations (Priority: P3)

**Goal**: The interactive documentation lists every new operation as public, with inputs, outputs, reasons, examples and every error response.

**Independent Test**: Open `/docs`, confirm each new operation is listed and public, and run an availability check and a reservation without signing in.

### Tests for User Story 5 (write first)

- [ ] T059 [P] [US5] Extend `backend/tests/contract/auth-coverage.test.ts`: the public set is exactly `GET /health`, `GET /openapi.json`, `POST /auth/login`, `GET /availability`, `GET /availability/times`, `POST /reservations` (6; the pinned count was already raised step by step in T020, T030 and T040, so this task asserts the final set and the per-operation behavior); the three new operations succeed or fail on validation, never with 401, without a token; every staff operation still answers 401 without a token
- [ ] T060 [P] [US5] Extend `backend/tests/contract/openapi-coverage.test.ts`: 17 documented operations (14 + 3; the pinned count was already raised step by step in T020, T030 and T040, so this task adds the documentation-quality assertions below); each new operation has summary, description starting "Public — no sign-in required.", no `security` entry, a request example (body example for `POST /reservations`, parameter examples for the queries), the success schema and every error response of contracts/api.md; `NO_AVAILABILITY` and its seven reasons and the two conflict reasons are described; `DELETE /tables/{id}` documents `409`; the three changed responses include `affectedReservations`; `secretCode` appears only in the `201` schema of `POST /reservations`
- [ ] T061 [US5] Run T059–T060 and record the result: `openapi-coverage` extension is expected RED until the documentation gaps are fixed; `auth-coverage` may pass on first run, so prove it can fail with the temporary mutation check from 001 (mark one new route as requiring auth, observe the failure, revert)

### Implementation for User Story 5

- [ ] T062 [US5] Close every documentation gap found by T060 in the route and schema files (`backend/src/modules/availability/*.routes.ts`, `backend/src/modules/reservations/reservations.routes.ts`, `backend/src/shared/openapi/route.ts`, `backend/src/shared/openapi/common.ts`), then run T059–T060 and confirm GREEN
- [ ] T063 [US5] Manual documentation review in `/docs` (`npm run dev` in `backend/`): execute `GET /availability` and `POST /reservations` from Swagger UI without signing in and confirm the standard error structure on a refused request

**Checkpoint**: All user stories are independently functional and documented.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Performance proof, documentation, final validation.

- [ ] T064 [P] Extend `backend/tests/integration/performance.test.ts` (SC-006): seed 100 tables, a weekly schedule, 500 closed dates and 10,000 reservations (with their `TableDay`/`GuestDay` intervals) directly through the models; 10 concurrent requests per new operation (`GET /availability`, `GET /availability/times`, `POST /reservations`); p95 < 1 s; prove it can fail by temporarily setting `P95_LIMIT_MS = 0`, observe the failure, revert
- [ ] T065 [P] Update `backend/README.md`: the four booking-rule keys with defaults, the three public operations, and a "Known debt" section covering orphan intervals (when they arise, the `mongosh` query to list `TableDay`/`GuestDay` intervals whose `reservationId` has no `Reservation`, and the manual removal procedure; FR-031), a table removal whose revert failed (FR-029), retries without an idempotency key, and no rate limiting on public operations
- [ ] T066 [P] Update `backend/.env.example` check and `specs/002-guest-reservations/quickstart.md` if the final behavior differs from it (keys, example requests, expected outputs)
- [ ] T067 Run the full validation in `backend/`: `npm run typecheck`, `npm run lint`, `npm test`; fix anything failing
- [ ] T068 Run the `quickstart.md` validation end to end against a running backend (public availability, times, reservation, removal refusal, affected report) and record the outcome in the task notes
- [ ] T069 Walk the checklists `specs/002-guest-reservations/checklists/{requirements,api}.md` (`concurrency.md` is out of scope by decision of the project owner) against the implementation and note any requirement that is not covered by a test

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup; BLOCKS all user stories.
- **US1 (Phase 3)** and **US2 (Phase 4)**: both depend only on Foundational. US2 reuses `loadDaySnapshot` from T023, so implement US1's T023 before T036 (or build US1 first, the recommended order).
- **US3 (Phase 5)**: depends on Foundational and T023 (US1); independent of US2 for implementation, but its SC-004 HTTP check (T041) needs US2.
- **US4 (Phase 6)**: depends on Foundational and US2 (reservations must exist); T035 provides `AffectedReservation`.
- **US5 (Phase 7)**: depends on US1–US4 (documents all of them).
- **Polish (Phase 8)**: depends on all stories.

### Within Each Story

- Tests are written and observed RED before implementation.
- Models/schemas before services; services before controllers; controllers before routes; routes registered in `app.ts` last.

### Parallel Opportunities

- Foundational tests T002–T008 are all `[P]`; implementation T011, T012, T013, T015, T016, T018 are `[P]` (different files).
- US1: T022 parallel with T023.
- US2: tests T028–T032 are parallel; T034 and T035 are parallel.
- US4: tests T047–T050 are parallel; T055 and T056 are parallel.
- US5: T059 and T060 are parallel.
- After Foundational, US1 and US2 can proceed in parallel with two developers (watch the T023 dependency); US3 and US4 can then run in parallel.

---

## Parallel Example: Foundational tests

```bash
# Launch all Foundational tests together:
Task: "Extend backend/tests/unit/env.test.ts for the four booking-rule keys"
Task: "Create backend/tests/unit/local-time.test.ts"
Task: "Create backend/tests/unit/availability.domain.test.ts"
Task: "Create backend/tests/integration/interval-claims.test.ts"
```

## Parallel Example: User Story 2 tests

```bash
Task: "Create backend/tests/unit/secret-code.test.ts"
Task: "Create backend/tests/integration/reservations.test.ts"
Task: "Create backend/tests/integration/reservations.concurrency.test.ts"
Task: "Create backend/tests/integration/reservations.failures.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 Setup → Phase 2 Foundational (blocking).
2. Phase 3 US1 (availability check) → validate independently.
3. Phase 4 US2 (reserve) → **STOP and VALIDATE**: concurrency suite green, SC-002 holds. US1 + US2 together are the smallest slice that takes reservations (both are P1).

### Incremental Delivery

1. Foundation → US1 → US2 (MVP) → demo.
2. Add US3 (bookable times) → SC-004 verified.
3. Add US4 (protection and reports) → SC-007, SC-008 verified.
4. Add US5 (contract suites and docs review) → SC-005 verified.
5. Polish → SC-006 and README known debt.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. Developer A: US1 then US3. Developer B: US2 then US4. Either: US5 and Polish at the end.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps each task to its user story for traceability; Setup, Foundational and Polish tasks carry no label.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
- Avoid: vague tasks, two tasks editing the same file in parallel (`app.ts`, `availability.service.ts`, `availability.routes.ts` are touched by several stories and are therefore sequential), calling `Date.now()` in domain or service code.
