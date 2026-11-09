---

description: "Task list for feature 004-staff-day-view (Staff Day View of Reservations)"
---

# Tasks: Staff Day View of Reservations

**Input**: Design documents from `/specs/004-staff-day-view/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle II (Test-First, NON-NEGOTIABLE): Vitest + Supertest tests are written first and **observed failing (RED)** before implementation, with mongodb-memory-server for persistence and `FakeEmailSender` (only to prove nothing is sent). Every story phase starts with test tasks followed by an explicit "run and confirm RED" task. Verification-only suites (privacy, read-only snapshot, performance) may pass when first written; they prove they can fail through a temporary mutation check.

**Organization**: Tasks are grouped by user story. The pure view functions, the shared id helper and the read-service skeleton are shared and live in Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 (user stories of spec.md)
- All paths are relative to the repository root; all code lives under `backend/`

## Conventions used by every task

- **No new dependency, no schema/index change, no new error code, no new config key.** `Intl.Collator` and `Set` are built in.
- Layering as in 001–003: `*.routes.ts` only declares operations with `defineRoute` and sets `handler: controller.<name>`; HTTP handlers live in `reservations.controller.ts` (typed with `RouteHandler<P, Q, B>`, reading `res.locals.input`); services stay HTTP-free. Schema modules import `z` from `backend/src/shared/openapi/zod.ts`, never from `zod`. Relative imports use the `.js` extension (ESM, `nodenext`).
- Both operations are staff-only (`auth` true, as the existing staff cancel route) and send `Cache-Control: no-store` on every 2xx answer. Check order: route match → sign-in (401) → validation (400) → not found (404).
- Read path = `reservations.read.service.ts` only. It imports just the models (`Reservation`, `Table`), `reservation-view.domain.ts`, `reservation-id.ts` and `notFound`; it never imports `calendar.model`, `interval-claims`, `reservations.ops`, notifier, email-sender or `reservations.service`.
- ONE `Reservation.find({ date }).lean()` (all statuses, `secretCodeHash` never selected) and ONE `Table.find({ _id: { $in } }, { name: 1 }).lean()` with **no** `removed` filter. Status filter, summary, order and response whitelist are in-memory over that single snapshot.
- Response item (`ReservationView`) exactly: `id, status, date, startTime, endTime, partySize, guest{name,email,phone}, table{name}, createdAt` (ISO-8601 UTC) plus `cancelledAt` / `cancelledBy` **only when `status === "cancelled"`** (omitted, never `null`). Never spread a document. Never `secretCode`, `secretCodeHash` or any derivative.
- Table name = the table's **current name resolved by `tableId`** (research R3); if the table document is missing, `console.error(JSON.stringify({ event: "table_missing", reservationId }))` (id only) and show `"unknown"`.
- Test dates/time: restaurant time zone and fixed clock as in the existing integration tests (`buildTestApp({ now })`); use `seedRestaurant`, `seedStaff`, `loginAs`, `reserveAs`, `cancelWithCode`, `cancelAsStaff` from `backend/tests/helpers/`.

---

## Phase 1: Setup

**Purpose**: Confirm the baseline before touching anything.

- [X] T001 Run `npm run typecheck && npm run lint && npm test` in `backend/` and record that the baseline (features 001–003) is green; no file changes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure view functions, the shared id parse and the response schemas. Every story needs these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests first (write, then confirm RED)

- [X] T002 [P] Create `backend/tests/unit/reservation-view.domain.test.ts` for the pure functions of data-model.md: (a) `sortReservations(rows, nameOf)` orders by `startAt` ascending, then table name with `Intl.Collator("en", { numeric: true, sensitivity: "base" })` (`T2` before `T10`), then id hex; is total (shuffled input gives identical output many times); returns a new array and does not mutate the input; (b) `buildSummary(rows)` counts **confirmed only**, sums their `partySize`, counts distinct `tableId` (two rows on one table = 1; two ids with the same name = 2; cancelled rows ignored), `{ reservations: 0, guests: 0, tablesUsed: 0 }` for empty input or only-cancelled input; (c) `toReservationView(row, tableName)` returns exactly the whitelisted keys for a confirmed row (no `cancelledAt` / `cancelledBy` keys even if the row carries `null`), adds `cancelledAt` (ISO-8601 UTC) and `cancelledBy` for a cancelled row, renders a cancelled row missing those fields without them instead of throwing, `createdAt` ISO-8601 UTC, `id` is the 24-hex string, and a row carrying extra properties (`secretCodeHash`, `secretCode`, `startAt`, `tableId`, `__v`) yields none of them (assert with `Object.keys`)
- [X] T003 [P] Create `backend/tests/unit/reservation-id.test.ts` for `reservation-id.ts`: `parseReservationId(id)` returns an `ObjectId`-compatible value for 24 hex characters (upper and lower case) and `null` for `"abc"`, 23 and 25 hex characters, `""`, `" "`, a 24-char string with non-hex characters, and an id with leading/trailing whitespace; `RESERVATION_NOT_FOUND_MESSAGE === "Reservation not found"`
- [X] T004 [P] Create `backend/tests/unit/reservations.schemas.test.ts` additions (extend the existing file `backend/tests/unit/reservations.schemas.test.ts`): `ReservationListQuerySchema` accepts `{ date: "2026-11-14" }` (status defaults to `confirmed`), accepts `status` `confirmed` | `all` | `cancelled`; rejects with `VALIDATION_ERROR`-shaped issues a missing date, `"2026-02-30"`, `"2026-1-5"`, `"14-11-2026"`, `""`, a status of `ALL`, `"pending"`, `""`, a repeated `status` (array) and any unknown key (named in the issue); reports `date` and `status` problems together in one parse; `ReservationReadQuerySchema` (strict empty object for `GET /reservations/{id}`) accepts `{}` and rejects any key (`{ foo: "1" }`, `{ status: "all" }`) naming it
- [X] T005 Run T002–T004 and record that they FAIL (RED) for the right reason (modules and schemas missing) before continuing

### Implementation

- [X] T006 [P] Create `backend/src/modules/reservations/reservation-id.ts`: export `RESERVATION_NOT_FOUND_MESSAGE = "Reservation not found"` and `parseReservationId(id: string): Types.ObjectId | null` using the strict `/^[0-9a-f]{24}$/i` (moved from the private `OBJECT_ID` / `NOT_FOUND_MESSAGE` in `backend/src/modules/reservations/reservations.service.ts`, research R8)
- [X] T007 Change `backend/src/modules/reservations/reservations.service.ts` to import `RESERVATION_NOT_FOUND_MESSAGE` and the id parse from `reservation-id.ts` and delete its private `OBJECT_ID` and `NOT_FOUND_MESSAGE` (lines near 284); no behavior change; the 003 tests (`cancel-guest`, `cancel-staff`, `cancel-rules`, `cancel-concurrency`, `cancel-release-failures`, `no-code-leak`) must stay green untouched (depends on T006)
- [X] T008 [P] Create `backend/src/modules/reservations/reservation-view.domain.ts` (pure, no I/O, no mongoose imports other than types): `ReservationRow` type (`_id`, `status`, `date`, `startTime`, `endTime`, `startAt`, `partySize`, `guestName`, `guestEmail`, `guestPhone`, `tableId`, `createdAt`, `cancelledAt?`, `cancelledBy?`), `sortReservations(rows, nameOf)`, `buildSummary(rows)`, `toReservationView(row, tableName)` exactly as specified in data-model.md "Pure functions" and in Conventions above (explicit whitelist, cancelled fields only when cancelled)
- [X] T009 [P] Extend `backend/src/modules/reservations/reservations.schemas.ts` with Zod schemas (using the OpenAPI-extended `z`): `ReservationListStatusSchema = z.enum(["confirmed","all","cancelled"])` described value by value; `ReservationListQuerySchema = z.strictObject({ date: CalendarDateSchema (import from ../closed-dates/closed-dates.schemas.js, with description and example "2026-11-14"), status: ReservationListStatusSchema.default("confirmed") (optional in the docs, default confirmed) })`; `ReservationViewSchema` (`id` 24-hex string, `status: ReservationStatusSchema`, `date`, `startTime`, `endTime`, `partySize` int, `guest{name,email,phone}`, `table{name}`, `createdAt` ISO-8601 UTC string, `cancelledAt` and `cancelledBy: z.enum(["guest","staff"])` optional with a description "present only when cancelled"); `ReservationSummarySchema` (`reservations`, `guests`, `tablesUsed` non-negative ints, description "confirmed reservations only, identical under every status choice"); `DayViewSchema` (`date`, `status: ReservationListStatusSchema`, `summary`, `reservations: ReservationViewSchema[]`); examples `LIST_RESERVATIONS_EXAMPLE` (request query `{ date: "2026-11-14", status: "all" }`) and the 200 example from contracts/api.md; export the inferred types. Add `ReservationReadQuerySchema = z.strictObject({})` (the single read defines no query parameters, so any query parameter is a 400, FR-014). Reuse the existing `ReservationIdParamsSchema` for the single read (plain string id, so a malformed id is 404 not 400)
- [X] T010 Run T002–T004 and confirm GREEN, then `npm run typecheck && npm run lint && npm test` to confirm 001–003 are untouched

**Checkpoint**: Foundation ready — user story work can begin.

---

## Phase 3: User Story 1 - Staff see the day's reservations (Priority: P1) 🎯 MVP

**Goal**: `GET /reservations?date=` returns the date's confirmed reservations in start-time order with full details and the confirmed-only summary.

**Independent Test**: Create several confirmed reservations on one date (different times, party sizes, tables) and on other dates, sign in as staff, request that date, and check exactly that day's reservations appear in order with all fields and a matching summary.

### Tests for User Story 1 (write first)

- [X] T011 [US1] Create `backend/tests/integration/day-view.test.ts` (seed restaurant with several tables incl. `T2` and `T10`, staff login, reservations created through `POST /reservations` and, where a specific `startAt`/table is needed, inserted with `Reservation.create` using a unique `secretCodeHash`): (a) **SC-001** ≥ 10 confirmed reservations on one date plus others on the day before and the day after, including evening times whose UTC date is the next day (use a non-UTC restaurant time zone in the test config) → exactly the date's reservations, ordered by start time, each with every field of `ReservationView` correct (`id`, `status: "confirmed"`, `date`, `startTime`, `endTime`, `partySize`, `guest.name/email/phone`, `table.name`, `createdAt` ISO-8601 UTC) and **no** `cancelledAt` / `cancelledBy` keys; (b) **SC-002** summary equals figures computed independently in the test (count, sum of party sizes, distinct tables) and several reservations on one table count as one table; (c) empty date, a past date (e.g. 2020-01-01) and a far-future date (e.g. 2099-12-31) → 200, `reservations: []`, summary zeros, **SC-006**; (d) a closed date or a non-service day with no reservations → 200 empty; (e) two reservations with the same start time on `T2` and `T10` → `T2` first, and ten repeated requests give the identical order, **US1.6**; (f) response header `Cache-Control: no-store`, body keys exactly `date, status, summary, reservations`, `status` echoes `"confirmed"` when omitted; (g) a table renamed after the reservation shows the new name (research R3), and a reservation whose table was removed (soft delete) still shows the table's name, **SC-005**; (h) a reservation whose table document is missing shows `"unknown"` and logs one `table_missing` line containing only the event and the reservation id
- [X] T012 [US1] Run T011 and record that it FAILS (RED) because `GET /reservations` is not routed (404)

### Implementation for User Story 1

- [X] T013 [US1] Create `backend/src/modules/reservations/reservations.read.service.ts` (HTTP-free) with `listDay(date: string, status: "confirmed" | "all" | "cancelled"): Promise<DayView>`: ONE `Reservation.find({ date }).lean()` (no `secretCodeHash`), ONE `Table.find({ _id: { $in: distinctTableIds } }, { name: 1 }).lean()` without a `removed` filter, a `nameOf` map from the result (`"unknown"` + `console.error(JSON.stringify({ event: "table_missing", reservationId }))` when absent), summary = `buildSummary(allRows)`, list = `sortReservations(confirmedRows, nameOf).map(toReservationView)`; returns `{ date, status: "confirmed", summary, reservations }`. **Test-first scope (Constitution II)**: in this story `listDay` implements ONLY the default `confirmed` behavior and deliberately ignores the `status` argument (no `all` / `cancelled` branch, no status-dependent filter); those branches are written in US2 (T026) after their tests are seen RED. Imports only what the Conventions allow (depends on T008, T009)
- [X] T014 [US1] Add `list` to `backend/src/modules/reservations/reservations.controller.ts`: reads validated `res.locals.input.query`, calls `listDay`, sets `Cache-Control: no-store`, responds 200; extend the `ReservationsController` type with `list: RouteHandler<undefined, typeof ReservationListQuerySchema, undefined>`
- [X] T015 [US1] Register `GET /reservations` in `backend/src/modules/reservations/reservations.routes.ts` with `defineRoute` (staff `auth`, `request.query: ReservationListQuerySchema` with example, success 200 `DayViewSchema`, errors `VALIDATION_ERROR`; description exactly as in contracts/api.md "Description (documented)", starting with `Staff sign-in required.`). Keep the three existing POST routes declared where they are
- [X] T016 [US1] Run T011 and confirm GREEN; run the full suite, `npm run typecheck` and `npm run lint`

**Checkpoint**: US1 works on its own — staff can see who is coming, when and where.

---

## Phase 4: User Story 4 - Guest data stays private and secrets stay secret (Priority: P1)

**Goal**: Both operations refuse anonymous access before reading anything, never return the code or its hash, change nothing, and are never cached. The single-reservation operation is created here as the other half of the surface these guarantees cover (its behavior story is US3).

**Independent Test**: Call both operations with no, malformed and expired tokens and check each is refused with the standard 401; inspect every successful response for the code or its stored form; compare the stored state before and after many calls.

### Tests for User Story 4 (write first)

- [X] T017 [P] [US4] Create `backend/tests/integration/day-view-privacy.test.ts`: (a) **SC-003** `GET /reservations?date=2026-11-14` and `GET /reservations/<existing id>` with no `Authorization`, a malformed bearer, a tampered token and an expired token (clock past expiry) → 401 `AUTHENTICATION_REQUIRED` standard body, no personal data, and the 401 body for `GET /reservations/<unknown id>` and `GET /reservations/abc` is identical to the one for an existing id (existence not inferable); (b) **US4.3** `GET /reservations` with no token and no `date` / invalid `status` / unknown parameter → 401 (not 400); with a valid token the same requests → 400; (c) **SC-004** across confirmed and cancelled (guest- and staff-cancelled) reservations, serialize every 200 response of both operations and assert it contains neither the real secret code (read from the confirmation email via `lastCode()`), nor its hash (compute with `hashSecretCode`), nor the key names `secretCode` or `secretCodeHash` at any depth, and also in 400/404 bodies and in every captured `console` log line of the requests (no secret-code trace and no guest name/email/phone in logs); plus **500 case**: make `Reservation.find` / `Reservation.findById` reject once (spy) → 500 `INTERNAL_ERROR` standard body with no document, stack trace or personal data, nothing written; (d) every 2xx response carries `Cache-Control: no-store`; (e) **SC-008** read-only snapshot: dump `reservations, tablesdays, guestdays, tables, weeklyschedules, closeddates, staffmembers` (raw collections, sorted) before and after 100 mixed calls (valid, invalid-date, unknown id, malformed id, all three status choices, with and without a token) and assert deep equality and that the `FakeEmailSender` recorded no additional email; (f) `GET /reservations/<valid id>?foo=1` with a staff token → 400 naming `foo`; `GET /reservations/cancel` with a staff token is 404 `NOT_FOUND` "Reservation not found" (treated as an id), `POST /reservations/<id>` is still unrouted (404) and the three POST reservation routes (`POST /reservations`, `POST /reservations/cancel`, `POST /reservations/:id/cancel`) still behave
- [X] T018 [P] [US4] Create `backend/tests/unit/reservations.read-imports.test.ts`: read the source text of `backend/src/modules/reservations/reservations.read.service.ts` and fail if it imports (or mentions in an import specifier) `calendar.model`, `interval-claims`, `reservations.ops`, `notifier`, `email-sender`, `reservations.service` or `secret-code`; also assert it never references `secretCodeHash`, `secretCode` or `select("+`
- [X] T019 [US4] Run T017–T018 and record the outcome: the auth cases for `GET /reservations/<id>` and the import test are RED (route and service function missing); cases already satisfied by US1 (401 on the list, privacy, snapshot) pass on first run — record which ones

### Implementation for User Story 4

- [X] T020 [US4] Add a **skeleton** `readReservation(id: string): Promise<ReservationView>` to `backend/src/modules/reservations/reservations.read.service.ts` that only does `throw notFound(RESERVATION_NOT_FOUND_MESSAGE)` for every id (no database access yet). **Test-first scope (Constitution II)**: the real lookup (`findById`, table name resolution, `toReservationView`) is written in US3 (T030) after T028 is seen RED. Keep the module free of the forbidden imports (depends on T013)
- [X] T021 [US4] Add `read` to `backend/src/modules/reservations/reservations.controller.ts` (`RouteHandler<typeof ReservationIdParamsSchema, typeof ReservationReadQuerySchema, undefined>`): calls `readReservation(res.locals.input.params.id)`, sets `Cache-Control: no-store`, responds 200
- [X] T022 [US4] Register `GET /reservations/{id}` in `backend/src/modules/reservations/reservations.routes.ts` with `defineRoute` (staff `auth`, `request.params: ReservationIdParamsSchema`, `request.query: ReservationReadQuerySchema`, success 200 `ReservationViewSchema` with the example from contracts/api.md, errors `VALIDATION_ERROR` (unknown query parameter only) and `NOT_FOUND`; description exactly as in contracts/api.md, starting with `Staff sign-in required.`). Declare it **after** `POST /reservations/cancel` and keep `POST /reservations/:id/cancel` working
- [X] T023 [US4] Run T017–T018 and confirm GREEN, except the T017 cases that need a real 200 from `GET /reservations/{id}` (they stay RED on the skeleton, are recorded as such and are re-run at T031; US4 is marked done only after T031). Mutation check (do not commit): temporarily make `toReservationView` spread the row, confirm T002/T017 turn RED, restore; temporarily remove `no-store` from the list controller, confirm T017(d) turns RED, restore. Run the full suite

**Checkpoint**: The two operations are staff-only, secret-free, read-only and uncached.

---

## Phase 5: User Story 2 - Staff include or isolate cancelled reservations (Priority: P2)

**Goal**: `status=all` and `status=cancelled` work and cancelled items show `cancelledAt` / `cancelledBy`; the summary never changes with the choice.

**Independent Test**: Create reservations, cancel one as guest and one as staff, request the date three ways, and check contents and cancellation details.

### Tests for User Story 2 (write first)

- [X] T024 [US2] Create `backend/tests/integration/day-view-status.test.ts`: reservations on one date at different times, one cancelled by the guest (with its code) and one cancelled by staff (`cancelAsStaff`), plus others confirmed; (a) no `status` and `status=confirmed` → only confirmed, response `status: "confirmed"`; (b) `status=all` → both kinds in one start-time order (cancelled ones interleaved by time), response `status: "all"`; (c) `status=cancelled` → only cancelled; (d) **SC-002** the `summary` object is deeply equal under all three choices and counts confirmed only; (e) each cancelled item has `cancelledAt` equal to the fixed clock's ISO instant and `cancelledBy` `"guest"` or `"staff"` correctly; confirmed items have neither key; (f) a day with only cancelled reservations: default → empty list and zero summary, `status=cancelled` → them; (g) a reservation cancelled between two requests changes the lists and the summary consistently and each answer's list and summary agree (list under `confirmed` always matches `summary.reservations`); (h) a cancelled reservation whose table was later removed still shows its table name; (i) a cancelled reservation still shows the guest's name, email and phone; (j) cancelled pre-existing documents lacking `cancelledAt`/`cancelledBy` (inserted raw) are listed without those keys instead of failing
- [X] T025 [US2] Run T024 and record that it FAILS (RED): since `listDay` (T013) only returns confirmed reservations, the `status=all` and `status=cancelled` cases (b, c, e, f, h, i, j) must fail for that reason. Record exactly which cases were RED; cases that already pass (default view, summary equality) are kept as regression checks

### Implementation for User Story 2

- [X] T026 [US2] In `backend/src/modules/reservations/reservations.read.service.ts` make `listDay` honor the `status` argument: filter `confirmed` → confirmed, `cancelled` → cancelled, `all` → both, applied to the list only, with the summary still computed from all rows by `buildSummary` (confirmed only); echo the requested `status` in the answer. Fix anything else T024 shows failing in `reservation-view.domain.ts` (cancelled fields only when cancelled)
- [X] T027 [US2] Run T024 and confirm GREEN; run the full suite

**Checkpoint**: Cancelled reservations can be included or isolated without changing the summary.

---

## Phase 6: User Story 3 - Staff inspect one reservation by identifier (Priority: P2)

**Goal**: `GET /reservations/{id}` returns the same item as the day view, for any status and date; unknown or malformed ids are the standard 404.

**Independent Test**: Take an id from an affected-reservation report, read it, cancel it with the 003 staff operation, read it again.

### Tests for User Story 3 (write first)

- [X] T028 [US3] Create `backend/tests/integration/reservation-read.test.ts`: (a) a confirmed reservation read by id returns exactly the `ReservationView` keys (same value as the item in the day view for that reservation, deep equal), `Cache-Control: no-store`; (b) a cancelled reservation (guest and staff) shows `cancelledAt` / `cancelledBy`; (c) any date works (past, far future, closed date); (d) removed table → original name still shown, **SC-005**; renamed table → current name; (e) 404 `NOT_FOUND` with message exactly `Reservation not found` and standard body for: an unknown well-formed id, `"abc"`, 23 and 25 hex characters, `%20`, a 24-char id with a non-hex character, and a valid id in the wrong letter case that matches nothing; none of these is 400 or 500; (f) **SC-007** end to end: add a closed date on a day with reservations → take an id from `affectedReservations` → `GET /reservations/{id}` (confirmed) → `POST /reservations/{id}/cancel` (003) → `GET /reservations/{id}` shows `cancelledBy: "staff"` and a `cancelledAt`; the same id appears in `GET /reservations?date=…&status=all`; (g) FR-009 ids from the day view are accepted by both this operation and the staff cancellation
- [X] T029 [US3] Run T028 and record that it FAILS (RED): the T020 skeleton answers 404 for every id, so every 200 case (a–d, f, g) must fail for that reason; the 404 cases (e) pass on the skeleton and are kept as regression checks. Record which were RED

### Implementation for User Story 3

- [X] T030 [US3] Replace the T020 skeleton body in `backend/src/modules/reservations/reservations.read.service.ts` with the real `readReservation(id)`: `parseReservationId` → `null` ⇒ `throw notFound(RESERVATION_NOT_FOUND_MESSAGE)` before touching the database; `Reservation.findById(oid).lean()` (never selecting the hash) → absent ⇒ the same `notFound`; resolve the table name by `tableId` with `Table.findById(tableId, { name: 1 }).lean()` (no `removed` filter; same `"unknown"` + `table_missing` rule as `listDay`); return `toReservationView(row, name)`. Keep the module free of the forbidden imports
- [X] T031 [US3] Run T028 and confirm GREEN; re-run T017 (the cases left RED at T023) and confirm GREEN, then mark US3 and US4 done; run the full suite

**Checkpoint**: Report → inspect → cancel works using only returned identifiers.

---

## Phase 7: User Story 5 - Discoverable, consistent operations (Priority: P3)

**Goal**: Both operations are fully documented and follow the inherited error and strictness rules.

**Independent Test**: Read `/openapi.json`; send invalid requests and check every problem is reported at once.

### Tests for User Story 5 (write first)

- [X] T032 [P] [US5] Update `backend/tests/contract/openapi-coverage.test.ts` (research/Complexity Tracking): operations 19 → 21; add `GET /reservations` → `[400, 401, 500]` and `GET /reservations/{id}` → `[400, 401, 404, 500]` to `EXPECTED_ERRORS`; both carry the bearer `security` entry and descriptions starting `Staff sign-in required.`; `GET /reservations` documents the `date` query (required) and `status` query with its three values, has a request example, and its 200 schema references `DayView` with `ReservationView` and `ReservationSummary` registered as components; `GET /reservations/{id}` has the `id` path parameter, a 200 `ReservationView` example and no documented query parameter; the public set stays at 7 and the secured set grows by 2
- [X] T033 [P] [US5] Update `backend/tests/contract/auth-coverage.test.ts`: the secured-operation sweep includes both new operations (dummy `{id}`), each answers 401 without a token, and `GET /reservations` with no `date` and no token is still 401
- [X] T034 [P] [US5] Update `backend/tests/contract/error-shape.test.ts`: one case per new error path — single 400 (`GET /reservations/<id>?foo=1` with a token names `foo`; without a token it is 401), list 400 (all offending fields at once: `{ date: "2026-02-30", status: "pending" }` yields details naming `query.date` and `query.status` in one response; unknown parameter `?date=2026-11-14&foo=1` names `foo`; repeated `?status=all&status=confirmed` is refused), list 401, single 401, single 404 — each with the standard `{ error: { code, message, details? } }` body
- [X] T035 [P] [US5] Update `backend/tests/integration/no-code-leak.test.ts` (003 sweep): the sweep also calls `GET /reservations` with a valid `date` and `status=all`, and `GET /reservations/{id}` with real ids (confirmed and cancelled), so it inspects 200 bodies and not only 400s, still asserting no secret code, hash or derivative appears in any body or log line
- [X] T036 [US5] Run T032–T035 and record the outcome (pinned counts and new `EXPECTED_ERRORS` entries are RED until the documentation is complete; cases already satisfied by the routes registered in US1/US4 pass on first run — record which)

### Implementation for User Story 5

- [X] T037 [US5] Complete the documentation in `backend/src/modules/reservations/reservations.routes.ts` and `reservations.schemas.ts`: `ctx.registry.register("ReservationView", …)`, `"ReservationSummary"`, `"DayView"` as components; the `status` query parameter lists `confirmed` (default), `all`, `cancelled` with a description of each; all errors declared per route (`VALIDATION_ERROR` for the list; `VALIDATION_ERROR` and `NOT_FOUND` for the single read) so the generated responses are `[200, 400, 401, 500]` and `[200, 400, 401, 404, 500]` with examples; descriptions word-for-word from contracts/api.md; the `ReservationStatus` description explains `confirmed` / `cancelled`
- [X] T038 [US5] Run T032–T035 and confirm GREEN; run the full suite, `npm run typecheck` and `npm run lint`; open `/docs` once and verify both operations show the lock, the request example and every response (quickstart step 8)

**Checkpoint**: All five stories complete and documented.

---

## Phase 8: Performance (SC-010) and Polish

**Purpose**: The load budget, the README note and the final validation.

- [X] T039 Create `backend/tests/integration/day-view-performance.test.ts` (**SC-010**, modelled on `backend/tests/integration/performance.test.ts`): seed 100 tables, one weekly schedule, 500 closed dates and 10,000 reservations across many dates (raw `insertMany` with a unique `secretCodeHash` each, sorted so inserted data is not trivially ordered) plus one day with 200 reservations (mixed confirmed/cancelled, many tables); 10 concurrent clients repeating `GET /reservations?date=<busy day>&status=all` and `GET /reservations/<id>` for several rounds; assert p95 < 1000 ms and that the busy-day answer has the expected 200 + counts; **mutation check** (do not commit): temporarily drop the `{ date: 1 }` index (or make the filter a full scan), confirm the test turns red or measurably slower, restore
- [X] T040 [P] Document in `backend/README.md`: the two new endpoints (staff only, `no-store`, example calls from quickstart.md), the `status` choices, that the summary is confirmed-only, and the known debt "no paging: a very large day is returned whole" (research R9)
- [X] T041 [P] Update the "operations" counts anywhere they are written in `backend/README.md` or docs (19 → 21 documented, public 7, secured +2) if present
- [X] T042 Run the full quickstart: `npm run typecheck && npm run lint && npm test` in `backend/`, then the manual walk-through steps 1–8 of `specs/004-staff-day-view/quickstart.md` against a running server and a real MongoDB, and record the results; confirm the 003 suites pass untouched
- [X] T043 Re-check the Constitution gate (plan.md): no new dependency (`git diff backend/package.json backend/package-lock.json` is empty), no schema/index change (`git diff backend/src/modules/*/*.model.ts` is empty), no new config key or error code

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all stories.
- **US1 (Phase 3, P1)**: after Foundational. Creates `listDay`, `list`, the list route.
- **US4 (Phase 4, P1)**: after US1 (needs the read service file and the list route); creates `readReservation`, `read` and the single-read route.
- **US2 (Phase 5, P2)** and **US3 (Phase 6, P2)**: after US4; independent of each other. US4 is marked done only after US3 (T031), because its 200 cases on the single read need the real `readReservation`. Test-first rule: `listDay` implements only `confirmed` until T026, and `readReservation` is a skeleton until T030, so US2 and US3 tests are RED before their implementation.
- **US5 (Phase 7, P3)**: after US1 and US4 (needs both routes registered); can run in parallel with US2/US3.
- **Polish (Phase 8)**: after all stories.

### Within Each Story

- Tests are written first and seen failing (or, for verification-only cases already satisfied, proven able to fail by a mutation) before implementation.
- Pure functions → read service → controller → route.
- T014/T021 and T015/T022 edit the same controller/routes files: do them in order, not in parallel.

### Parallel Opportunities

- Phase 2: T002, T003, T004 (different test files); T006, T008, T009 (different source files).
- Phase 4: T017 and T018.
- Phase 7: T032–T035 (four different test files).
- Phase 8: T040 and T041.
- After US4, US2 (T024–T027), US3 (T028–T031) and US5 (T032–T038) can proceed in parallel by different developers; keep edits to `reservations.routes.ts` serialized.

### Parallel Example: Foundational

```bash
Task: "Create backend/tests/unit/reservation-view.domain.test.ts"
Task: "Create backend/tests/unit/reservation-id.test.ts"
Task: "Extend backend/tests/unit/reservations.schemas.test.ts"
# then
Task: "Create backend/src/modules/reservations/reservation-id.ts"
Task: "Create backend/src/modules/reservations/reservation-view.domain.ts"
Task: "Extend backend/src/modules/reservations/reservations.schemas.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US4)

1. Phase 1 Setup, Phase 2 Foundational.
2. Phase 3 US1 → staff can list a day.
3. Phase 4 US4 → privacy, read-only and the single read are guaranteed. **STOP and VALIDATE**: a signed-in staff member sees the day, anonymous callers get 401, no code leaks, nothing is written. This is the smallest releasable increment (both P1 stories).

### Incremental Delivery

1. Foundation → US1 → US4 (MVP) → demo.
2. US2 (cancelled reservations) and US3 (single-reservation inspection, closes the closure-handling workflow) → demo.
3. US5 (documentation pins) → Performance and Polish.
4. The full suite runs at every checkpoint.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] labels map tasks to spec.md user stories; Setup, Foundational and Polish tasks carry none.
- A story is done only when its tests were written first, seen failing (or proven able to fail by mutation when already satisfied) and now pass.
- Never weaken a test to make it pass.
- Commit only when the user asks; do not push.
