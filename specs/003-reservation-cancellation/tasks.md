---

description: "Task list for feature 003-reservation-cancellation (Confirmation Email and Reservation Cancellation)"
---

# Tasks: Confirmation Email and Reservation Cancellation

**Input**: Design documents from `/specs/003-reservation-cancellation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle II (Test-First, NON-NEGOTIABLE): Vitest + Supertest tests are written first and **observed failing (RED)** before implementation, with mongodb-memory-server for persistence and `FakeEmailSender` for email (no test needs an SMTP server). Every phase starts with test tasks followed by an explicit "run and confirm RED" task. Verification-only suites (`auth-coverage`, `error-shape`, `performance`) may pass when first extended; they prove they can fail through a temporary mutation check (plan.md "Complexity Tracking").

**Organization**: Tasks are grouped by user story. Config, error codes, the model, the `notifications` module and the test double are shared by all stories and live in Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 (user stories of spec.md)
- All paths are relative to the repository root; all code lives under `backend/`

## Conventions used by every task

- **One new dependency only**: `nodemailer` (^10.3, runtime). Do **not** add `@types/nodemailer` (research R1). Timeouts use `Promise.race` + `setTimeout`, logs use `console`, hashing reuses `node:crypto`.
- Layering as in 001/002: `*.routes.ts` only declares operations with `defineRoute` and sets `handler: controller.<name>`; HTTP handlers live in `*.controller.ts` (typed with `RouteHandler<P, Q, B>`, reading `res.locals.input`); services stay HTTP-free. Schema modules import `z` from `backend/src/shared/openapi/zod.ts`, never from `zod`. Relative imports use the `.js` extension (ESM, `nodenext`).
- Error body: `{ "error": { "code", "message", "details"? } }`. New codes `ALREADY_CANCELLED` and `CANNOT_CANCEL`, both HTTP 409, no `details`. `NOT_FOUND` message for both cancel operations is exactly `"Reservation not found"`.
- Check order (both operations): route match → auth (staff only) → validation → not found → conflicts.
- "Now" always comes from the injected `Clock`, read once per request. Instants are UTC `Date`s; `date`, `startTime`, `endTime` are restaurant-local text.
- The 200 cancellation response is exactly `{ id, status: "cancelled", date, startTime, endTime, partySize, cancelledAt }` with header `Cache-Control: no-store`. It never contains the code, its hash, the table name or guest contact data.
- Notifier calls are **never awaited** by services; email failures never change a response. Tests wait with `notifier.idle()`, never with sleeps.
- Log lines are single-line JSON via `console.error` (`email_failed`) / `console.log` (`email_skipped`); they never contain the code, any part of the guest address, the guest name or `error.message`.

---

## Phase 1: Setup

**Purpose**: Add the single dependency and the new directory.

- [ ] T001 Run `npm install nodemailer@^10.3` in `backend/` so `backend/package.json` and `backend/package-lock.json` gain `nodemailer` under `dependencies`; do not add `@types/nodemailer`
- [ ] T002 [P] Create the directory `backend/src/modules/notifications/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configuration, error codes, model fields, the `notifications` module and the test double. Every story needs these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests first (write, then confirm RED)

- [ ] T003 [P] Extend `backend/tests/unit/env.test.ts` for the five new keys (research R10): `SMTP_URL` optional, must parse as a URL with protocol `smtp:` or `smtps:`, an empty string is treated as unset; `EMAIL_FROM` required iff `SMTP_URL` is set (error reported on `EMAIL_FROM`), valid mailbox (`a@b.c` or `Name <a@b.c>`), no CR/LF, ignored when `SMTP_URL` is absent; `EMAIL_TIMEOUT_MS` whole number 100..120000, default 10000 (bounds included; decimals, empty, non-numeric and out-of-range fail naming the key); `RESTAURANT_NAME` trimmed, 1..100 chars, no CR/LF, default `"the restaurant"`; `CANCEL_LINK_BASE_URL` valid `http(s)` URL, default `http://localhost:5173/cancel`, must not contain a fragment; update the default-config `toEqual` to include the defaults
- [ ] T004 [P] Create `backend/tests/unit/email-templates.test.ts` for `renderConfirmationEmail` / `renderCancellationEmail` (contract "Email contract", research R5): subjects are exactly `Your reservation at <RESTAURANT_NAME> is confirmed` / `… was cancelled` and never contain guest name, email, phone or code; confirmation body contains guest name, local date, `startTime–endTime`, party size, the link `<CANCEL_LINK_BASE_URL>#code=<code>` and the code as plain text; cancellation body contains guest name, date, times, party size and `You cancelled` (cancelledBy `guest`) or `The restaurant cancelled` (cancelledBy `staff`) and contains neither the code, nor `#code=`, nor a link; neither body contains a table name (renderer input type has no table field; assert a table name string passed through a cast is absent from output); CR and LF in the guest name are replaced by a single space; a reservation near a DST change (e.g. `Europe/Madrid`, 2026-10-25) prints the stored local `date`/`startTime`/`endTime` unchanged while `startAt` (UTC) differs from the naive reading
- [ ] T005 [P] Create `backend/tests/unit/notifier.test.ts` using `FakeEmailSender` (T008) and `vi.spyOn(console, "error"/"log")` for `createNotifier(sender, config)` (research R4): `notifyConfirmation` / `notifyCancellation` return `undefined` synchronously even with a `never` sender; a `fail` sender yields exactly one `console.error` line that parses as JSON with `event: "email_failed"`, `kind`, `reservationId`, `reason: "EENVELOPE"` and `at` (ISO-8601 UTC), and the raw line contains none of: the secret code, the fake address (full or its local part), the guest name, the sender's `error.message`; a `never` sender is abandoned after `EMAIL_TIMEOUT_MS` (use a small value) and logs `reason: "EmailTimeout"`, leaving no pending timer (assert `idle()` resolves and `vi.getTimerCount()` is 0 with fake timers); a sender that throws synchronously is caught and logged; a non-string `reason` falls back to `"Unknown"` and a long one is truncated; `NoopEmailSender` logs one `{"event":"email_skipped","kind","reservationId","at"}` line via `console.log` and sends nothing; `idle()` resolves only after all pending attempts settled, including one registered while waiting; `createEmailSender(config)` returns the Noop sender when `SMTP_URL` is absent and a Nodemailer sender otherwise (construction must not open a connection)
- [ ] T006 [P] Extend `backend/tests/contract/error-shape.test.ts`: `ALREADY_CANCELLED` and `CANNOT_CANCEL` each map to HTTP 409 with the standard body and no `details`; the `ErrorResponse.code` enum in `/openapi.json` lists both new codes
- [ ] T007 [P] Create `backend/tests/integration/reservation-model.test.ts` (mongodb-memory-server): a stored reservation without `cancelledAt`/`cancelledBy` reads back with both `null` (pre-feature documents); `status` accepts exactly `confirmed` and `cancelled` (any other value fails validation); after `initModels()` a unique index on `secretCodeHash` exists and inserting two reservations with the same hash fails with error code `11000`; `secretCodeHash` is still excluded from default reads
- [ ] T008 Create the test double `backend/tests/helpers/fake-email-sender.ts` (research R11): `FakeEmailSender implements EmailSender` with modes `ok` (records `{ message, meta }` in `sent`), `fail` (rejects with an error whose `code` is `"EENVELOPE"` and whose `message` contains a fake address such as `jane@example.test`), `slow` (resolves after a configurable delay), `never` (never settles); a `setMode()` method; helper `lastCode()` that extracts the code from the last confirmation body (the part after `#code=`). It imports the `EmailSender` type from the module created in T014, so this file compiles only after T014 (tests in T003–T007 that import it are RED until then)
- [ ] T009 Run T003–T007 and record that they FAIL (RED) for the right reason (missing keys / codes / fields / modules) before continuing

### Implementation

- [ ] T010 Extend `backend/src/config/env.ts` (`EnvSchema` and the `Config` type) with `SMTP_URL`, `EMAIL_FROM` (required iff `SMTP_URL`, via `superRefine` reporting on `EMAIL_FROM`), `EMAIL_TIMEOUT_MS` (reuse the existing `wholeNumber` helper, 100..120000, default 10000), `RESTAURANT_NAME` (trim, 1..100 chars, no CR/LF, default `"the restaurant"`), `CANCEL_LINK_BASE_URL` (valid http(s) URL without fragment, default `http://localhost:5173/cancel`); an empty `SMTP_URL` counts as unset; never log `SMTP_URL` (it may hold credentials)
- [ ] T011 [P] Add the five keys with placeholder values and one-line comments to `backend/.env.example` (no secrets; `SMTP_URL` commented out)
- [ ] T012 [P] Extend `backend/src/shared/errors/app-error.ts`: add `ALREADY_CANCELLED` and `CANNOT_CANCEL` to `ErrorCode`, both to `ERROR_STATUS` as 409, and factory functions `alreadyCancelled()` and `cannotCancel()` with fixed English messages; extend `ERROR_CODES` (the `ErrorResponse` enum) and `CODE_MEANING` in `backend/src/shared/openapi/common.ts` and `backend/src/shared/openapi/route.ts` so the per-code OpenAPI descriptions include both
- [ ] T013 Extend `backend/src/modules/reservations/reservation.model.ts`: `status` enum `["confirmed", "cancelled"]` (default `confirmed`), `cancelledAt: Date | null` (default `null`), `cancelledBy: "guest" | "staff" | null` (default `null`), and a **unique** index `{ secretCodeHash: 1 }`; make sure `initModels()` in `backend/src/db/` builds it (startup fails if it cannot), keeping `secretCodeHash` `select: false`
- [ ] T014 Create `backend/src/modules/notifications/email-sender.ts`: `EmailMessage = { to, subject, text }`, `EmailMeta = { kind: "confirmation" | "cancellation"; reservationId: string }`, interface `EmailSender { send(message, meta?): Promise<void> }`, `NodemailerSender` (transport created once with the **object form** `nodemailer.createTransport({ url: SMTP_URL, connectionTimeout, greetingTimeout, socketTimeout })` all = `EMAIL_TIMEOUT_MS`; `from` = `EMAIL_FROM`; **no `verify()` call**, so an unreachable server never blocks startup), `NoopEmailSender` (logs `console.log(JSON.stringify({ event: "email_skipped", kind, reservationId, at }))` and resolves), and `createEmailSender(config)` choosing between them
- [ ] T015 [P] Create `backend/src/modules/notifications/email-templates.ts`: pure `renderConfirmationEmail(input, config)` and `renderCancellationEmail(input, config)` returning `{ subject, text }`; input types contain `guestName`, `date`, `startTime`, `endTime`, `partySize` (+ `code` for confirmation, `cancelledBy` for cancellation) and **no table field**; plain English; fixed subjects with only `RESTAURANT_NAME` variable; confirmation body includes `${CANCEL_LINK_BASE_URL}#code=${code}` and the code in plain text; cancellation body says `You cancelled …` or `The restaurant cancelled …` and has no code or link; replace every `\r` and `\n` in the guest name with one space
- [ ] T016 Create `backend/src/modules/notifications/notifier.ts` (depends on T014, T015): `createNotifier(sender, config)` returning `{ notifyConfirmation(reservation, code): void, notifyCancellation(reservation): void, idle(): Promise<void> }`. Each notify builds the message, starts an `async` attempt registered in a `Set<Promise>` and returns immediately. The attempt runs `Promise.race([sender.send(message, meta), timeout])` inside `try/catch` (a synchronous throw is caught too); the timer is cleared in `finally` and `unref`'d; the timeout error has name `EmailTimeout`; on failure it logs exactly one `console.error(JSON.stringify({ event: "email_failed", kind, reservationId, reason, at }))` with `reason = error.code ?? error.name`, string-only, truncated to a short length, fallback `"Unknown"`; `error.message` is never read. `idle()` loops until the pending set is empty
- [ ] T017 Wire the notifier in `backend/src/app.ts`: `createApp` accepts an optional `emailSender` and `onNotifier` test options, otherwise builds `createEmailSender(config)`; builds `createNotifier(sender, config)`; calls `onNotifier?.(notifier)`; passes the notifier into the reservation routes/controller/service deps (`ReservationDeps.notifier`). Update `backend/src/server.ts` only if it constructs deps itself
- [ ] T018 Update `backend/tests/helpers/build-test-app.ts`: the `Config` literal gains the five keys with defaults (`SMTP_URL` unset, `EMAIL_FROM` unset, `EMAIL_TIMEOUT_MS` 10000, `RESTAURANT_NAME` `"La Mesa"`, `CANCEL_LINK_BASE_URL` `"http://localhost:5173/cancel"`); new optional options `emailSender?: EmailSender` (default: a recording `FakeEmailSender` in `ok` mode) and `onNotifier?: (n: Notifier) => void`; the return type stays `Express`, so every existing call remains valid. Add `emailTimeoutMs` as an optional test option
- [ ] T019 Run `npm run typecheck && npm test` in `backend/` and confirm T003–T007 are now GREEN and all 001/002 suites still pass

**Checkpoint**: Foundation ready — user story work can begin.

---

## Phase 3: User Story 1 - Guest receives a confirmation email (Priority: P1) 🎯 MVP

**Goal**: Every successful `POST /reservations` hands exactly one confirmation email to the sender, without ever delaying or changing the response.

**Independent Test**: Create reservations with `FakeEmailSender`; check one email per creation with correct details, link and code, no table name; repeat with `fail`/`slow` senders and check the 201 response is identical and failures are logged.

### Tests for User Story 1 (write first)

- [ ] T020 [US1] Create `backend/tests/integration/confirmation-email.test.ts` (pinned clock; `onNotifier` to call `idle()`): (a) **SC-001** 10 distinct reservations → exactly one email each, `to` equals the guest address, body has the correct local date, start–end time, party size, guest name, the link `…#code=<code>` and the same code as in the 201 response, and no table name (assert against the seeded table's name); (b) refused requests (validation 400, `NO_AVAILABILITY`, duplicate `CONFLICT`, invalid JSON) send nothing (FR-005); (c) **SC-002** with a `fail` sender the response status and body equal the working case, the reservation is stored `confirmed`, and exactly one `email_failed` line was logged without the code, the address or the sender message; (d) **SC-010** with a `slow` sender (e.g. 2 s) the response returns in under 1 s and with a `never` sender it still returns, then `idle()` resolves after the timeout and logs `EmailTimeout`; (e) with no `emailSender` option the Noop path logs `email_skipped` and creation works; (f) the code is stored only hashed: the stored document has no readable code, and no later operation returns it
- [ ] T021 Run T020 and record that it FAILS (RED) because no email is sent yet

### Implementation for User Story 1

- [ ] T022 [US1] In `backend/src/modules/reservations/reservations.service.ts` add `notifier` to `ReservationDeps` and, in `createReservation`, call `deps.notifier.notifyConfirmation(reservation, secretCode)` (not awaited) after the response object is built and no further step can throw (after the post-store verification), so refused or failed requests never reach it; the 201 response is unchanged. Make sure the controller/route wiring from T017 supplies the notifier
- [ ] T023 [US1] Run T020 and confirm GREEN, then the full suite (`npm test`) to confirm all 002 reservation suites still pass

**Checkpoint**: US1 is fully functional and testable on its own.

---

## Phase 4: User Story 2 - Guest cancels with the secret code (Priority: P1)

**Goal**: `POST /reservations/cancel` with `{ code }` cancels an upcoming confirmed reservation atomically, frees the table and the guest slot, and sends one cancellation email.

**Independent Test**: Create, cancel with the code, then check status `cancelled`, the slot is bookable again (also by the same email), a cancellation email was sent, and every bad/late/repeated case gives its documented answer.

### Tests for User Story 2 (write first)

- [ ] T024 [P] [US2] Create `backend/tests/integration/cancel-guest.test.ts`: (a) **SC-003** end to end: create, read the code from the confirmation email (`lastCode()`), cancel with it → 200 with exactly the keys `id, status, date, startTime, endTime, partySize, cancelledAt` (`status: "cancelled"`, `cancelledAt` ISO-8601 UTC equal to the fixed clock), header `Cache-Control: no-store`, body without the code, hash, table name or guest contact data; then the freed time is bookable by another guest immediately and the same email can book the overlapping time again; (b) exactly one cancellation email to the guest with `You cancelled`, no code, no link, no table name; (c) stored record keeps its details, `tableId`, `status: "cancelled"`, `cancelledAt`, `cancelledBy: "guest"` (FR-018, US4 scenario 4–5); (d) repeating the request → 409 `ALREADY_CANCELLED`, no change, no second email; (e) **SC-004** at least 5 bad codes (unknown 43-char, empty `""`, short `"abc"`, 200-char, malformed with symbols/whitespace/unicode) → identical status 404, code `NOT_FOUND`, message `"Reservation not found"`, identical body; (f) `{}`, `{"code":1}`, `{"code":null}`, an unknown extra field, invalid JSON, wrong content type → 400 `VALIDATION_ERROR` before any lookup (all offending fields reported); (g) the code in a URL (`/reservations/cancel/<code>`, `?code=`, `/reservations/<code>/cancel` without auth) never cancels anything: unknown route 404 or 401, reservation unchanged; (h) the cancellation email failing (`fail` sender) leaves the 200 identical and the reservation `cancelled`, with one logged `email_failed`
- [ ] T025 [P] [US2] Create `backend/tests/integration/cancel-rules.test.ts` (clock-controlled): (a) a reservation whose start is in the future cancels; one whose start equals `now` exactly → 409 `CANNOT_CANCEL`; started and ended ones → 409 `CANNOT_CANCEL`, unchanged, no email; (b) a ended reservation whose table was later removed → `CANNOT_CANCEL`, not `NOT_FOUND`; (c) cancelled **and** past its start → `ALREADY_CANCELLED` (precedence, FR-010); (d) no minimum notice for cancelling: build the app with `bookingRules.minNoticeMinutes: 0`, create a reservation starting in 1 minute and cancel it → 200 (with the default 60-minute notice such a reservation could not be created); (e) a reservation that now falls on a closed date or outside the schedule is still cancellable; (f) cancelling reservation A leaves reservation B of the same guest at another time, the table, schedule and closed dates untouched (FR-021)
- [ ] T026 [P] [US2] Create `backend/tests/integration/cancel-concurrency.test.ts` (**SC-005**): for 50 rounds, 20 simultaneous cancellations of one reservation (mix of guest by code and, once US3 exists, staff by id — in this phase guest only; T037 extends the mix) via `Promise.all` → exactly one 200, 19 × 409 `ALREADY_CANCELLED`, exactly one cancellation email after `idle()`, and no interval with that `reservationId` left in any `TableDay` / `GuestDay`. Also a race of cancel vs. reserve for the same slot: either outcome is allowed but never two `confirmed` reservations on one table for overlapping times (use the `afterClaim` hook of 002)
- [ ] T027 [P] [US2] Create `backend/tests/integration/cancel-release-failures.test.ts` using `reservationOps.release` stubs (research R3): (a) one transient failure of a release succeeds on the retry → 200 and one email; (b) a persistent failure of the table release → 500 `INTERNAL_ERROR`, reservation stays `cancelled`, **no email**, the guest-day release was still attempted; (c) a persistent failure of the guest release behaves the same; (d) after (b) a second request with the same code with healthy ops repairs the release → 409 `ALREADY_CANCELLED`, intervals gone, no email; (e) a repair attempt that fails again → 500 and still no email; (f) the log for a failed release contains the reservation id and error name only, never the code or the address
- [ ] T028 [P] [US2] Update the contract suites: `backend/tests/contract/openapi-coverage.test.ts` raises the pinned operation count 17 → 18 and adds `POST /reservations/cancel` (description starts with `Public — no sign-in required.`, no `security`, states the code is accepted only in the body, has a request example and responses 200/400/404/409/500 with their codes); `backend/tests/contract/auth-coverage.test.ts` raises the public set 6 → 7 including `POST /reservations/cancel` (works without a token) and extends `FINAL_PUBLIC`; extend `backend/tests/contract/error-shape.test.ts` so the cancel 404/409/400 bodies use the standard shape
- [ ] T029 [US2] Run T024–T028 and record that they FAIL (RED) for the right reason (route missing → 404, counts 17 ≠ 18) before implementing

### Implementation for User Story 2

- [ ] T030 [P] [US2] Add to `backend/src/modules/reservations/reservations.schemas.ts`: `ReservationStatus = z.enum(["confirmed", "cancelled"])` (documented), `CancelBody = z.strictObject({ code: z.string() })` with an example, and `CancellationResult` (`id`, `status: z.literal("cancelled")`, `date`, `startTime`, `endTime`, `partySize`, `cancelledAt` as ISO-8601 UTC string) with an example; keep `ReservationConfirmationSchema.status` as `z.literal("confirmed")`
- [ ] T031 [US2] Add `cancelReservation(target, deps)` to `backend/src/modules/reservations/reservations.service.ts` (research R2, R3, R7) where `target` is `{ by: "guest"; code: string } | { by: "staff"; id: string }`: read `now = clock.now()` once; resolve (guest: `hashSecretCode(code)` with the code exactly as sent, `findOne({ secretCodeHash })`; staff: strict 24-hex parse then `findById`; absent → `notFound("Reservation not found")`); claim with `Reservation.findOneAndUpdate({ _id, status: "confirmed", startAt: { $gt: now } }, { $set: { status: "cancelled", cancelledAt: now, cancelledBy } }, { new: true })`; on `null` re-read once with `lean()`: `cancelled` → run the repair releases then `ALREADY_CANCELLED`, `confirmed` with `startAt <= now` → `CANNOT_CANCEL`, missing → `NOT_FOUND`; when the claim wins, release `TableDay` then `GuestDay` through `ops.release` (`$pull` by `reservationId`), each retried once, **both always attempted**, and if either still fails `console.error` the reservation id and error name only, throw `INTERNAL_ERROR` and send no email; on success call `deps.notifier.notifyCancellation(...)` (not awaited) and return the `CancellationResult` built from the claimed document (no table name, no code)
- [ ] T032 [US2] Add `cancelByCode` to `backend/src/modules/reservations/reservations.controller.ts`: reads `res.locals.input.body.code`, calls `cancelReservation({ by: "guest", code }, deps)`, sets `Cache-Control: no-store` and responds 200 with the result
- [ ] T033 [US2] Register `POST /reservations/cancel` in `backend/src/modules/reservations/reservations.routes.ts` with `defineRoute` (public, no `security`; description starting `Public — no sign-in required.` and stating the code is accepted only in the body; body `CancelBody` with example; responses 200 `CancellationResult`, 400, 404, 409, 500 with examples). Declare it **before** any `/reservations/:id…` route so `cancel` is never read as an id
- [ ] T034 [US2] Run T024–T028 and confirm GREEN; run the full suite (`npm test`), `npm run typecheck` and `npm run lint`

**Checkpoint**: US1 and US2 both work; guests can reserve, receive the email and cancel.

---

## Phase 5: User Story 3 - Staff cancels an upcoming reservation (Priority: P2)

**Goal**: `POST /reservations/{id}/cancel` with the bearer token cancels with the same rules and email as the guest path, completing the 002 affected-reservation workflow.

**Independent Test**: Create reservations, add a closed date as staff (receive the affected list), cancel each listed reservation as staff, confirm each is `cancelled`, frees its table, notifies its guest and no longer appears in later reports.

### Tests for User Story 3 (write first)

- [ ] T035 [P] [US3] Create `backend/tests/integration/cancel-staff.test.ts` (use `loginAs`): (a) staff cancel of an upcoming reservation → 200 same body shape and `Cache-Control: no-store`, `cancelledBy: "staff"` stored, table and guest slot freed, one email containing `The restaurant cancelled` and no code/link/table name; (b) **SC-008** no token, malformed token, expired token → 401 `AUTHENTICATION_REQUIRED` and nothing changes, and auth is checked before the id is parsed (an unknown id without a token is 401, not 404); (c) started / ended / already-cancelled → 409 `CANNOT_CANCEL` / `ALREADY_CANCELLED` unchanged, no email; (d) malformed id (`"abc"`, 23 hex) and unknown well-formed id → 404 `NOT_FOUND` `"Reservation not found"`, same as the guest message; (e) a body sent with the request is ignored; (f) **FR-016** workflow: create reservations, `POST /closed-dates` lists them as affected, cancel each as staff, then a second closed-date / schedule / table change no longer lists them; (g) a failing sender does not change the 200 and logs one `email_failed`; (h) guest then staff on the same reservation: staff gets `ALREADY_CANCELLED`, one email in total; (i) staff cancelling reservation A leaves a later reservation B by the same guest at the same time untouched
- [ ] T036 [P] [US3] Update the contract suites: `backend/tests/contract/openapi-coverage.test.ts` raises the pinned count 18 → 19 and checks `POST /reservations/{id}/cancel` carries the bearer `security` entry, an `id` path parameter, no required body, responses 200/401/404/409/500 with examples; `backend/tests/contract/auth-coverage.test.ts` confirms the existing "every secured operation refuses a missing token" sweep covers it (dummy `{id}` param) and the public set stays at 7
- [ ] T037 [US3] Extend `backend/tests/integration/cancel-concurrency.test.ts` (from T026) so the 20 simultaneous requests mix guest-by-code and staff-by-id cancellations (still exactly one 200, one email, no interval left), then run T035–T037 and record that they FAIL (RED) because the staff route is missing

### Implementation for User Story 3

- [ ] T038 [US3] Add `cancelByStaff` to `backend/src/modules/reservations/reservations.controller.ts`: reads the validated path `id`, calls `cancelReservation({ by: "staff", id }, deps)`, sets `Cache-Control: no-store`, responds 200
- [ ] T039 [US3] Register `POST /reservations/{id}/cancel` in `backend/src/modules/reservations/reservations.routes.ts` with `defineRoute` using the existing staff authentication wrapper/`security` used by the other staff routes, the shared `id` path schema of 001, no body, responses 200/401/404/409/500 with examples and a description that states staff sign-in is required
- [ ] T040 [US3] Run T035–T037 and confirm GREEN; run the full suite, `npm run typecheck` and `npm run lint`

**Checkpoint**: staff can act on the affected-reservation reports.

---

## Phase 6: User Story 4 - Cancelled reservations leave every existing rule (Priority: P2)

**Goal**: A cancelled reservation stops counting in availability, bookable times, assignment, the duplicate check, the table-removal rule and all three affected-reservation reports, while staying stored.

**Independent Test**: Cancel a reservation and check, one rule at a time, that each ignores it.

### Tests for User Story 4 (write first)

- [ ] T041 [P] [US4] Create `backend/tests/integration/cancelled-rules.test.ts` with **one test per rule** (SC-006), each cancelling a reservation first (guest and staff variants where cheap): (1) availability lists the freed table again; (2) the bookable-times list includes the freed time again; (3) table assignment: with a single suitable table held only by the cancelled reservation, a new reservation succeeds and gets that table; (4) duplicate check: the same email can book an overlapping time (not `duplicate_reservation`); (5) table removal: `DELETE` of a table whose only upcoming reservation was cancelled is allowed (no `table_has_upcoming_reservations`); (6) affected-reservation lists: after cancelling, `PUT` schedule, `POST /closed-dates` and a table update (capacity reduction) do not list it, while a still-`confirmed` reservation in the same scenario **is** listed; (7) SC-007: the cancelled record remains stored with `status: "cancelled"`, `tableId`, `cancelledAt`, `cancelledBy` (both `guest` and `staff` cases)
- [ ] T042 [P] [US4] Extend the 002 affected-reservation tests (`backend/tests/integration/affected-schedule.equivalence.test.ts`, `backend/tests/integration/reservation-protection.test.ts` and `backend/tests/unit/affected.domain.test.ts` where they assert item shape) so every item of `affectedReservations` is asserted to include `"status": "confirmed"` (tests only; the implementation is T044)
- [ ] T041a [P] [US4] Create `backend/tests/integration/no-code-leak.test.ts` (**SC-007**, FR-002, FR-020): create a reservation and a second one, cancel the first as guest and the second as staff, then call **every** operation in `/openapi.json` (resolving `{id}` params with the real ids; staff operations with a valid token) and assert that no response body or header contains the secret code, its SHA-256 hash, or the keys `secretCode` / `secretCodeHash` — except the single creation response, which is the only place the code may appear
- [ ] T043 [US4] Run T041, T041a and T042 and record that they FAIL (RED): the affected-list assertions (6) and the `status` field are red; rules (1)–(5) and (7) are expected to already pass because they read the released intervals (research R9) — record that explicitly instead of weakening the tests

### Implementation for User Story 4

- [ ] T044 [US4] In `backend/src/modules/reservations/affected.ts` add `status: "confirmed"` to all three affected-reservation queries (and to the `$match` stage of the schedule aggregate in `affectedBySchedule`), and add `status` (`z.literal("confirmed")`, with the shared `ReservationStatus` documented) to the affected item schema in `backend/src/modules/reservations/affected.schemas.ts` and to the mapping in `backend/src/modules/reservations/affected.domain.ts`; no other query changes (availability, assignment, duplicate check and table removal read the intervals)
- [ ] T045 [US4] Run T041, T041a and T042 and confirm GREEN; run the full suite to confirm 002 behaviour is unchanged

**Checkpoint**: cancellation frees every resource, verified rule by rule.

---

## Phase 7: User Story 5 - Discoverable cancellation operations (Priority: P3)

**Goal**: `/docs` and `/openapi.json` fully describe both operations, the public/staff distinction, the status enum and the changed creation description.

**Independent Test**: Read `/openapi.json` and check every documented requirement.

### Tests for User Story 5 (write first)

- [ ] T046 [US5] Extend `backend/tests/contract/openapi-coverage.test.ts` (final pins): exactly 19 operations; exactly 7 public (no `security`, description starting `Public — no sign-in required.`) including `POST /reservations/cancel`; both cancellation operations have a request example (guest) and an example for each documented response; every response in the contract tables is declared (guest: 200/400/404/409/500; staff: 200/401/404/409/500) and the 409 documents both `ALREADY_CANCELLED` and `CANNOT_CANCEL`; the `ReservationStatus` schema lists exactly `confirmed` and `cancelled`; the `CancellationResult` schema has none of `code`, `secretCode`, `tableName`, `guestEmail`, `guestPhone`; the `POST /reservations` description states a confirmation email is sent after a successful creation and that a send failure never changes the response, and no longer says "No email is sent"; the `ErrorResponse.code` enum includes the two new codes; Swagger UI at `/docs` responds 200
- [ ] T047 [US5] Run T046 and record which assertions are RED and which already pass (verification-only parts may pass)

### Implementation for User Story 5

- [ ] T048 [US5] Fix every gap T047 revealed in `backend/src/modules/reservations/reservations.routes.ts` and `backend/src/modules/reservations/reservations.schemas.ts`: update the `POST /reservations` description (confirmation email is sent after success, a send failure never changes the response, remove "No email is sent"), add missing examples/descriptions, document `ReservationStatus` on every schema that presents a status
- [ ] T049 [US5] Run T046 and confirm GREEN; run the full suite

**Checkpoint**: all five stories are complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T050 [P] Extend `backend/tests/integration/performance.test.ts` (**SC-010**): under the 002 load profile (up to 10 concurrent requests, 100 tables, one weekly schedule, 500 closed dates, 10,000 reservations) 95% of cancellation responses (guest and staff) arrive in under 1 s, also with a `fail` sender and with a `slow` sender
- [ ] T051 Run and record the mutation checks as in 001/002 (temporary, then reverted): (a) `await` the notifier call in `createReservation` → the slow-sender test of T020 must fail; (b) swap the order in `cancelReservation` to release before the claim → the cancel-vs-reserve race or release-failure test must fail; (c) make the staff route skip auth → the 401 tests of T035 must fail; (d) drop `status: "confirmed"` from one `affected.ts` query → T041(6) must fail; (e) log `error.message` in the notifier → the notifier privacy test must fail. Confirm all pass again after reverting
- [ ] T052 [P] Update `backend/README.md`: the five new config keys (SMTP optional, `EMAIL_FROM` rule, defaults), the two operations with an example `curl` for each, running Mailpit for manual checks (`docker run -p 1025:1025 -p 8025:8025 axllent/mailpit`, `SMTP_URL=smtp://localhost:1025`), and **known debt**: a failed release leaves a `cancelled` reservation holding intervals until a retry repairs it; failed emails are not retried; no rate limiting on the public cancellation operation; SMTP is optional and skipped emails are only logged
- [ ] T053 Security review of the new code paths: grep `backend/src` and the test logs to confirm the secret code, its hash, `SMTP_URL` and guest addresses never reach `console.*`, URLs or responses; confirm `nodemailer` is the only added dependency (`git diff backend/package.json`)
- [ ] T054 Run the `quickstart.md` validation: `npm run typecheck && npm run lint && npm test` in `backend/` all green, and (optionally, with Mailpit) the six manual scenarios; confirm `/openapi.json` reports 19 operations and 7 public ones
- [ ] T055 Mark every completed task `[X]` in this file and, with the user's go-ahead, prepare the commit (conventional message in English, constitution rule)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; BLOCKS all user stories. Within it: tests T003–T008 → RED T009 → T010…T018 → GREEN T019. T008 needs the `EmailSender` type from T014 to compile, so write the file first and expect the RED run to fail on the missing module.
- **US1 (Phase 3)**: after Foundational.
- **US2 (Phase 4)**: after Foundational; independent of US1 code, but the end-to-end test T024(a) reads the code from the confirmation email, so run it after US1 (or stub the code from the 201 response if US1 is deferred).
- **US3 (Phase 5)**: after US2 (reuses `cancelReservation` and the controller/route files).
- **US4 (Phase 6)**: after US2 (needs cancellation to exist); can run in parallel with US3.
- **US5 (Phase 7)**: after US2 and US3 (needs both operations documented).
- **Polish (Phase 8)**: after all desired stories.

### User Story Dependencies

- **US1 (P1)**: no dependency on other stories.
- **US2 (P1)**: soft dependency on US1 (email assertions).
- **US3 (P2)**: depends on US2's service function.
- **US4 (P2)**: depends on US2.
- **US5 (P3)**: depends on US2 and US3.

### Within Each Story

Tests written → RED recorded → implementation → GREEN. Schemas before service, service before controller, controller before route. Tasks touching the same file (`reservations.service.ts`, `reservations.controller.ts`, `reservations.routes.ts`, `openapi-coverage.test.ts`) are sequential, never `[P]`.

### Parallel Opportunities

- Setup: T001 ∥ T002 (T002 only creates a directory).
- Foundational tests: T003, T004, T005, T006, T007 together; implementation: T011 ∥ T012 ∥ T015 after T010/T014 as noted.
- US2 tests: T024, T025, T026, T027, T028 together (five different files); T030 in parallel with other schema-free work.
- US3 tests: T035 ∥ T036.
- US4 tests: T041 ∥ T042. Polish: T050 ∥ T052.

### Parallel Example: User Story 2 tests

```bash
Task: "Create backend/tests/integration/cancel-guest.test.ts"
Task: "Create backend/tests/integration/cancel-rules.test.ts"
Task: "Create backend/tests/integration/cancel-concurrency.test.ts"
Task: "Create backend/tests/integration/cancel-release-failures.test.ts"
Task: "Update backend/tests/contract/openapi-coverage.test.ts, auth-coverage.test.ts, error-shape.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 Setup, Phase 2 Foundational (config, errors, model, notifications, fake sender).
2. Phase 3 US1 (confirmation email) → validate independently.
3. Phase 4 US2 (guest cancellation) → **STOP and VALIDATE**: a guest can reserve, get the email and cancel; the slot is reusable. This is the smallest useful release (both P1 stories).

### Incremental Delivery

1. Foundation → US1 → US2 (MVP) → demo.
2. US3 (staff cancellation, closes the 002 workflow) → demo.
3. US4 (rule-by-rule verification and affected-report `status`) → US5 (documentation pins) → Polish.
4. Each story adds value without breaking previous ones; the full suite is run at every checkpoint.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] labels map tasks to spec.md user stories for traceability; Setup, Foundational and Polish tasks carry none.
- A user story is done only when its tests were written first, seen failing and now pass (constitution, Development Workflow).
- Never weaken a test to make it pass; when a rule is already satisfied (US4 rules 1–5) record that it passed on first run because the design reads the released intervals (research R9).
- Commit only when the user asks; do not push.
