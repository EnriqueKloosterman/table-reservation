# API Contract: Availability Lookup and Guest Reservations

**Feature**: `002-guest-reservations` | **Date**: 2026-11-07

Design-time contract. At runtime the authoritative contract is the OpenAPI document generated
from the Zod schemas (`GET /openapi.json`, UI at `GET /docs`). Everything in
[the 001 contract](../../001-restaurant-setup/contracts/api.md) still applies — general
rules, request body rules, the standard error shape and the check order — unless this file
says otherwise.

🔓 = public (no `security` entry in OpenAPI; description starts with "Public — no sign-in
required."); 🔒 = bearer JWT. Error lists are complete; `500 INTERNAL_ERROR` applies to every
operation.

## Changes to the shared rules

### New error code

| Code | Status | `details` |
|---|---|---|
| `NO_AVAILABILITY` | 409 | Always `{ "reason": <availability reason> }` |

Availability reasons (closed set, snake_case): `too_soon`, `too_far_ahead`, `closed_date`,
`closed_day`, `outside_service_hours`, `party_too_large`, `no_table_free`.

New `CONFLICT` cases carry `details: { "reason": "duplicate_reservation" }` or
`{ "reason": "table_has_upcoming_reservations" }` (closed set of conflict reasons). The 001
`CONFLICT` cases (duplicate table name, date already closed) keep no `details`.

Spec category → machine-readable form: validation → `VALIDATION_ERROR`, not found →
`NOT_FOUND`, conflict → `CONFLICT`, no availability → `NO_AVAILABILITY`, internal error →
`INTERNAL_ERROR`; the reason categories are the snake_case strings above (spec FR-025).

`ErrorResponse.details` becomes `oneOf`: field-error array | `{ database: "down" }` |
`{ reason: <availability reason> }` | `{ reason: <conflict reason> }`.

### Check order

1. Route match → 404. 2. Authentication (🔒 only) → 401. 3. Validation (content type, size,
JSON syntax, params/query/body schemas) → 400. 4. Existence → 404. 5. Duplicate reservation /
other conflicts → 409 `CONFLICT`. 6. Availability → 409 `NO_AVAILABILITY` (reserve only;
lookups answer 200).

### Query strings

The two availability operations declare query parameters and validate them strictly:
unknown parameters → 400 (`field: "query.<name>"`, `reason: "Unknown field"`); a parameter
given twice → 400. `partySize` is a decimal string `1`–`50` without leading zeros, sign,
decimals or spaces.

### Time

`date` / `startTime` / `endTime` / `time` are restaurant-local; `createdAt` is a UTC ISO
instant. On a DST-change day `endTime` reflects the real duration
([research R3](../research.md#r3-containment-end-time-and-dst-days)).

### Caching

`GET /availability` and `GET /availability/times` answers are snapshots: both responses carry
`Cache-Control: no-store` (spec FR-007). `POST /reservations` is not cacheable either.

## New operations

### 🔓 `GET /availability`

Query: `date` (YYYY-MM-DD, real date), `time` (HH:mm), `partySize` (1–50). All required.

`200`:

```json
{ "date": "2026-11-14", "time": "20:30", "partySize": 4, "available": true }
```

```json
{ "date": "2026-11-14", "time": "21:45", "partySize": 4, "available": false,
  "reason": "outside_service_hours" }
```

`reason` is present iff `available` is `false`. The table is never revealed.

Errors: `400 VALIDATION_ERROR`, `500`.

### 🔓 `GET /availability/times`

Query: `date`, `partySize`. Both required.

`200`:

```json
{ "date": "2026-11-14", "partySize": 2,
  "periods": [
    { "name": "Lunch",  "times": ["12:00", "12:15", "12:30", "12:45", "13:00"] },
    { "name": "Dinner", "times": ["20:00", "20:15", "21:30"] } ] }
```

```json
{ "date": "2026-12-24", "partySize": 2, "periods": [], "reason": "closed_date" }
```

Periods are in chronological order with their stored names; only periods with at least one
time appear. `reason` is present iff `periods` is empty, chosen per FR-008.

Errors: `400 VALIDATION_ERROR`, `500`.

### 🔓 `POST /reservations`

Body (strict):

```json
{ "date": "2026-11-14", "time": "20:30", "partySize": 3,
  "name": "Ana García", "email": "ana@mail.com", "phone": "+34 600 123 456" }
```

Body rules (all fields required; any other field → 400):

| Field | Rule |
|---|---|
| `date` | Real calendar date, `YYYY-MM-DD`. |
| `time` | `HH:mm`, 24-hour, `00:00`–`23:59`, two digits each. |
| `partySize` | JSON integer 1–50 (not a string, not a decimal). |
| `name` | String, 1–100 after trimming. |
| `email` | String, one address (no display name, no list) with valid syntax, ≤ 254 after trimming; stored and returned lowercased. |
| `phone` | String, 7–20 after trimming, only digits, spaces, `-`, `(`, `)` and an optional leading `+`, with at least 7 digits. |

Lengths are counted as string length (UTF-16 code units). Every offending field is listed at
once. The response echoes the guest values as stored (trimmed; email lowercased).

`201` (no `Location` header — no read operation exists yet):

```json
{ "id": "6741a0ffee0123456789abcd", "status": "confirmed",
  "date": "2026-11-14", "startTime": "20:30", "endTime": "22:30", "partySize": 3,
  "guest": { "name": "Ana García", "email": "ana@mail.com", "phone": "+34 600 123 456" },
  "table": { "name": "T4" },
  "createdAt": "2026-11-07T10:15:00.000Z",
  "secretCode": "Yq3k0v8p1...43 base64url characters" }
```

`secretCode` appears only in this response, is never logged and is never returned again.

Errors:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body rules ([data model](../data-model.md#validation-rules-from-the-spec)); every offending field listed. |
| 409 | `CONFLICT` | `details.reason = "duplicate_reservation"`: the normalized email already holds an overlapping reservation or an unreleased hold (checked before availability against finished requests; a request racing an in-flight one with the same email may be refused even if that one later fails). `details` carries nothing about the existing reservation. |
| 409 | `NO_AVAILABILITY` | `details.reason` = any availability reason. Nothing stored. `no_table_free` also covers a lost race: try another time. A reservation rolled back by the post-store check (configuration changed while it was created) also answers here with the matching reason. |
| 500 | `INTERNAL_ERROR` | Storage failed; no reservation is stored and no hold remains, except that when the database could not even confirm whether the write happened, the client must not assume either outcome. |

**Retries**: there is no idempotency key. Repeating a request whose success response was lost
answers `409 duplicate_reservation` and the secret code cannot be recovered. Repeating after a
`500` may also answer `409 duplicate_reservation` if an orphan hold remains
(spec FR-028, FR-031).

## Changed 001 operations (additive)

`affectedReservations` is always present (possibly `[]`), complete (not paginated), sorted by
start instant with ties broken by `id` ascending, and lists only reservations that have not
ended. Item shape:

```json
{ "id": "6741a0ffee0123456789abcd", "date": "2026-12-24", "startTime": "20:00",
  "endTime": "22:00", "partySize": 6, "guestName": "Ana García", "tableName": "T5" }
```

| Operation | Success body now | Affected = upcoming reservations… |
|---|---|---|
| 🔒 `POST /closed-dates` | `201 { date, reason, affectedReservations }` | on that date |
| 🔒 `PUT /schedule` | `200 { days, affectedReservations }` | not fully inside a period of their weekday under the new schedule (stored `startTime`–`endTime`) |
| 🔒 `PATCH /tables/{id}` | `200 { id, name, capacity, affectedReservations }` | on this table with `partySize` > new capacity (empty when `capacity` not in the body; renames never affect) |

The changes are applied exactly as in 001; reservations are never modified (FR-020). Error
lists are unchanged.

### 🔒 `DELETE /tables/{id}` (changed rule)

`204` as before when the table has no reservation or hold whose end is later than now (one
ending exactly now has ended). Otherwise `409 CONFLICT`,
`details: { "reason": "table_has_upcoming_reservations" }`, and the table is active when the
response is sent (in the normal case it is never touched; only when a reservation races the
removal is the table briefly removed and then restored). Orphan holds also cause this `409`.
`500 INTERNAL_ERROR` if restoring the table after such a race fails: the table then stays
removed (see spec FR-029). Errors: `401`, `404 NOT_FOUND`, `409 CONFLICT`, `500`.

## Documentation requirements (SC-005, FR-024)

- 17 documented operations (14 from 001 + 3). Public set: `GET /health`, `GET /openapi.json`,
  `POST /auth/login`, `GET /availability`, `GET /availability/times`, `POST /reservations`.
- Each new operation: summary, description (including the reason categories and their
  order), a request example (body example for `POST /reservations`; parameter examples for
  the queries), the success schema and every error response.
- `CODE_MEANING.NO_AVAILABILITY` lists the seven reasons; the `CONFLICT` description of the
  new operations names their conflict reason.
- `DELETE /tables/{id}` drops the "not enforced in this feature" note and documents 409.
