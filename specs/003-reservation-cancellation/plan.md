# Implementation Plan: Confirmation Email and Reservation Cancellation

**Branch**: `003-reservation-cancellation` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-reservation-cancellation/spec.md`

## Summary

A confirmation email on every created reservation, a cancellation email on every cancellation,
a public guest cancellation by secret code (`POST /reservations/cancel`) and a staff
cancellation by id (`POST /reservations/{id}/cancel`). Email goes through an `EmailSender`
interface (Nodemailer SMTP, or a logging no-op when `SMTP_URL` is absent) behind a notifier
that is never awaited, is bounded by a timeout, swallows every error and logs failures
without the code, the address or the SMTP message. Cancellation is an atomic conditional
claim on the reservation (`confirmed` and not started → `cancelled`), **then** idempotent
release of the `TableDay` and `GuestDay` intervals, so a failure can only hide a slot, never
double-book it ([R2](./research.md#r2-why-the-status-flips-before-the-releases-double-booking-argument)).
Existing availability, assignment, duplicate-check and removal rules already read those
intervals and need no query change; only the affected-reservation reports gain
`status: "confirmed"`.

## Technical Context

**Language/Version**: TypeScript ~6.0.3 (strict, ESM, `nodenext`) on Node.js (min 22.12; verified on 22.16), unchanged.

**Primary Dependencies**: unchanged from 001/002 plus **nodemailer ^10.3** (verified: release 10.3.1, Node >=20, ESM `exports` map, bundled typings, no install errors; [R1](./research.md#r1-nodemailer-release-and-typescript-types)). `@types/nodemailer` is **not** added (nodemailer ships its own types; verified with `tsc --strict` without it).

**Storage**: MongoDB via Mongoose, plain `mongod`. `reservations` gains `cancelledAt`, `cancelledBy`, status value `cancelled` and a unique index on `secretCodeHash`. No other collection changes.

**Testing**: Vitest + Supertest + mongodb-memory-server; SMTP replaced by `FakeEmailSender` (no test needs an SMTP server).

**Target Platform**: Node server, HTTP JSON API, no UI.

**Project Type**: Web service (`backend/` of the monorepo).

**Performance Goals**: SC-010 — p95 < 1 s for cancellation responses under the 002 load profile, including with a failing or slow sender (the email never sits on the request path).

**Constraints**: a cancellation never reports success while a hold may remain (FR-008); exactly one winner among concurrent cancellations (FR-015); identical `NOT_FOUND` for every bad code (FR-011); the code never in any response after creation, any URL or any log; validation before any change; refusal order route → auth (staff) → validation → not found → conflicts.

**Scale/Scope**: 2 new operations (19 documented in total, public set 6 → 7), 2 new error codes, 1 changed query module, 1 changed create flow (one added call), 5 new config keys, 5 user stories.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.2.0.

| Principle | Requirement | How this plan complies | Status |
|---|---|---|---|
| I. Monorepo, contract-first | OpenAPI from Zod at `/docs`; shape changes reflected | New operations and the `ReservationStatus` enum, `ALREADY_CANCELLED` / `CANNOT_CANCEL` codes are registered through `defineRoute` and the shared `ErrorResponse` schema, so `/openapi.json` follows. Contract tests pin 19 operations. | ✅ |
| II. Test-first (NON-NEGOTIABLE) | Failing tests first; mongodb-memory-server; external effects replaced by doubles, SMTP included | RED recorded before each story. All email behavior is tested through `FakeEmailSender`; no test needs an SMTP server. Concurrency uses `Promise.all` on mongodb-memory-server. | ✅ |
| III. Integrity at DB level; email behind an interface | No overlap enforced in the DB; instants UTC; email through an interface, never failing a reservation | The cancel claim is one atomic conditional write; releases are idempotent `$pull`s; flip-before-release keeps double booking impossible ([R2](./research.md#r2-why-the-status-flips-before-the-releases-double-booking-argument)). `cancelledAt` is a UTC instant. Email only via `EmailSender`; its failure never changes a reservation or cancellation. | ✅ |
| IV. HTTP semantics, error shape, Zod first | Correct statuses; standard error body; Zod before domain | 200/400/401/404/409/500; new `ALREADY_CANCELLED` and `CANNOT_CANCEL` (409) with distinct machine codes; strict Zod body for the guest operation; ids parsed before lookup. | ✅ |
| V. Simplicity, minimal deps; SMTP the only added external runtime dependency | Justify each package; SMTP only via the interface; unavailable SMTP never blocks start or a reservation/cancellation | One package, justified below. `SMTP_URL` optional; absent → `NoopEmailSender` logs the skip. SMTP unavailability, slowness or misconfiguration only produces a logged `email_failed`. No transactions, queue, retry worker or rate limiter. | ✅ |
| Stack & constraints | JWT on staff endpoints only; customer endpoints public; env via Zod; no secrets committed | Guest cancel is public; staff cancel uses the existing bearer auth. Five new keys validated in `EnvSchema`, documented in `.env.example` (placeholders only) and README. | ✅ |
| Workflow | Spec Kit flow; English; stories done only after RED → GREEN | spec → plan → tasks → implement; all in English. | ✅ |

**Gate result (pre-research)**: PASS — compliant, no deviation to justify.
**Gate result (post-design re-check)**: PASS. Design added no violation: the only residual
integrity risk (a cancelled reservation still holding intervals after a failed release) can
only hide a slot, is repaired by an idempotent retry and is recorded as known debt.

### Dependency justification (Principle V)

| Package | Used for | Why the standard library is not enough |
|---|---|---|
| `nodemailer` (^10.3, runtime) | The `NodemailerSender` implementation of `EmailSender`: SMTP delivery (connection, STARTTLS/TLS, authentication, MIME encoding, address and header sanitizing) | Node has no SMTP client; `node:net`/`node:tls` would force a hand-written SMTP/STARTTLS/AUTH/MIME implementation, which is more code and more risk than one maintained, dependency-free package. It ships its own TypeScript types, so no `@types` package is needed. |

Rejected: `@types/nodemailer` (redundant, [R1](./research.md#r1-nodemailer-release-and-typescript-types)),
HTTP email-provider SDKs (a further external service), job queues/retry libraries (retries
are out of scope), rate limiters (out of scope).

## Project Structure

### Documentation (this feature)

```text
specs/003-reservation-cancellation/
├── plan.md              # This file
├── research.md          # Phase 0 (R1–R12)
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── api.md           # Phase 1: the two operations, error codes, email contract
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
backend/
├── .env.example                          # + SMTP_URL, EMAIL_FROM, EMAIL_TIMEOUT_MS, RESTAURANT_NAME, CANCEL_LINK_BASE_URL
├── README.md                             # + config keys, operations, Mailpit, known debt
├── package.json                          # + nodemailer
├── src/
│   ├── app.ts                            # builds the sender + notifier from config; passes the notifier to reservation routes
│   ├── server.ts                         # (unchanged logic; app builds the notifier from Config)
│   ├── config/env.ts                     # + 5 keys, SMTP_URL/EMAIL_FROM cross-rule
│   ├── db/connection.ts                  # (unchanged; the unique index is built by initModels)
│   ├── shared/
│   │   ├── errors/app-error.ts           # + ALREADY_CANCELLED, CANNOT_CANCEL, ERROR_STATUS (409), factories
│   │   └── openapi/{common,route}.ts     # ERROR_CODES + CODE_MEANING extended
│   └── modules/
│       ├── notifications/                # NEW
│       │   ├── email-sender.ts           # EmailSender interface, NodemailerSender, NoopEmailSender, createEmailSender(config)
│       │   ├── email-templates.ts        # renderConfirmationEmail, renderCancellationEmail (pure)
│       │   └── notifier.ts               # createNotifier(sender, config): notifyConfirmation / notifyCancellation / idle()
│       └── reservations/
│           ├── reservation.model.ts      # status enum + cancelledAt/cancelledBy + unique secretCodeHash index
│           ├── reservations.schemas.ts   # CancelBody, CancellationResult, ReservationStatus enum
│           ├── reservations.service.ts   # + cancelReservation; createReservation calls notifyConfirmation
│           ├── reservations.controller.ts# + cancelByCode, cancelByStaff
│           ├── reservations.routes.ts    # + 2 routes
│           └── affected.ts               # every query: status "confirmed"
└── tests/
    ├── helpers/{fake-email-sender,build-test-app}.ts   # FakeEmailSender; emailSender + onNotifier options
    ├── unit/{email-templates,notifier,env}.test.ts
    ├── integration/{confirmation-email,cancel-guest,cancel-staff,cancel-rules,cancel-concurrency,cancel-release-failures,performance}.test.ts
    └── contract/{auth-coverage,openapi-coverage,error-shape}.test.ts   # updated
```

**Structure Decision**: extend the existing `backend/` layering (routes → controller →
service). The new `notifications` module is separate from `reservations` so the service
depends only on the small notifier interface (testable with a fake sender, replaceable
transport). The service receives the notifier as a dependency (`ReservationDeps.notifier`).

## Design

### Configuration (Zod, fail fast; `.env.example` and README)

`SMTP_URL?`, `EMAIL_FROM?` (required iff `SMTP_URL`), `EMAIL_TIMEOUT_MS` (default 10000),
`RESTAURANT_NAME` (default `the restaurant`), `CANCEL_LINK_BASE_URL` (default
`http://localhost:5173/cancel`). Rules in [R10](./research.md#r10-configuration).

### Notifications

`EmailSender.send({ to, subject, text }, meta?)`. `createEmailSender(config)` returns
`NodemailerSender` (transport built from `{ url: SMTP_URL, connectionTimeout,
greetingTimeout, socketTimeout = EMAIL_TIMEOUT_MS }`; **no startup verify call**, so an
unreachable server never blocks start) or `NoopEmailSender`. Renderers are pure; notifier
semantics in [R4](./research.md#r4-notifier-never-fail-delay-or-leak), content rules in
[R5](./research.md#r5-email-content-and-security).

### Cancellation (`reservations.service.cancelReservation`)

```text
resolve (guest: hash(code) → findOne | staff: ObjectId → findById)  absent → NOT_FOUND "Reservation not found"
claim   findOneAndUpdate({_id, status:"confirmed", startAt:{$gt: now}}, {$set:{cancelled…}}, {new:true})
null  → re-read: cancelled → repair release → ALREADY_CANCELLED | confirmed & startAt<=now → CANNOT_CANCEL | missing → NOT_FOUND
won   → release TableDay, release GuestDay (each retried once); failure → log, INTERNAL_ERROR, no email
      → notifier.notifyCancellation(...) (not awaited) → 200 { id, status, date, startTime, endTime, partySize, cancelledAt }
```

Response headers: `Cache-Control: no-store`. The response is built from the claimed
document; it never contains the code, hash or table name.

### Changes to feature 002 code

- `createReservation`: after step 10's response object is built (every check, including the
  post-store verification, has passed), call `notifier.notifyConfirmation(reservation,
  secretCode)` (not awaited); the response is unchanged. The call sits after the point where
  the function can no longer throw, so refused or failed requests never reach it.
- `affected.ts`: `status: "confirmed"` in all three queries (and in the `$match` of the
  schedule aggregate).
- **Rules that need no query change** (they read `TableDay`/`GuestDay` intervals, which the
  cancellation releases): availability, bookable times, table assignment, the duplicate
  check and the table removal rule. Each still gets its own test (SC-006, below).

## Testing Strategy (test-first, RED recorded before each story)

| Level | Coverage |
|---|---|
| Unit | Renderers: no table name, code only in the confirmation (link `…#code=<code>` and plain), fixed subjects free of guest data, CR/LF stripped from the guest name, stored restaurant-local date/time printed unchanged across a DST change, wording by `cancelledBy`. Notifier: failing sender logs one `email_failed` line (kind, reservationId, reason), the line contains no code, no full address and no `error.message`; timeout; a never-resolving sender does not block or leak; sync-throwing sender; `idle()`. Env: SMTP_URL/EMAIL_FROM rule, defaults, bad URL/timeout, empty `SMTP_URL`. |
| SC-001 | 10 distinct reservations → exactly one confirmation each, right details, no table name; refused requests send nothing (FR-005). |
| SC-002 / SC-010 | With `fail` and with `slow` senders, creation and cancellation responses equal the working case and return fast; every failure logged. |
| SC-003 | End to end: create → read the code from the fake sender's email → cancel with it → the freed time is bookable by another guest immediately. |
| SC-004 | ≥ 5 bad codes (unknown, empty, short, long, malformed) → identical status and body. Missing/non-string code and unknown field → 400. |
| SC-005 | 20 simultaneous cancellations of one reservation mixing guest and staff, 50 rounds → exactly one 200, the rest `ALREADY_CANCELLED`, exactly one cancellation email after `idle()`, no interval left in `TableDay` / `GuestDay`. |
| Races | Cancel vs reserve for the same slot: never a double assignment. |
| Release failures (stubbed ops) | One transient failure succeeds on the retry (200, email sent); a persistent failure → 500, status stays `cancelled`, no email; a later retry with the code repairs the release (409 `ALREADY_CANCELLED`, intervals gone, no email). |
| SC-006 | One test per rule: availability, bookable times, assignment, duplicate check, table removal, affected-reservation lists (all three reports). |
| SC-007 | After creation no operation returns the code or its hash (sweep over all operations); cancelled reservations remain stored with their table, status, `cancelledAt`, `cancelledBy` (both values). |
| SC-008 | Started, ended (also with removed table), exact-start and already-cancelled reservations unchanged; staff cancel without token / bad token → 401 and no change. |
| Contract | 19 operations; public set +1 (`POST /reservations/cancel`); staff operation secured; examples; status enum documents `confirmed` and `cancelled`; new error codes in the shared error schema. |
| Performance | The 002 smoke test extended with cancellation under a failing sender; mutation check recorded as in 001/002 (for example, awaiting the notifier must make it fail). |

## Phasing and task ordering (input for `/speckit-tasks`)

1. **Foundational**: configuration; error codes (`ErrorCode`, `ERROR_STATUS`, `ERROR_CODES`,
   `CODE_MEANING`); Reservation model fields + unique index; `notifications` module
   (interface, Nodemailer and Noop senders, `createEmailSender`, renderers, notifier);
   `FakeEmailSender` and `buildTestApp` wiring; `npm install nodemailer`.
2. **US1 Confirmation email (P1)**: wire `notifyConfirmation` into `createReservation`.
3. **US2 Guest cancellation (P1)**: schemas, service, controller, public route; release
   retry/repair; concurrency and release-failure suites.
4. **US3 Staff cancellation (P2)**: staff route; equivalence with the guest path;
   affected-report workflow (FR-016).
5. **US4 Cancelled reservations leave every rule (P2)**: `affected.ts` filter; one test per
   rule.
6. **US5 Discoverability (P3)**: contract suites and documentation review.
7. **Polish**: performance smoke extension; README (config keys, operations, Mailpit
   instructions, known debt: a failed release leaves a cancelled reservation holding
   intervals until a retry repairs it; failed emails are not retried; no rate limiting on
   the public cancellation operation; SMTP is optional); quickstart run.

## Complexity Tracking

No constitution deviation. The following existing tests change because counts and public
sets are pinned:

| Change | Principle | Why it is needed | Mitigation |
|---|---|---|---|
| `tests/contract/openapi-coverage.test.ts` pins "17 operations" (and the `NEW_PUBLIC` list of three). | I, II | Two operations are added: 17 → 19. | Raised one route at a time in the test tasks of US2 (18) and US3 (19), keeping each commit green. |
| `tests/contract/auth-coverage.test.ts` pins the public set (6 operations, plus `FINAL_PUBLIC`). | II | `POST /reservations/cancel` is public: 6 → 7. The staff cancel is covered by the existing "every secured operation refuses no token" sweep. | Updated in US2; the staff operation needs the `{id}` dummy param already present. |
| `tests/contract/error-shape.test.ts` / any test enumerating `ErrorCode` or the `ErrorResponse` enum. | IV | Two codes are added. | Updated with the codes (US2). |
| `tests/helpers/build-test-app.ts` builds a `Config` literal. | II | `Config` gains five keys. | Defaults added; new `emailSender` and `onNotifier` options are optional, so every existing call stays valid. |
| `ReservationConfirmationSchema.status` stays `z.literal("confirmed")` (creation always yields `confirmed`); the new `ReservationStatus` enum (`confirmed`, `cancelled`) is used by the model and documented. | I | Keeps the creation contract unchanged while FR-019 documents both values. | Contract test asserts the enum lists both. |
| Verification-only suites (`auth-coverage`, `error-shape`, `performance`) may pass when first extended, as in 001/002. | II | They check cross-cutting properties of operations built in US2–US3. | Same recorded mutation check as 001/002. |
