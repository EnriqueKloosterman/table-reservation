# Implementation Plan: Availability Lookup and Guest Reservations

**Branch**: `002-guest-reservations` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-guest-reservations/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Public availability lookup (yes/no with a reason, and a list of bookable times per service
period) and guest reservations with automatic table assignment, built on the feature 001
backend. Availability is decided by pure, unit-tested domain functions over a fresh
snapshot (schedule, closed date, non-removed tables, existing intervals). The no-double-
booking guarantee is enforced in MongoDB without transactions: per-day calendar documents
(`TableDay`, `GuestDay`) with a unique key, claimed by one atomic conditional `$push`. Local
time ↔ UTC conversion uses `Intl` only; the secret code uses `node:crypto`. Three 001 staff
operations gain an informational `affectedReservations` list, and table removal is refused
while upcoming reservations exist. No new dependencies.

## Technical Context

**Language/Version**: TypeScript ~6.0.3 (strict, ESM, `nodenext`) on Node.js 24 LTS (min 22.12), unchanged from 001.

**Primary Dependencies**: unchanged from 001 (express ^5.3, mongoose ^9.12, zod ^4.6, @asteasolutions/zod-to-openapi ^9.1, swagger-ui-express ^5.0, jose ^6.2, cors ^2.8). Standard library: `Intl.DateTimeFormat`, `Intl.Collator`, `node:crypto`. **No additions** (table below).

**Storage**: MongoDB via Mongoose, plain `mongod` (no replica set). New collections: `reservations`, `tabledays` (unique `{ tableId, date }`), `guestdays` (unique `{ email, date }`).

**Testing**: Vitest ^5.1 + Supertest ^7.3 + mongodb-memory-server ^11.3: unit (time, availability domain, table choice), integration per story (including concurrency), contract (extended 001 suites), performance.

**Target Platform**: Node 24 LTS server, HTTP JSON API, no UI.

**Project Type**: Web service (`backend/` of the monorepo).

**Performance Goals**: SC-006 — p95 < 1 s for availability, times and reservation under 10 concurrent requests with 100 tables, 500 closed dates, 10,000 reservations. A lookup reads ≤ 100 `TableDay` docs of one date by unique-index prefix; `listBookableTimes` is O(grid × tables × intervals) in memory (≈ 60 × 100 × small).

**Constraints**: FR-011/FR-026 must hold under concurrency at the database level; validation before any read/write; refusal order validation → duplicate → availability; instants UTC, local values text; no transactions; no new packages.

**Scale/Scope**: 3 new operations (17 documented in total), 3 changed responses, 1 changed rule (table removal), 5 user stories, 4 new config keys.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Requirement | How this plan complies | Status |
|---|---|---|---|
| I. Monorepo, contract-first | OpenAPI from Zod at `/docs`; shape changes reflected | New schemas registered through `defineRoute`; the three changed responses and the `DELETE /tables` rule are updated in their Zod schemas/route definitions, so `/openapi.json` follows. | ✅ |
| II. Test-first (NON-NEGOTIABLE) | Failing tests first; mongodb-memory-server; mocks for side effects | Each story starts with unit/integration tests run RED. Concurrency tests use `Promise.all` against mongodb-memory-server. No external side effects (no email, FR-015). Verification-only suites use the 001 mutation check. | ✅ (deviation inherited, see Complexity Tracking) |
| III. Integrity at DB level; time rules | No overlapping reservations, enforced in the DB; instants UTC; local values text | Atomic conditional `$push` on unique per-day documents ([R5](./research.md#r5-enforcing-no-two-overlapping-reservations-per-table-without-transactions)) — an "atomic conditional write", explicitly allowed. `startAt`/`endAt`/`createdAt` UTC; `date`/`startTime`/`endTime` text snapshots. Email interface not needed yet (no email in this feature). | ✅ |
| IV. HTTP semantics, error shape, Zod first | Correct statuses; standard error body; Zod before domain | 200/201/400/404/409/500. New `NO_AVAILABILITY` (409) with `details.reason`, distinguishable from `CONFLICT` (FR-025); strict Zod query/body schemas. | ✅ |
| V. Simplicity, minimal deps | Justify each dependency; YAGNI | No new dependency (`Intl`, `node:crypto`). No transactions, sweeper, rate limiter, or customer accounts. | ✅ |
| Stack & constraints | JWT only on staff endpoints; customer endpoints public; env via Zod | The 3 new operations are public; 4 new env keys in `EnvSchema`, `.env.example` and README. | ✅ |
| Workflow | Spec Kit flow; English | spec → plan → tasks → implement; all in English. | ✅ |

**Gate result (pre-research)**: PASS. No constitution amendment needed.
**Gate result (post-design re-check)**: PASS. One refinement of the input design is recorded
in [R10](./research.md#r10-table-removal-vs-reservation-race-fr-017): table removal checks the
claimed intervals in `TableDay` rather than the `Reservation` collection, because the
reserve flow inserts the reservation after its re-check and a `Reservation`-based check
would miss an in-flight claim. This strengthens Principle III, it does not deviate from it.

### Dependency justification (Principle V)

| Package | Used for | Why the standard library is not enough |
|---|---|---|
| *(none added)* | — | `Intl.DateTimeFormat` covers zone conversion and DST detection; `Intl.Collator` natural ordering; `node:crypto` the secret code and SHA-256; Mongoose the atomic updates. |

Rejected on purpose: Luxon, date-fns-tz, a Temporal polyfill, rate limiters, job schedulers
([R15](./research.md#r15-dependency-justification-principle-v)).

## Project Structure

### Documentation (this feature)

```text
specs/002-guest-reservations/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R15
├── data-model.md        # Phase 1: collections, indexes, claim operations, pure functions
├── quickstart.md        # Phase 1: run & validation guide
├── contracts/
│   └── api.md           # Phase 1: HTTP contract delta over 001
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

New files are marked `+`, changed files `~`.

```text
backend/
├── .env.example                      ~ 4 booking-rule keys
├── README.md                         ~ config keys, public operations, known debt
├── src/
│   ├── app.ts                        ~ register availability + reservation routes
│   ├── config/env.ts                 ~ RESERVATION_DURATION_MINUTES, TIME_SLOT_INTERVAL_MINUTES, MIN_NOTICE_MINUTES, BOOKING_HORIZON_DAYS
│   ├── shared/
│   │   ├── errors/app-error.ts       ~ NO_AVAILABILITY (409), noAvailability(reason), conflict(message, details?)
│   │   ├── openapi/common.ts         ~ ERROR_CODES, ErrorResponse.details oneOf + { reason }
│   │   ├── openapi/route.ts          ~ CODE_MEANING.NO_AVAILABILITY
│   │   └── time/local-time.ts        + localToUtc, utcToLocal, addDays, dayOfWeek, overlaps
│   └── modules/
│       ├── availability/
│       │   ├── availability.domain.ts      + Reason, checkAvailability, listBookableTimes, chooseTables
│       │   ├── availability.snapshot.ts    + loadDaySnapshot(date, deps): schedule, closed date, tables, TableDays
│       │   ├── availability.schemas.ts     + query schemas (strict, partySize string), response schemas
│       │   ├── availability.service.ts     + checkAvailabilityFor, listTimesFor
│       │   ├── availability.controller.ts  +
│       │   └── availability.routes.ts      + GET /availability, GET /availability/times (public)
│       ├── reservations/
│       │   ├── reservation.model.ts        + Reservation (+ 3 indexes)
│       │   ├── calendar.model.ts           + TableDay, GuestDay (unique keys)
│       │   ├── interval-claims.ts          + claimInterval, releaseInterval
│       │   ├── secret-code.ts              + generateSecretCode, hashSecretCode
│       │   ├── affected.domain.ts          + isInsideSchedule
│       │   ├── affected.ts                 + affectedByClosedDate / BySchedule / ByCapacity
│       │   ├── reservations.schemas.ts     + CreateReservation body, Reservation confirmation, AffectedReservation
│       │   ├── reservations.service.ts     + createReservation (reserve flow, R6)
│       │   ├── reservations.controller.ts  +
│       │   └── reservations.routes.ts      + POST /reservations (public)
│       ├── tables/                   ~ service: removal rule (R10), affected on capacity; schemas/routes: response + 409 docs
│       ├── schedule/                 ~ service/schemas/routes: { days, affectedReservations }
│       └── closed-dates/             ~ service/schemas/routes: affectedReservations
└── tests/
    ├── helpers/                      ~ seedRestaurant (tables + schedule + closed dates), reserveAs, freezeAt
    ├── unit/                         + local-time, availability.domain, choose-tables, affected.domain,
    │                                   reservations.schemas, secret-code; ~ env (4 keys)
    ├── integration/                  + availability (US1), reservations (US2), reservations.concurrency (US2),
    │                                   availability-times (US3), reservation-protection (US4)
    │                                 ~ tables, schedule, closed-dates (new response fields), performance (SC-006)
    └── contract/                     ~ auth-coverage (6 public ops), openapi-coverage (17 ops, reasons, examples),
                                        error-shape (NO_AVAILABILITY, conflict reasons)
```

**Structure Decision**: Same module layering as 001 (routes → controller → service, pure
logic in `*.domain.ts`). Availability and reservations are separate modules because the
lookups are read-only and reusable by the reserve flow (`loadDaySnapshot` +
`checkAvailability`), while everything that writes reservation data (models, claims,
secret code, affected-report queries) lives in `reservations/`. The 001 modules import
`reservations/affected.ts` and `calendar.model.ts`; nothing in `reservations/` imports a
001 service. Time helpers are shared (`src/shared/time/`) because both modules and the
affected reports use them.

## Key Design Decisions

Full rationale in [research.md](./research.md).

1. **Booking rules in env** (R1): four Zod-validated integers with defaults; fail fast.
2. **Time** (R2, R3): `Intl`-based `localToUtc` (gap → `null`, fold → first occurrence) and
   `utcToLocal`; containment on wall-clock minutes, `endAt` in real time.
3. **Pure availability** (R7, R9): `checkAvailability` and `listBookableTimes` take a full
   snapshot including `now`; the list is produced by running the check on each grid time,
   so SC-004 holds by construction. `chooseTables` returns ordered candidates.
4. **Atomic claims** (R5): `TableDay`/`GuestDay` documents, conditional `$push` with upsert
   and a single retry on `11000`. Works on plain `mongod`.
5. **Reserve flow** (R6): validate → duplicate pre-read → availability → guest claim → table
   claims in candidate order with re-check → insert → confirmation; releases on every
   failure path.
6. **Table removal** (R10): set removed → check `TableDay` claims ending after now → revert +
   409 if any.
7. **Affected reports** (R11): computed after the change, informational, `endAt > now`.
8. **Errors** (R13): `NO_AVAILABILITY` 409 `{ reason }`; new conflicts carry a reason.
9. **Secret code** (R8): 32 random bytes base64url, SHA-256 stored with `select: false`.

## Testing Strategy

- **Order per story**: unit tests for that story's pure functions, then integration tests
  for every acceptance scenario, run and recorded RED; implement GREEN; refactor.
- **Clock**: every integration test pins `now` with `fixedClock` and uses a non-UTC zone
  in at least one file, so "today", notice and horizon are checked in restaurant time.
- **Fixtures fit the scenario**: periods long enough for the reservation (e.g. dinner
  18:00–23:30); a 22:00 start never fits with the default 120 minutes (R14).
- **Concurrency** (`Promise.all`, real mongodb-memory-server): SC-002 20 × 50 rounds with a
  direct `TableDay` overlap assertion; same-email pair; candidate fallback; removal race in
  both orderings; insert failure leaves no intervals.
- **Reason coverage** (SC-003): one unit case and at least one HTTP case per reason, for
  both lookups and the reserve operation.
- **Contract**: extend the 001 suites; new operations public, documented, examples present,
  reasons described, standard error shape for `NO_AVAILABILITY` and the conflict reasons.
- **Performance** (SC-006): seeded through models; proven able to fail by mutation.

## Phase Ordering (input for `/speckit-tasks`)

1. **Foundational (blocks all stories)**:
   config keys (+ env unit tests); `NO_AVAILABILITY` in `ErrorCode`/`ERROR_STATUS`/
   `ERROR_CODES`/`CODE_MEANING`/`ErrorResponseSchema` (+ error-shape case); `local-time`
   (unit tests first, DST zones); `availability.domain` + `chooseTables` (unit tests first,
   one case per reason, SC-004 invariant); models `Reservation`, `TableDay`, `GuestDay`
   registered for `initModels`; `claimInterval`/`releaseInterval` (integration tests first,
   including concurrent claims); test helpers; adjust 001 tests that pin exact bodies and
   operation sets (see Complexity Tracking).
2. **US1 Availability check (P1)**: snapshot loader, query schemas, service, controller,
   public route; integration scenarios 1–9.
3. **US2 Reserve (P1)**: secret code, body schema, reserve flow, public route; scenarios 1–9,
   concurrency suite, insert-failure test.
4. **US3 Bookable times (P2)**: times schema/service/route; scenarios 1–7, SC-004 HTTP check
   across one week with a closed date.
5. **US4 Configuration vs reservations (P2)**: removal rule + race tests; affected reports
   on closed dates, schedule and table update; OpenAPI updates of the four 001 operations.
6. **US5 Discoverability (P3)**: contract suites (17 ops, 6 public, reasons, examples, error
   shape), documentation review.
7. **Polish**: SC-006 performance test, README (config keys, public operations, known debt:
   orphan-interval crash window, no rate limiting on public operations), quickstart run.

## Complexity Tracking

| Deviation / change | Principle | Why it is needed | Simpler alternative rejected because | Mitigation |
|---|---|---|---|---|
| Verification-only suites (`auth-coverage`, `error-shape`, `performance`) may pass when first extended, as in 001. | II | They check cross-cutting properties of operations built in US1–US4. | Writing them earlier means listing operations that do not exist. | Same recorded mutation check as 001 before counting GREEN. The `openapi-coverage` extension (17 ops, reasons documented) is genuinely RED until US5. |
| 001 test `tests/integration/tables.test.ts` (T050) asserts exact `PATCH /tables/{id}` bodies `{ id, name, capacity }`. | II (tests stay authoritative) | FR-022 adds `affectedReservations` to the response. | Leaving the assertions would make the additive change fail the 001 suite. | Updated in Foundational/US4 to expect `affectedReservations: []`; recorded RED before the response change. |
| 001 test `tests/integration/schedule.test.ts` (T059) asserts `PUT /schedule` returns exactly `{ days }`. | II | Response becomes `{ days, affectedReservations }`. | Same as above. | Same as above. |
| 001 test `tests/integration/closed-dates.test.ts` (T069) asserts `POST /closed-dates` returns exactly `{ date, reason }`. | II | Response gains `affectedReservations`. | Same as above. | Same as above. |
| 001 test `tests/integration/tables.test.ts` asserts unconditional `DELETE /tables/{id}` → 204. | II | FR-017 refuses removal with upcoming reservations. | — | Existing cases have no reservations and still expect 204; new 409 cases added in US4. |
| 001 contract tests pin the public-operation set (3) and the operation count (14). | I, II | Three public operations are added. | — | Updated to 6 public operations and 17 operations in US5. |
| `DELETE /tables/{id}` checks `TableDay` claims instead of `Reservation` documents (refines the input design). | III | Closes the claim → re-check → remove → insert interleaving ([R10](./research.md#r10-table-removal-vs-reservation-race-fr-017)). | A `Reservation` check misses in-flight reservations. | Race tests in both orderings; worst case is a spurious 409. |
| Orphan-interval window on crash between claim and insert. | III (documented residual risk) | No transactions on plain `mongod`. | Replica-set transactions add an infrastructure requirement; a sweeper adds a background job (YAGNI). | Documented as known debt in README and research R5. |
