# Research: Availability Lookup and Guest Reservations

**Feature**: `002-guest-reservations` | **Date**: 2026-11-07 | **Plan**: [plan.md](./plan.md)

Every item below was open when planning started and is now decided. There are no remaining
`NEEDS CLARIFICATION` markers. Decisions inherited unchanged from feature 001 (runtime, Zod,
`defineRoute`, error middleware, test harness) are in
[001 research](../001-restaurant-setup/research.md) and are not repeated.

## R1. Booking rules configuration

- **Decision**: Four new env keys in the existing Zod `EnvSchema`, all `z.coerce.number().int()`
  with bounds and defaults: `RESERVATION_DURATION_MINUTES` (15–480, default 120),
  `TIME_SLOT_INTERVAL_MINUTES` (5–120, default 15), `MIN_NOTICE_MINUTES` (0–1440, default 60),
  `BOOKING_HORIZON_DAYS` (1–365, default 60). Invalid values fail startup with every invalid
  key listed (existing `ConfigError`). Listed in `.env.example` and the README.
- **Rationale**: FR-002/FR-004/FR-008 make them setup-time values; the constitution requires
  Zod-validated env with fail-fast.
- **Alternatives considered**: storing them in the database and exposing them to staff
  (out of scope, spec Assumptions); a single JSON env value (harder to validate per key).

## R2. Local time ↔ instant conversion without a date library

- **Decision**: A pure module `src/shared/time/local-time.ts` built on `Intl.DateTimeFormat`
  (`formatToParts`, `hourCycle: "h23"`):
  - `utcToLocal(instant, timeZone) → { date: "YYYY-MM-DD", time: "HH:mm" }`.
  - `localToUtc(date, time, timeZone) → Date | null`. Treat the wall-clock value as if it
    were UTC (`guess = Date.UTC(...)`), read the zone offset at `guess − 24 h` and
    `guess + 24 h` (the offsets before and after any transition on that day), form the
    candidate `guess − offset` for each distinct offset, keep the candidates whose
    `utcToLocal` round-trips to the requested date and time, and return the **earliest**.
    No candidate round-trips → the local time does not exist (DST gap) → `null`. Two
    candidates → the time occurs twice (DST fold) → earliest = first occurrence.
  - Helpers: `addDays(date, n)` and `dayOfWeek(date)` via `Date.UTC` calendar arithmetic
    (no zone involved), `toMinutes("HH:mm")` reused from `schedule.domain.ts`.
- **Rationale**: Principle V (no date library); `Intl` already resolves "today" in 001
  (R6 there). The ±24 h probe works for every IANA zone with at most one transition per
  day, which is every real zone.
- **Alternatives considered**: `Temporal` (not available unflagged in Node 24); Luxon or
  date-fns-tz (new dependency for ~60 lines of code); iterating the offset twice from the
  guess (does not detect gaps or folds reliably).
- **Tests**: `America/New_York` gap `2026-03-08 02:30` → `null`, fold `2026-11-01 01:30` →
  `05:30Z` (EDT, first occurrence); `Europe/Madrid` gap `2026-03-29 02:30` → `null`, fold
  `2026-10-25 02:30` → `00:30Z` (CEST, first occurrence); `UTC` and `America/Argentina/Buenos_Aires`
  (no DST) round-trip every grid time; ordinary dates either side of each transition.

## R3. Containment, end time and DST days

- **Decision**: Containment in a service period is evaluated on **local wall-clock
  minutes**: `toMinutes(period.start) ≤ toMinutes(time)` and
  `toMinutes(time) + duration ≤ toMinutes(period.end)`. The stored `endAt` is
  `startAt + duration` in **real** time. `endTime` is the snapshot `utcToLocal(endAt).time`.
- **Consequence (documented, accepted)**: on a DST-change day a reservation whose real
  duration crosses the transition shows an end time that differs from wall-clock arithmetic
  (Madrid `2026-03-29`: start 01:30 CET = 00:30Z, 120 min → `endAt` 02:30Z → shown end
  04:30 CEST, while wall-clock arithmetic says 03:30; Madrid `2026-10-25`: start 01:30 CEST
  = 23:30Z the day before → `endAt` 01:30Z → shown end 02:30 CET instead of 03:30). Restaurants
  rarely serve across 02:00–03:00, so the case is theoretical; the rule stays simple and
  the overlap guarantee (on real instants) is unaffected.
- **Accepted edge**: in a zone whose DST transition happens at midnight, the shown end of a
  reservation at the very end of a period could fall on the next calendar date. The
  reservation still belongs to its start date (one `TableDay` per start date, R5), so
  overlap with a reservation that starts on the next date right after midnight is not
  checked. No configured period can start at 00:00 within one hour of a previous period
  end on the same table in practice; recorded here, not handled.
- **Affected-reservation check for schedule replacement** (FR-022) uses the stored
  `startTime`/`endTime` against the new periods. On the DST days above this can flag a
  reservation the creation rule accepted; the report is informational, so the conservative
  answer is acceptable.
- **Alternatives considered**: containment on real instants (period start/end converted to
  instants) — it makes the last bookable start move by an hour on DST days and would need
  the period end itself to exist; rejected as harder to explain to staff.

## R4. Overlap rule

- **Decision**: Half-open ranges: `a.start < b.end && b.start < a.end`, on instants, used
  identically by the pure availability functions, the guest-duplicate check and the
  database claim filter. 20:00–22:00 and 22:00–24:00 do not overlap.
- **Rationale**: Spec Edge Cases; one definition everywhere avoids drift.

## R5. Enforcing "no two overlapping reservations per table" without transactions

- **Decision**: Per-day calendar documents with an atomic conditional push.
  - `TableDay { tableId, date, intervals: [{ reservationId, start, end }] }`, unique on
    `{ tableId, date }`; `GuestDay { email, date, intervals }`, unique on `{ email, date }`.
  - `claimInterval(model, key, interval)`:
    `updateOne({ ...key, intervals: { $not: { $elemMatch: { start: { $lt: end }, end: { $gt: start } } } } }, { $push: { intervals: interval } }, { upsert: true })`.
    A single-document update is atomic in MongoDB, so the check and the push cannot
    interleave with another claim on the same document.
    - `matchedCount = 1` or `upsertedCount = 1` → claimed.
    - Duplicate-key `11000` → either the document exists and the filter did not match
      (overlap, and the upsert tried to insert a second `{ tableId, date }`), or a
      concurrent request created the document first. Retry **once** without upsert:
      `matchedCount = 1` → claimed, `0` → overlap.
  - **Outcomes**: `claimInterval` returns `true` (claimed) or `false` (overlap) or throws.
    Only `11000` triggers the single retry. One retry is enough because calendar documents
    are never deleted (empty ones stay): after an `11000` the document exists, and the retry
    has no upsert, so it cannot raise `11000` again. Any other error, including one on the
    retry, propagates and the reserve flow answers `INTERNAL_ERROR`; it is never mapped to
    overlap (FR-027c).
  - `releaseInterval(model, key, reservationId)`:
    `updateOne(key, { $pull: { intervals: { reservationId } } })`. It removes only the
    interval carrying the caller's own `reservationId`, never another request's. Empty
    documents are left in place (harmless, reused by the next claim).
  - **Startup**: `initModels()` awaits index creation for `TableDay` and `GuestDay`; if the
    unique indexes cannot be built the application fails to start (without them the upsert
    could create two documents for one key and break the invariant).
  - **Instances**: the guarantee comes from single-document atomicity in MongoDB, so it
    holds across any number of application instances sharing the database.
  - One document per (table, date) is enough because periods never cross midnight
    (feature 001), so a reservation never spans two dates (see R3 for the one accepted edge).
- **Rationale**: Principle III requires a database-level guarantee; plain `mongod`
  (no replica set) must work, both in development and under mongodb-memory-server. The
  guarantee holds even if every application pre-check is bypassed by timing (FR-011).
- **Alternatives considered**:
  - **Multi-document transactions**: need a replica set (mongodb-memory-server can run
    one via `MongoMemoryReplSet`, but production would require it too). They would also
    remove the orphan window below. Recorded as the future alternative.
  - Unique index on `{ tableId, startAt }`: only stops identical starts, not overlaps.
  - Fixed slot documents (one per table per 15 minutes): many writes per reservation and
    ties the guarantee to the slot interval, which is configurable.
  - Read-then-insert with an application lock: not safe across processes.
- **Known residual risk (documented as debt in README; spec FR-031)**: an **orphan
  interval** (an interval whose `reservationId` has no `Reservation`) can come from (1) a
  process stop between a claim and the insert or a release, (2) a `releaseInterval` that
  fails on a failure path, (3) holds deliberately kept when the insert outcome is unknown
  (R6 step 8). No sweeper or transaction in this feature.
  - **Safe direction**: an orphan can only hide a time. An orphan table interval makes the
    table look taken and blocks its removal; an orphan guest interval makes that email's
    overlapping requests answer `duplicate_reservation` although no reservation exists. It
    can never allow a double booking, because the invariant is "no two overlapping
    intervals", and an orphan is an interval. Principle III therefore holds; only
    availability is lost.
  - **Identification and cleanup (manual)**: the README documents a read-only `mongosh`
    aggregation listing intervals with `end > now` whose `reservationId` has no matching
    `reservations._id` (`$lookup`), and the `$pull` that removes one. Intervals are
    short-lived in the normal flow (milliseconds), so a listed interval older than a few
    minutes is an orphan.

## R6. Reserve flow and refusal order

- **Decision** (all in `reservations.service.ts`, after Zod validation):
  1. Normalize: email trim + lowercase, name/phone trim.
  2. `startAt = localToUtc(date, time)`; if not `null`, `endAt = startAt + duration`.
  3. **Duplicate pre-read**: if `startAt` exists, read `GuestDay(email, date)`; an
     overlapping interval → `409 CONFLICT` (`duplicate_reservation`). This precedes
     availability (spec Edge Cases).
  4. Load a fresh snapshot (schedule, closed date, non-removed tables, `TableDay`s of the
     date) and run `checkAvailability`; unavailable → `409 NO_AVAILABILITY` with the reason.
  5. Generate `reservationId` (`new Types.ObjectId()`).
  6. Claim the guest interval; failure → `409 CONFLICT` (`duplicate_reservation`). This is
     what makes simultaneous same-email requests safe (FR-026).
  7. For each candidate from `chooseTables` in order (FR-010 order, so a lost first choice
     falls back to the next suitable table; only tables from the step 4 snapshot are
     candidates): claim its interval; on success re-read the table (`removed: false`,
     `capacity ≥ partySize`); if it no longer qualifies, release that table interval and
     continue. No candidate left → release the guest interval → `409 NO_AVAILABILITY`
     (`no_table_free`). (The snapshot said "available" but every claim was lost: same
     outcome.)
  8. Insert the `Reservation` with `_id = reservationId`. If the insert **fails with a
     definite error** (validation, duplicate key): release the table interval, then the
     guest interval, and throw `INTERNAL_ERROR`. If the outcome is **unknown** (timeout,
     connection lost): `Reservation.exists({ _id: reservationId })`. Exists → continue as
     success. Does not exist → release both intervals → `INTERNAL_ERROR`. The check itself
     fails → **keep both intervals** (orphan, safe direction, R5) → `INTERNAL_ERROR`.
     Releasing intervals when the document may exist would leave a reservation without its
     interval and allow a double booking, which is why the check comes first (FR-027b).
  9. **Post-store verification** (FR-030): reload closed date, schedule and the assigned
     table, and re-run the configuration checks (closed date, containment in a period, table
     not removed, capacity ≥ party). If any fails: `Reservation.deleteOne({ _id })`, then
     release table and guest intervals, and answer `409 NO_AVAILABILITY` with the matching
     reason (`closed_date`, `closed_day`, `outside_service_hours`, otherwise
     `no_table_free`). If the delete fails, keep the intervals (the reservation still
     exists with both) and answer `INTERNAL_ERROR`.
  10. Return the confirmation including the plain secret code (R8).
- **Release rules** (every failure path): release in the reverse order of acquisition
  (table interval first, then guest interval); a failing `releaseInterval` is caught,
  logged, and does not stop the other release (it leaves an orphan, R5 residual risk); the
  original error, not the release error, decides the answer.
- **Failure and rollback by step**:

  | Failing point | State to undo | Answer |
  |---|---|---|
  | 1–2, 5 (no database access) | none | `INTERNAL_ERROR` (unexpected) |
  | 3, 4 (reads) | none | database error → `INTERNAL_ERROR`; otherwise 409 as designed |
  | 6 guest claim: overlap | none | `409 CONFLICT` `duplicate_reservation` |
  | 6 guest claim: database error | none (the claim did not happen, or is unknown → treat as taken: attempt a release of `reservationId`) | `INTERNAL_ERROR` |
  | 7 claim: database error | guest interval (and any table interval held) | `INTERNAL_ERROR` |
  | 7 re-read: database error | that table interval, guest interval | `INTERNAL_ERROR` |
  | 7 no candidate left | guest interval | `409 NO_AVAILABILITY` `no_table_free` |
  | 8 insert fails (definite) | table + guest intervals | `INTERNAL_ERROR` |
  | 8 insert outcome unknown | see step 8 | see step 8 |
  | 9 verification fails | Reservation + intervals | `409 NO_AVAILABILITY` (reason) |
  | 9 reads fail | none: the reservation is kept (it passed every check at step 7) | confirmation as success |
- **Concurrent precedence**: the duplicate-before-availability order (step 3 before 4) is
  guaranteed against finished requests. Against an in-flight request with the same email,
  step 3 may miss its guest claim and step 4 report availability reasons first; and a
  request refused at step 6 may be refused because of a request that later fails. Both are
  accepted (spec FR-028).
- **Gap times**: a nonexistent local time skips step 3 (no range to compare) and step 4
  reports `outside_service_hours` after the date-level reasons (R7).
- **Rationale**: Matches the spec's precedence (validation → duplicate → availability) and
  makes both FR-011 and FR-026 hold under concurrency with single-document atomic writes.
- **Alternatives considered**: claim tables before the guest interval (a duplicate request
  would briefly hold a table and could make a third request fail with `no_table_free`).

## R7. Reason precedence

- **Decision**: `checkAvailability` evaluates, in order:
  1. `too_soon`: `date < today` (restaurant zone), or `startAt` exists and
     `startAt < now + minNotice`.
  2. `too_far_ahead`: `date > addDays(today, horizonDays)` (inclusive horizon, FR-004).
  3. `closed_date`. 4. `closed_day` (no periods on that weekday).
  5. `outside_service_hours`: `startAt` is `null` (DST gap) or no period contains the
     reservation (R3).
  6. `party_too_large`: no non-removed table with `capacity ≥ partySize` (also when there
     are no tables).
  7. `no_table_free`: every such table has an overlapping interval.
- `listBookableTimes` uses FR-008's order: date-level `too_soon` (date before today),
  `too_far_ahead`, `closed_date`, `closed_day`, `party_too_large`; then
  `outside_service_hours` if no period is at least `duration` long or every grid time is a
  DST-gap time; then `too_soon` if minimum notice removes every remaining time; otherwise
  `no_table_free`. Non-empty lists carry no reason.
- **Invariant**: every listed grid time passes `checkAvailability` with the same snapshot
  (SC-004); property-style unit test over a full week including a closed date, DST dates
  and partially booked tables.
- Reason strings (snake_case, closed set): `too_soon`, `too_far_ahead`, `closed_date`,
  `closed_day`, `outside_service_hours`, `party_too_large`, `no_table_free`.

## R8. Secret code

- **Decision**: `randomBytes(32).toString("base64url")` (256 bits, 43 characters) from
  `node:crypto`; stored as `createHash("sha256").update(code).digest("hex")` in
  `secretCodeHash` with `select: false`; returned only by `POST /reservations`.
- **Rationale**: FR-013 requires ≥ 128 bits and non-reversible storage. A slow password
  hash (scrypt) protects low-entropy secrets; a 256-bit random value cannot be brute-forced,
  so SHA-256 is sufficient and lets the cancellation feature look the code up by hash.
- **Alternatives considered**: scrypt (unneeded cost, no lookup by hash); UUID v4
  (122 bits, below the requirement).

## R9. Table choice order

- **Decision**: `chooseTables` filters non-removed tables with `capacity ≥ partySize` and
  no overlapping interval, then sorts by capacity ascending, then by name with
  `Intl.Collator("en", { numeric: true, sensitivity: "base" })` — the same ordering as the
  001 list collation (`numericOrdering`), so "T2" precedes "T10" and case is ignored.
- **Rationale**: FR-010. Returning the whole ordered list (not just the first) lets the
  reserve flow fall back to the next table when a concurrent request wins the first claim.

## R10. Table removal vs. reservation race (FR-017)

- **Decision**: `DELETE /tables/{id}`:
  1. `Table.exists({ _id, removed: false })`; unknown or already removed → 404 (as in 001).
  2. **Pre-check** `TableDay.exists({ tableId, "intervals.end": { $gt: now } })`
     (strict `>`: an interval ending exactly now has ended). If it exists: answer
     `409 CONFLICT` (`table_has_upcoming_reservations`) **without touching the table**. This
     is the normal refusal path and has no visible side effect.
  3. `findOneAndUpdate({ _id, removed: false }, { removed: true, removedAt: now })`
     (null → 404, a concurrent removal won).
  4. **Re-check** the same `TableDay.exists`. If it exists (a reservation claimed the table
     between steps 2 and 3): revert (`removed: false, removedAt: null`) and answer
     `409 CONFLICT` (`table_has_upcoming_reservations`). If the revert fails: retry it once;
     if it still fails, log it and answer `INTERNAL_ERROR`. The table then stays removed,
     reservations keep referring to it (FR-018), no double booking is possible, and staff can
     recreate the table; documented as known debt next to the orphan intervals (FR-029).
- **Visible effect (FR-029)**: only between steps 3 and 4 (milliseconds) concurrent lookups
  and reservations treat the table as removed, so a customer may get `party_too_large` or
  `no_table_free` although the removal is then refused. Accepted: the table is active again
  when the refusal is sent. Steps 2 and 4 together leave the window to the rare race, not
  the common refusal.
- **Spurious outcomes accepted**: staff get a 409 although the reservation went elsewhere
  because it backed off, and a customer is refused or moved to another table while the
  removal is being decided. Neither breaks an invariant.
- **Refinement of the input design**: step 2 checks the **claimed intervals** in `TableDay`,
  not the `Reservation` collection. Reason: the reserve flow claims the interval *before*
  re-reading the table and inserts the `Reservation` *after*. With a check on
  `Reservation`, the interleaving *claim → re-read (active) → remove → check (no
  reservation yet) → insert* would leave a reservation on a removed table. Checking the
  claims closes it: if the re-read saw the table active, the claim happened before the
  removal, so the removal's check sees it. If the re-read saw it removed, the reserve flow
  releases and moves on. The worst case is a spurious 409 when both sides back off, which
  is safe. Every `Reservation` has its interval in `TableDay` (no cancellation yet), so the
  interval check is a superset of the reservation check; an orphan interval (R5) also
  blocks removal, which is the conservative outcome.
- **Tests**: both orderings forced with `Promise.all` over many rounds and with a
  **test-only** hook (an optional `afterClaim` callback injected through the service's
  dependencies; production wiring never sets it, so no production path alters timing) that
  pauses the reserve flow between claim and re-read; after every round, no `Reservation`
  references a removed table. Also: a refused removal through step 2 leaves the table
  untouched (`removedAt` still null); a stubbed failing revert gives `INTERNAL_ERROR` and
  the table stays removed; the boundary (interval ending exactly now does not block).

## R11. Affected-reservation reports (FR-022)

- **Decision**: A shared query module `reservations/affected.ts` returns
  `[{ id, date, startTime, endTime, partySize, guestName, tableName }]` sorted by
  `startAt`, limited to `endAt > now`:
  - closed date: `{ date, endAt: { $gt: now } }` (index `{ date: 1 }`).
  - schedule: all `{ endAt: { $gt: now } }` (index `{ endAt: 1 }`), filtered in memory by
    "no period of its weekday contains `startTime`–`endTime`".
  - table update: `{ tableId, endAt: { $gt: now }, partySize: { $gt: newCapacity } }`
    (index `{ tableId: 1, endAt: 1 }`); only when `capacity` is in the body.
  - `tableName` comes from one `Table.find({ _id: { $in } })` that includes removed tables.
- Each operation applies its change first (unchanged 001 behavior), then computes the list.
  Responses gain `affectedReservations` (always present, possibly empty); `PUT /schedule`
  becomes `{ days, affectedReservations }`.
- **No reservation is missed (FR-030)**: the reserve flow verifies the configuration after
  it inserts the `Reservation` (R6 step 9). For any interleaving of a staff change and a
  reservation, either the insert happens before the change is written (the report, computed
  after the write, finds the stored reservation) or after it (step 9 sees the new
  configuration and rolls the reservation back with `NO_AVAILABILITY`). The report stays
  informational and a stored reservation is never modified (FR-020). The same argument
  covers capacity reductions and, together with R10, table removal.

## R12. Request validation of the new operations

- **Query** (`GET /availability`, `GET /availability/times`): strict objects (unknown
  parameter → 400). `date` reuses `CalendarDateSchema`; `time` uses the 001 `HH:mm`
  pattern; `partySize` is a string matching `^[1-9][0-9]?$` transformed to a number and
  checked `≤ 50`. A repeated parameter arrives as an array and fails the string schema;
  `"4.0"`, `"04"`, `"04x"`, `"0"`, `"51"` are refused.
- **Body** (`POST /reservations`): strict; `date`, `time` as above; `partySize` a JSON
  integer 1–50 (001 number rule); `name` trimmed 1–100; `email` trimmed, lowercased,
  `z.email()`, ≤ 254; `phone` trimmed, 7–20 characters of `^\+?[0-9 ()-]+$` with at least
  7 digits (refine). All offending fields reported at once.
- Validation completes before any read or write (FR-023).

## R13. Error model additions

- **Decision**: New code `NO_AVAILABILITY` → 409, always with
  `details: { reason: <availability reason> }`. New `CONFLICT` cases carry
  `details: { reason: "duplicate_reservation" | "table_has_upcoming_reservations" }`;
  001 `CONFLICT` cases keep no details. `ErrorCode`, `ERROR_STATUS`, `ERROR_CODES`,
  `CODE_MEANING` and the `ErrorResponseSchema.details` `oneOf` are extended.
- **Rationale**: FR-025 requires a distinguishable machine-readable code; a reason in the
  conflict details lets clients tell a duplicate from other conflicts without parsing the
  message. Additive for 001 clients.
- **Alternatives considered**: 422 or 200-with-`available:false` for reservation refusals
  (constitution IV and the spec name 409 for conflicts); a single `CONFLICT` with a reason
  (spec FR-025 asks for a separate category).

## R14. Testing approach

- Unit (pure, written first): `local-time` (R2 cases), `availability.domain` (one case per
  reason, precedence pairs, containment boundaries 21:30/21:45, horizon inclusive bound,
  minimum notice boundary, grid generation, SC-004 invariant), `chooseTables`, phone/partySize
  schemas, secret code shape.
- Integration (Supertest + mongodb-memory-server, pinned clock): one file per story;
  concurrency with `Promise.all`:
  - SC-002: 20 requests for one remaining suitable table × 50 rounds → one 201 per round,
    19 × `NO_AVAILABILITY/no_table_free`, and a direct `TableDay` check that no table holds
    overlapping intervals.
  - Same email × 2 with free tables → one 201, one `CONFLICT/duplicate_reservation`.
  - Candidate fallback: several tables, simultaneous requests → no overlap, smallest
    suitable tables used first.
  - Removal race (R10), both orderings.
  - Storage failure on the `Reservation` insert (stubbed `Reservation.create` rejects) →
    500 and no intervals left behind.
  - Unknown insert outcome (stub: the write succeeds, then the call rejects with a network
    error) → the `exists` check finds it → 201, intervals kept; stub where it was not
    written → 500, intervals released; stub where the `exists` check also fails → 500 and
    both intervals kept.
  - A failing `releaseInterval` on a failure path does not mask the original answer and does
    not stop the other release.
  - Post-store verification (FR-030): a closed date, schedule replacement or capacity
    reduction applied between the table claim and the insert (injected via the test-only
    hook) → the reservation is rolled back with `NO_AVAILABILITY`, or the staff response
    lists it; never neither.
  - Same-email pair where the first request is forced to fail after its guest claim: the
    second may get `duplicate_reservation` (accepted, FR-028), and after the first request
    finishes a third attempt succeeds.
  - Every concurrency round ends with a state check: no overlapping intervals, every
    interval has a `Reservation` (no orphans), no `Reservation` on a removed table. Rounds
    in which zero requests succeed fail SC-002.
- Fixtures use periods in which the scenario fits. With the default 120 minutes a 22:00
  start can never succeed (periods end by 23:59), so the spec's illustrative "18:00–22:00
  then 22:00" scenarios (US2-3, US2-7) are tested as 18:00–20:00 held, 19:00 refused and
  20:00 accepted, in a period 18:00–23:30.
- Contract: 001 suites extended (public ops list, operation count 14 → 17, error shape for
  the new codes, documentation of reasons and examples).
- Performance (SC-006): seed 100 tables, a weekly schedule, 500 closed dates and 10,000
  reservations (with their `TableDay` intervals) directly through the models; 10 concurrent
  requests per new operation; p95 < 1 s; proven able to fail by the 001 mutation approach
  (`P95_LIMIT_MS = 0`).

## R15. Dependency justification (Principle V)

- **Decision**: **No new dependencies**, runtime or dev. `Intl` covers time zones,
  `node:crypto` covers the secret code and its hash, Mongoose covers the atomic updates.
- **Rejected on purpose**: Luxon / date-fns-tz / Temporal polyfill (R2), any rate limiter
  (out of scope, documented as debt), any job scheduler for orphan sweeping (R5).
