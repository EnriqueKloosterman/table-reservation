# Implementation Plan: Staff Day View of Reservations

**Branch**: `004-staff-day-view` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-staff-day-view/spec.md`

## Summary

Two read-only, staff-only operations in the existing reservations module:
`GET /reservations?date&status` (the day's reservations in chronological order plus a
confirmed-only summary) and `GET /reservations/{id}` (one reservation). Both answer with
the same item shape as the creation confirmation of feature 002, without `secretCode`, plus
`cancelledAt` / `cancelledBy` only when cancelled, and both send `Cache-Control: no-store`.

The day is read with **one** query (`Reservation.find({ date }).lean()`, all statuses) on
the restaurant-local `date` text with the existing `{ date: 1 }` index; table names come
from **one** `Table.find({ _id: { $in } })` that includes removed tables. Filtering by
status, the summary, the ordering and the response whitelist are pure in-memory functions
over that single snapshot, so list and summary can never disagree. No schema, index,
dependency or constitution change ([research](./research.md)).

## Technical Context

**Language/Version**: TypeScript ~6.0.3 (strict, ESM, `nodenext`) on Node.js (min 22.12), unchanged.

**Primary Dependencies**: unchanged (Express 5, Zod 4, `@asteasolutions/zod-to-openapi`, Mongoose 9, jose, nodemailer). **No additions.**

**Storage**: MongoDB via Mongoose. **No new model, field or index.** Reads `reservations` and `tables` only.

**Testing**: Vitest + Supertest + mongodb-memory-server; `FakeEmailSender` is used only to prove nothing is sent.

**Target Platform**: Node server, HTTP JSON API, no UI.

**Project Type**: Web service (`backend/` of the monorepo).

**Performance Goals**: SC-010 — p95 < 1 s for a day of 200 reservations among 10,000, under the 002 load profile (10 concurrent requests, 100 tables, 500 closed dates).

**Constraints**: read-only (SC-008); staff sign-in before validation (401 before 400); the secret code and its hash never selected or returned; `no-store`; check order route → sign-in → validation → not found; all offending fields reported at once; unknown query parameters refused.

**Scale/Scope**: 2 new operations (21 documented in total, public set stays 7, secured set +2), 0 new error codes, 0 new config keys, 5 user stories.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.2.0.

| Principle | Requirement | How this plan complies | Status |
|---|---|---|---|
| I. Monorepo, contract-first | OpenAPI from Zod at `/docs`; shape changes reflected | Both operations go through `defineRoute`; the item, summary, day-view and query schemas are Zod and feed `/openapi.json`. Contract tests pin 21 operations and the new responses. | ✅ |
| II. Test-first (NON-NEGOTIABLE) | Failing tests first; mongodb-memory-server; doubles for side effects | RED recorded before each story, pure functions first. No SMTP is involved; `FakeEmailSender` only asserts silence. | ✅ |
| III. Integrity at DB level; local text not UTC; email via interface | No overlap rule touched; instants UTC; local values as text | Read-only: no claim, release, write or email. The day filter is equality on the restaurant-local `date` text (no UTC conversion). `createdAt` / `cancelledAt` are UTC instants rendered ISO-8601. | ✅ |
| IV. HTTP semantics, error shape, Zod first | Correct statuses; standard body; Zod before domain | 200/400/401/404/500; strict Zod query schema validated before any read; the single read reuses the 003 strict 24-hex parsing and its exact `NOT_FOUND` message. | ✅ |
| V. Simplicity, minimal deps | Justify each package; YAGNI | No new package (table below). No paging, no new index, no cache. | ✅ |
| Stack & constraints | JWT on staff endpoints only | Both operations use the existing `requireAuth`. They are the first staff reads of guest personal data, hence `no-store`. | ✅ |
| Workflow | Spec Kit flow; English; stories done only after RED → GREEN | spec → plan → tasks → implement; all in English. | ✅ |

**Gate result (pre-research)**: PASS — compliant, no deviation to justify.
**Gate result (post-design re-check)**: PASS. Design added no violation. The only item
needing care is spec wording: FR-004 / US2.6 say the table shows "the name it had when it
was assigned", while the spec's last assumption says a rename shows the new name. The plan
follows the last assumption ([R3](./research.md#r3-table-name-resolution)); removal never
changes the display and no stored field is added.

### Dependency justification (Principle V)

| Package | Used for | Why the standard library / existing stack is not enough |
|---|---|---|
| _none added_ | — | Natural-order name tie-break uses `Intl.Collator` (Node built-in); distinct counting uses `Set`; validation, OpenAPI, auth and persistence reuse Zod, `defineRoute`, `requireAuth` and Mongoose already in the stack. |

Rejected: pagination/query-builder libraries (paging is out of scope), a caching layer
(responses are `no-store`), `date-fns`/`luxon` (the day filter is a text equality, there is
nothing to convert).

## Project Structure

### Documentation (this feature)

```text
specs/004-staff-day-view/
├── plan.md              # This file
├── research.md          # Phase 0 (R1–R9)
├── data-model.md        # Phase 1 (read model, no schema change)
├── quickstart.md        # Phase 1 (validation guide)
├── contracts/
│   └── api.md           # Phase 1 (both operations)
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
backend/
├── src/modules/reservations/
│   ├── reservation-view.domain.ts   # NEW pure: sortReservations, buildSummary, toReservationView
│   ├── reservation-id.ts            # NEW shared strict 24-hex parse + NOT_FOUND message (extracted from reservations.service.ts)
│   ├── reservations.read.service.ts # NEW read-only: listDay(date, status), readReservation(id); imports no write helper, claim/release or notifier
│   ├── reservations.schemas.ts      # + ReservationListQuerySchema, ReservationViewSchema, ReservationSummarySchema, DayViewSchema, examples
│   ├── reservations.controller.ts   # + list, read handlers (Cache-Control: no-store)
│   ├── reservations.routes.ts       # + GET /reservations, GET /reservations/:id
│   └── reservations.service.ts      # only change: uses reservation-id.ts instead of its private regex/message
└── tests/
    ├── unit/reservation-view.domain.test.ts      # NEW
    ├── unit/reservations.read-imports.test.ts    # NEW (read module imports no write helper/notifier)
    ├── integration/day-view.test.ts              # NEW  US1
    ├── integration/day-view-status.test.ts       # NEW  US2
    ├── integration/reservation-read.test.ts      # NEW  US3
    ├── integration/day-view-privacy.test.ts      # NEW  US4 (auth, secrecy, read-only snapshot)
    ├── integration/day-view-performance.test.ts  # NEW  SC-010
    ├── contract/{openapi-coverage,auth-coverage,error-shape}.test.ts   # CHANGED (see Complexity Tracking)
    └── integration/no-code-leak.test.ts          # CHANGED
```

**Structure Decision**: Existing `backend/` modular layout (routes → controller → service,
pure `*.domain.ts`). The read path lives in its own service file so the read-only guarantee
is checkable by its imports; routes stay in the reservations module.

## Complexity Tracking

No constitution violation. Changes to existing tests are recorded here as required:

| Existing test | Change | Why |
|---|---|---|
| `tests/contract/openapi-coverage.test.ts` | operations 19 → 21; add `GET /reservations` → `[400, 401, 500]` and `GET /reservations/{id}` → `[401, 404, 500]` to `EXPECTED_ERRORS`; the public set stays 7, the secured set grows by 2 | two new documented operations |
| `tests/contract/auth-coverage.test.ts` | the secured-operation sweep includes both new operations; `GET /reservations` with no `date` and no token still answers 401 | auth is checked before the query |
| `tests/integration/no-code-leak.test.ts` (003 T041a) | the sweep calls `GET /reservations` with a valid `date` and `GET /reservations/{id}` with real ids | otherwise it would see only 400 responses and prove nothing |
| `tests/contract/error-shape.test.ts` | one case per new error path (list 400/401, single 401/404) | standard error body on every path |
| `src/modules/reservations/reservations.service.ts` (non-test) | its private `OBJECT_ID` and `NOT_FOUND_MESSAGE` move to `reservation-id.ts`, no behavior change; 003 tests must stay green untouched | one shared strict id parse for the three id-based operations |
