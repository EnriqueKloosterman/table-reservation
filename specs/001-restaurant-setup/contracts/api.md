# API Contract: Staff Access and Restaurant Setup

**Feature**: `001-restaurant-setup` | **Date**: 2026-11-06

This is the design-time contract. At runtime the authoritative contract is the OpenAPI 3.1
document **generated from the Zod schemas** and served at `GET /openapi.json` (UI at
`GET /docs`). Any difference between this file and the implementation is a defect in one of
them and MUST be reconciled (see [Reconciliation](#reconciliation-with-openapijson)).

## General rules

- **No URL prefix, no version segment.** This is deliberate (see [Evolution](#evolution-and-versioning)).
- **Auth**: `Authorization: Bearer <JWT>` (HS256). Security scheme `bearerAuth` (`http`,
  `bearer`, `bearerFormat: JWT`).
- 🔓 = public; 🔒 = requires authentication.
- **Error lists are complete.** Each operation below lists *every* error status and code it
  can produce, including `401 AUTHENTICATION_REQUIRED` on 🔒 operations and
  `500 INTERNAL_ERROR` on all operations. The OpenAPI document MUST list the same set.
- **Request bodies** (only on `POST`, `PUT`, `PATCH`):
  - Must be sent with `Content-Type: application/json` (a `charset` parameter is allowed).
    A missing or different content type (e.g. `text/plain`, form-encoded) →
    `400 VALIDATION_ERROR`, `details: [{ "field": "body", "reason": "Content-Type must be application/json" }]`.
  - Size limit **100 kB**. A larger body → `400 VALIDATION_ERROR`,
    `details: [{ "field": "body", "reason": "Request body exceeds 100 kB" }]`. (400, not 413,
    because the outcome categories of FR-022 are closed and this is an input fault.)
  - Malformed JSON → `400 VALIDATION_ERROR`, `details: [{ "field": "body", "reason": "Malformed JSON" }]`.
  - Body objects are **strict**: unknown fields → `400 VALIDATION_ERROR`, `reason: "Unknown field"`.
  - Operations without a request body (`GET`, `DELETE`) do not parse or validate a body;
    any body sent is ignored.
- **Query strings**: operations that declare query parameters (only `GET /closed-dates`)
  validate them strictly — unknown parameters → `400 VALIDATION_ERROR`. Operations that
  declare no query parameters ignore the query string.
- **`null`**: not accepted for any request field unless stated otherwise below (only
  `reason` on `POST /closed-dates` accepts `null`). `null` for any other field →
  `400 VALIDATION_ERROR`.
- **Numbers**: integer fields are validated on the parsed JSON number value. `4`, `4.0` and
  `4e0` are the same JSON number and are accepted as `4`; `4.5` is refused; strings such as
  `"4"` are never coerced and are refused.
- **Responses**: JSON, `Content-Type: application/json`, except `204` (no body). Clients MUST
  ignore unknown fields in responses.
- **Time zone**: the restaurant's time zone (`RESTAURANT_TIME_ZONE`) is a setup value and is
  **not exposed** through the API. `HH:mm` times and `YYYY-MM-DD` dates are restaurant-local
  wall-clock values; clients display them as-is and MUST NOT convert them using the client's
  own zone. "Today" is always decided by the server. Instants (`expiresAt`) are UTC.

### Check order (precedence)

When several refusals apply, the first matching step wins:

1. **Route match** — unknown path, or a known path with an unsupported method →
   `404 NOT_FOUND` (`"Route not found"`). There is no `405`. This runs before authentication,
   so an unknown route without a token is `404`, not `401`.
2. **Authentication** (🔒 only) → `401 AUTHENTICATION_REQUIRED`. A protected request with no
   token and an invalid body is `401`.
3. **Request validation** — content type, size, JSON syntax, then params / query / body
   schemas, then domain rules (schedule cross-item rules, date not in the past) →
   `400 VALIDATION_ERROR`. Exception: a malformed table `id` → `404` (see
   [Malformed identifiers](#malformed-identifiers)).
4. **Existence** → `404 NOT_FOUND`.
5. **Uniqueness** → `409 CONFLICT`. So re-adding a *past* date that is already closed is
   `400`, not `409`.

## Error model

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [ { "field": "capacity", "reason": "Must be at most 50" } ] } }
```

| Code | Status | When | `details` |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod failure, malformed JSON, wrong content type, oversized body, domain validation (schedule, dates). | Always present: non-empty array `[{ field, reason }]`. |
| `AUTHENTICATION_REQUIRED` | 401 | Missing / malformed / tampered / expired token, wrong scheme, or token for a staff member that no longer exists. | Absent. |
| `INVALID_CREDENTIALS` | 401 | Login with an unknown email or wrong password. | Absent. |
| `NOT_FOUND` | 404 | Unknown, malformed or removed table id; closed date not found; unknown route or method. | Absent. |
| `CONFLICT` | 409 | Duplicate table name (active tables), duplicate closed date. | Absent. |
| `SERVICE_UNAVAILABLE` | 503 | Only `GET /health` when the database is not connected. | Always present: object `{ "database": "down" }`. |
| `INTERNAL_ERROR` | 500 | Anything unexpected. | Absent. |

- **`details` is code-specific by design.** Its shape is fixed per code as in the table
  (array of field errors for `VALIDATION_ERROR`, a status object for `SERVICE_UNAVAILABLE`)
  and it is absent for every other code. The OpenAPI `ErrorResponse` schema declares
  `details` as optional, `oneOf` the two shapes.
- **Only `code` (and, for validation, `field`) is contractual.** `message` and `reason` are
  human-readable English texts that MAY change without notice; clients MUST branch on `code`
  and `field` only.
- **Non-disclosure**:
  - Every `AUTHENTICATION_REQUIRED` uses the same message, `"Authentication required"`, for
    all causes, so the cause is not revealed.
  - Every `INVALID_CREDENTIALS` uses the same message, `"Invalid email or password"`.
  - `INTERNAL_ERROR` always uses the message `"An unexpected error occurred"` and has no
    `details`. No stack trace, exception name, driver/database message, query, internal id
    or file path is ever included in any response. The error is logged server-side only.

### Field paths (`details[].field`)

One convention for every operation:

| Source | Format | Example |
|---|---|---|
| Body field | path from the body root, dot for keys, `[i]` for array indexes | `name`, `days[1].periods[0].end` |
| Body as a whole (malformed JSON, wrong content type, oversized, wrong top-level type, `{}` on PATCH) | `body` | `body` |
| Query parameter | `query.` prefix | `query.includePast` |
| Path parameter | `params.` prefix | `params.date` |

- Array indexes refer to the **request as submitted** (not to the normalized response). For
  `PUT /schedule`, `days[2]` is the third element of the submitted `days` array, whatever day
  it names.
- **All offending fields are reported in one response, per validation stage.** Stage 1 is
  shape/format (Zod). Stage 2 is cross-item domain rules (overlap, duplicate name, repeated
  day, end ≤ start, date in the past) and runs only if stage 1 passes. So a response contains
  either every stage-1 error or every stage-2 error, never a partial list of either.
- **Rules involving more than one item** report the error on the item that comes later:
  - overlap: the `start` of the period that starts later (by time), e.g.
    `days[1].periods[1].start`;
  - duplicate period name: the `name` of the second occurrence in request order;
  - repeated day: the `day` of the second occurrence in request order, e.g. `days[3].day`;
  - end ≤ start: the period's `end`.

### Malformed identifiers

- A malformed table id (not 24 hex characters) → `404 NOT_FOUND`, the same as an unknown id.
  The storage id format is opaque to clients; an id that cannot exist is indistinguishable
  from one that does not.
- A malformed closed date in the path → `400 VALIDATION_ERROR` (`field: "params.date"`). A date
  is a meaningful, client-constructed value (not an opaque id), so a wrong format is an input
  error the client can fix; a well-formed date that is not closed → `404 NOT_FOUND`.

## Health

### `GET /health` 🔓

*Satisfies*: FR-003 (public health check).

- **200** `{ "status": "ok", "database": "up" }`
- Errors: `503 SERVICE_UNAVAILABLE` (`details: { "database": "down" }`), `500 INTERNAL_ERROR`.

## Auth

### `POST /auth/login` 🔓

*Satisfies*: US1 #1, #2, #5; FR-001, FR-002.

Request:

```json
{ "email": " Ana@Resto.com ", "password": "correct horse battery" }
```

- `email`: string, trimmed and lowercased, then checked as an email; `password`: string 1–1024.
- **200**
  ```json
  { "token": "<jwt>", "expiresAt": "2026-11-06T18:00:00.000Z",
    "staff": { "name": "Ana", "email": "ana@resto.com" } }
  ```
  `expiresAt` is a UTC ISO 8601 instant in the form `YYYY-MM-DDTHH:mm:ss.sssZ`, equal to the
  token's `exp` claim (seconds precision, so the milliseconds are always `000`).
- Errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`, `500 INTERNAL_ERROR`.
- A syntactically invalid email (e.g. `"ana"`) or an empty password → `400 VALIDATION_ERROR`.
  This does not weaken FR-002: the format check uses only the submitted text and reveals
  nothing about which accounts exist. Every well-formed request with an unknown email or a
  wrong password → `401 INVALID_CREDENTIALS`.

### `GET /auth/me` 🔒

*Satisfies*: US1 #6; FR-007.

- **200** `{ "name": "Ana", "email": "ana@resto.com" }` (never a password or hash).
- Errors: `401 AUTHENTICATION_REQUIRED`, `500 INTERNAL_ERROR`.

## Tables

`Table` = `{ "id": "<24-hex>", "name": "T1", "capacity": 4 }`

### `POST /tables` 🔒

*Satisfies*: US2 #1, #3, #5; FR-008, FR-009.

Request `{ "name": string (1–50 after trim), "capacity": integer 1–50 }` (both required).

- **201** `Table` (name stored trimmed, original case kept), with header
  `Location: /tables/{id}`.
- Errors: `400 VALIDATION_ERROR`, `401 AUTHENTICATION_REQUIRED`, `409 CONFLICT` (name matches
  an active table, ignoring case and surrounding spaces), `500 INTERNAL_ERROR`.

### `GET /tables` 🔒

*Satisfies*: US2 #2; FR-010.

- **200** `Table[]`, active tables only, ordered by name ignoring letter case, with digit runs
  compared as numbers (`T2` before `T10`); English collation.
- Errors: `401 AUTHENTICATION_REQUIRED`, `500 INTERNAL_ERROR`.

### `GET /tables/{id}` 🔒

*Satisfies*: US2 #6, #7; FR-010.

- **200** `Table`.
- Errors: `401 AUTHENTICATION_REQUIRED`, `404 NOT_FOUND` (unknown, malformed or removed id),
  `500 INTERNAL_ERROR`.

### `PATCH /tables/{id}` 🔒

*Satisfies*: US2 #3, #4, #5, #7; FR-009, FR-010.

Request: partial `{ "name"?: string (1–50 after trim), "capacity"?: integer 1–50 }`; at least
one field (`{}` → `400 VALIDATION_ERROR`, `field: "body"`). `null` is refused for both fields.

- **200** updated `Table`.
  - A request that changes nothing (same name and capacity) → `200` with the unchanged table.
  - Resubmitting the table's own name with different case or spaces (e.g. `" t1 "` for `T1`)
    is not a conflict: `200`, and the stored name becomes the new trimmed text (`t1`).
- Errors: `400 VALIDATION_ERROR`, `401 AUTHENTICATION_REQUIRED`, `404 NOT_FOUND`,
  `409 CONFLICT`, `500 INTERNAL_ERROR`.

### `DELETE /tables/{id}` 🔒

*Satisfies*: US2 #6, #7; FR-010, FR-011.

Soft delete. The name becomes reusable.

*Documented rule (FR-011): once reservations exist (feature 002), removing a table with
future reservations will return `409 CONFLICT`. Not enforced in this feature.* This rule is
stated in the operation's OpenAPI `description` only; `409` is **deliberately not** in this
operation's OpenAPI error list until feature 002 enforces it, so the document never lists a
response the server cannot produce.

- **204** no body.
- Errors: `401 AUTHENTICATION_REQUIRED`, `404 NOT_FOUND`, `500 INTERNAL_ERROR`.

## Weekly schedule

`DayName` = `"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday"`
`ServicePeriod` = `{ "name": string (1–50 after trim), "start": "HH:mm", "end": "HH:mm" }`
`WeeklySchedule` = `{ "days": [ { "day": DayName, "periods": ServicePeriod[] } ] }`

Times are restaurant-local (see [General rules](#general-rules)), `00:00`–`23:59` with exactly
two digits each for hours and minutes, no midnight crossing.

### `GET /schedule` 🔒

*Satisfies*: US3 #1, #2, #7; FR-012, FR-013, FR-014, FR-016.

- **200** `WeeklySchedule` with all 7 days, Monday first, periods sorted by `start`. Before any
  `PUT`, every day has `periods: []`.
- Errors: `401 AUTHENTICATION_REQUIRED`, `500 INTERNAL_ERROR`.

### `PUT /schedule` 🔒

*Satisfies*: US3 #2–#7; FR-012–FR-016, FR-024.

Replaces the whole schedule. Request `WeeklySchedule`; days in any order, each day at most
once; omitted days are closed.

```json
{ "days": [
  { "day": "monday", "periods": [] },
  { "day": "tuesday", "periods": [
    { "name": "Lunch", "start": "12:00", "end": "15:00" },
    { "name": "Dinner", "start": "20:00", "end": "23:30" } ] } ] }
```

- **200** the stored `WeeklySchedule` in **normalized form**: all 7 days, Monday first,
  periods sorted by `start`, names trimmed. It is equivalent to the request (same open days,
  same periods) but not necessarily byte-identical to it.
- **400** `VALIDATION_ERROR` refuses the whole update; the stored schedule is unchanged.
  Example `details` (indexes refer to the submitted array):
  ```json
  [ { "field": "days[1].periods[1].start",
      "reason": "tuesday 'Late lunch' overlaps 'Lunch' (12:00-15:00)" },
    { "field": "days[2].periods[1].name",
      "reason": "wednesday: duplicate period name 'lunch'" } ]
  ```
  Causes: invalid time format, end ≤ start, overlap, empty or too-long name, duplicate name
  within a day (case-insensitive, trimmed), unknown day, repeated day, unknown field.
- Errors: `400 VALIDATION_ERROR`, `401 AUTHENTICATION_REQUIRED`, `500 INTERNAL_ERROR`.

## Closed dates

`ClosedDate` = `{ "date": "YYYY-MM-DD", "reason": string | null }`
Dates are restaurant-local calendar dates; "today" is computed by the server in
`RESTAURANT_TIME_ZONE`. A date is valid only in the exact form `YYYY-MM-DD` (4-2-2 digits,
e.g. `2026-1-5` is refused) and must exist in the Gregorian calendar.

### `POST /closed-dates` 🔒

*Satisfies*: US4 #1, #3, #4; FR-018, FR-019.

Request `{ "date": "2026-12-25", "reason"?: string | null (≤ 200 after trim) }`.

- `reason` is trimmed. Absent, `null`, empty or whitespace-only → stored and returned as
  `null` (no reason).
- **201** `ClosedDate`. No `Location` header: there is no single-closure read operation.
- Errors: `400 VALIDATION_ERROR` (bad format, impossible date such as `2026-02-30`, date before
  today; today is accepted), `401 AUTHENTICATION_REQUIRED`, `409 CONFLICT` (date already
  closed and not in the past), `500 INTERNAL_ERROR`.

### `GET /closed-dates` 🔒

*Satisfies*: US4 #2; FR-020.

Query: `includePast` = `"true" | "false"` (default `"false"`), exact lowercase text only.
`TRUE`, `1`, `yes`, an empty value, or the parameter repeated (`?includePast=true&includePast=false`)
→ `400 VALIDATION_ERROR` (`field: "query.includePast"`).

- **200** `ClosedDate[]` in ascending date order; from today onwards unless `includePast=true`.
- Errors: `400 VALIDATION_ERROR` (invalid `includePast`, unknown query param),
  `401 AUTHENTICATION_REQUIRED`, `500 INTERNAL_ERROR`.

### `DELETE /closed-dates/{date}` 🔒

*Satisfies*: US4 #5; FR-020.

Any date can be removed, including past ones. The path segment is URL-decoded before
validation (`2026%2D12%2D25` is the same as `2026-12-25`).

- **204** no body.
- Errors: `400 VALIDATION_ERROR` (bad format or impossible date, `field: "params.date"`),
  `401 AUTHENTICATION_REQUIRED`, `404 NOT_FOUND` (date is not closed), `500 INTERNAL_ERROR`.

## Documentation

### `GET /openapi.json` 🔓

*Satisfies*: US5 #1; FR-025; SC-004.

- **200** the generated OpenAPI 3.1 document. It describes **14 operations**: the 13 API
  operations above plus `GET /openapi.json` itself. These 14 are "the operations of this
  feature" for SC-004.
- Errors: `500 INTERNAL_ERROR`.
- Documentation requirements (FR-025, SC-001, SC-004), for every operation in the document:
  a `summary`, a `description`, a tag (`Health`, `Auth`, `Tables`, `Schedule`,
  `Closed dates`, `Documentation`), the request schema with an example for every request
  body, the success response with status, description and schema, and one response entry per
  error status listed in this contract, referencing the shared `ErrorResponse` schema and
  naming the possible `code` values in its description.
- `components.securitySchemes.bearerAuth` = `{ type: "http", scheme: "bearer", bearerFormat: "JWT" }`;
  every 🔒 operation has `security: [{ bearerAuth: [] }]`; 🔓 operations have no `security`.

### `GET /docs` 🔓

*Satisfies*: US5 #1, #2; FR-025.

- Swagger UI for `/openapi.json`. Served by swagger-ui-express and not itself an API operation
  in the document.
- Required UI behaviour (US5 #2), configured explicitly rather than left to defaults:
  - "Try it out" is enabled for every operation;
  - the **Authorize** dialog shows the `bearerAuth` scheme and accepts the raw token (the UI
    adds the `Bearer ` prefix);
  - `persistAuthorization: true`, so the token survives a page reload.
  - Flow: execute `POST /auth/login` → copy `token` → Authorize → call any 🔒 operation.

## Unknown routes

Any other method + path → `404 NOT_FOUND` (`"Route not found"`) in the standard shape,
regardless of authentication (see [Check order](#check-order-precedence)).

## CORS

- Allowed origins: exactly the list in `CORS_ORIGINS` (env; default `http://localhost:5173`).
  Requests from other origins receive no CORS headers (the browser blocks them); the server
  does not refuse them with an error status.
- Allowed methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`. Allowed request headers:
  `Authorization`, `Content-Type`. Credentials (cookies) are not used: `Access-Control-Allow-Credentials`
  is not sent.
- Preflight (`OPTIONS`) from an allowed origin → `204` with the headers above. Preflight
  requests are answered before route matching and authentication.

## Evolution and versioning

- The API is unversioned and has no prefix in this feature, on purpose: there is a single
  client (the future staff frontend) developed in the same monorepo.
- Later features (002+) change the contract **additively only**: new operations, new optional
  request fields, new response fields, new error codes on new or changed operations (e.g. the
  `409` on `DELETE /tables/{id}`, recorded in that feature's spec). Clients ignore unknown
  response fields (see [General rules](#general-rules)).
- A breaking change (removing or renaming an operation or field, changing a type or a status
  code) requires a spec amendment that introduces versioning (e.g. a `/v2` prefix) in the
  same feature.

## Known limitations (accepted debt)

| Concern | Status in this feature | Effect on clients |
|---|---|---|
| Sign-in rate limiting / lockout | Not implemented (spec Assumptions). | None visible; there is no `429`. |
| Token revocation / server-side sign-out | Not implemented. | Sign-out = the client discards its token. A token stays valid until `expiresAt`, unless its staff account is deleted. |
| Token refresh | Not implemented. | After `expiresAt`, the client signs in again. |

Also recorded in `backend/README.md`.

## Reconciliation with `/openapi.json`

- **Automated**: the contract suite `tests/contract/openapi-coverage.test.ts` checks that every
  mounted route is in the document with its success and error responses, and vice versa;
  `auth-coverage.test.ts` checks the 🔓/🔒 split. These run in CI on every change.
- **Manual**: the US5 documentation review (plan, Phase Ordering step 7) compares this file
  with the generated document, operation by operation.
- **Owner**: whoever changes a route schema or this file updates the other in the same change.
