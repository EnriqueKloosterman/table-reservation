# Research: Staff Day View of Reservations

No `NEEDS CLARIFICATION` remained after the spec; the items below record the decisions.

## R1. Day filter: plain equality on restaurant-local `date`

- **Decision**: `Reservation.find({ date })` where `date` is `"YYYY-MM-DD"`.
- **Rationale**: A reservation's `date` is already stored as restaurant-local text at creation (constitution III), so the day boundary was resolved once, in the restaurant time zone. Equality needs no UTC conversion and no DST logic, and evening reservations whose UTC date is the next day are filed under the right local day by construction (FR-007).
- **Alternatives**: range on `startAt` between local midnights converted to UTC — needs DST-aware 23/25-hour days and re-derives what `date` already says; rejected.

## R2. The existing `{ date: 1 }` index is enough

- **Decision**: no new index.
- **Rationale**: `reservationSchema.index({ date: 1 })` exists. An equality lookup returns only that day's documents (≤ a few hundred; SC-010 uses 200) out of 10,000, so the cost is one index range plus ≤ 200 document fetches, then an in-memory sort of ≤ 200 items. A compound `{ date, startAt }` would only save sorting 200 items, while ties and table-name ordering need in-memory work anyway. Verified by the SC-010 test (R9).
- **Alternatives**: `{ date: 1, status: 1, startAt: 1 }` — extra write cost on every reservation for a read that already fits the budget; rejected (YAGNI).

## R3. Table name resolution

- **Decision**: a reservation shows the table's **current name resolved by `tableId`**. A rename shows the new name; removal never changes the display (removed tables keep their document and name). If a table document is missing (never expected: tables are never hard-deleted), log `{ event: "table_missing", reservationId }` with `console.error` and show `"unknown"` instead of failing.
- **Rationale**: no stored name snapshot exists and the spec's last assumption says a rename shows the current name; resolving by id reproduces `affected.ts` and needs no migration for existing reservations. This reading also makes FR-004 / SC-005 true: removal (soft delete sets `removed`, keeps `name`) never changes the name. The wording "name it had when it was assigned" in FR-004 and US2.6 holds for removal, and the last assumption governs rename. Names of removed tables can be reused by new tables, which is why the lookup is by id and never by name.
- **Alternatives**: store `tableName` on the reservation at creation — a schema and backfill change for existing data, and contradicts the "rename shows the new name" line; rejected.

## R4. Table query includes removed tables

- **Decision**: `Table.find({ _id: { $in: distinctTableIds } }, { name: 1 }).lean()` with no `removed` filter, exactly as `affected.ts` does.
- **Rationale**: a removed table's reservations must keep a name (R3); one query per request regardless of the day size (no N+1).

## R5. One snapshot, everything in memory

- **Decision**: ONE `find({ date })` for all statuses. The list is filtered by `status` in memory; the summary is always computed from the confirmed ones of the same array. `tablesUsed` counts distinct `tableId`.
- **Rationale**: list and summary come from the same read, so they cannot disagree even if a cancellation lands between two queries (the spec's snapshot edge case). Distinct `tableId`, not names, because a removed table's name can be reused by another table (two ids, same name, would be counted once if names were used).
- **Alternatives**: separate queries for list and summary (inconsistent under concurrent cancellation); a Mongo `$group` summary (second round trip, same inconsistency).

## R6. Ordering

- **Decision**: pure `sortReservations`: `startAt` ascending, then table name via `new Intl.Collator("en", { numeric: true, sensitivity: "base" })` (T2 before T10), then the id's hex string. The comparator is total, so repeated requests give the same order (FR-001, US1.6).
- **Rationale**: matches the natural-order naming rule used for table assignment (feature 002), is built in, and the id breaks the last tie deterministically.

## R7. Response building and secrecy

- **Decision**: `toReservationView` builds each item from an explicit whitelist (`id`, `status`, `date`, `startTime`, `endTime`, `partySize`, `guest{name,email,phone}`, `table{name}`, `createdAt`, and `cancelledAt`/`cancelledBy` only when `status === "cancelled"`; omitted, never `null`). Documents are never spread. `secretCodeHash` is `select: false` and never requested; the schema's `toJSON` transform is not relied on (`.lean()` bypasses it).
- **Rationale**: whitelist + not selecting = two independent barriers (FR-011, SC-004). A cancelled document missing `cancelledAt`/`cancelledBy` (should not happen) is rendered without them rather than failing.

## R8. Id parsing for the single read

- **Decision**: reuse the strict `/^[0-9a-f]{24}$/i` parse of the 003 staff cancellation, extracted to `reservation-id.ts` together with the message `"Reservation not found"`. Anything else (including empty-like ids such as `%20`) is `NOT_FOUND` before touching the database. The id param schema stays a plain string (`ReservationIdParamsSchema`) so a malformed id is 404, never 400.
- **Rationale**: one rule for read, report and cancel (FR-008, FR-009); `findById` with a non-hex string would throw a cast error and become a 500.

## R9. Routing, auth, read-only, performance

- **Routing**: `GET /reservations` and `GET /reservations/:id` sit beside `POST /reservations`, `POST /reservations/cancel` and `POST /reservations/:id/cancel`. Express matches by method and path, so there is no collision; a test proves `GET /reservations/cancel` is a 404 `NOT_FOUND` "Reservation not found" (treated as an id), `POST /reservations/:id` stays unrouted, and the three POST routes still behave.
- **Auth/validation order**: `defineRoute` already mounts `requireAuth` → validation → handler, giving route → 401 → 400 → 404.
- **Read-only**: the read service imports only the models, the pure view functions, the id helper and `notFound`; a unit test reads its source and fails on imports of `calendar.model`, `interval-claims`, `reservations.ops`, `notifier`, `email-sender` or the write service. SC-008 snapshot test dumps `reservations, tablesdays, guestdays, tables, weeklyschedules, closeddates, staffmembers` before and after many calls of both operations (and error calls) and asserts deep equality and that `FakeEmailSender` recorded nothing.
- **Performance (SC-010)**: seed 10,000 reservations across many dates plus one day of 200; 10 concurrent clients; p95 < 1 s. Mutation check as in features 002/003: temporarily drop the `{ date: 1 }` index (or replace the filter with a full scan) and confirm the test turns red or measurably slower, then restore.
- **Known debt**: no paging; a very large day is returned whole (spec out of scope). Recorded in README.

## R10. Dependency justification (Principle V)

No dependency is added. `Intl.Collator` and `Set` are built in; everything else reuses the current stack.
