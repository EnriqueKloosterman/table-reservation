# API Contract: Staff Access and Restaurant Setup

**Feature**: `001-restaurant-setup` | **Date**: 2026-11-06

This is the design-time contract. At runtime the authoritative contract is the OpenAPI 3.1
document **generated from the Zod schemas** and served at `GET /openapi.json` (UI at
`GET /docs`). Any difference between this file and the implementation is a defect in one of
them and MUST be reconciled.

- No URL prefix. JSON only (`Content-Type: application/json`).
- Auth: `Authorization: Bearer <JWT>` (HS256). Security scheme `bearerAuth` (`http`, `bearer`,
  `bearerFormat: JWT`).
- 🔓 = public; 🔒 = requires authentication. Every 🔒 operation may also return
  `401 AUTHENTICATION_REQUIRED`, and every operation may return `500 INTERNAL_ERROR`. These
  are omitted from the per-route error lists below but MUST appear in the OpenAPI document.
- All request bodies and query objects are **strict**: unknown fields → `400 VALIDATION_ERROR`.

## Error model

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [ { "field": "capacity", "reason": "Must be at most 50" } ] } }
```

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod failure, malformed JSON, oversized body, domain validation (schedule, dates). `details: [{ field, reason }]`. |
| `AUTHENTICATION_REQUIRED` | 401 | Missing / malformed / tampered / expired token, or token for a staff member that no longer exists. |
| `INVALID_CREDENTIALS` | 401 | Login with an unknown email or wrong password (same message for both). |
| `NOT_FOUND` | 404 | Unknown, malformed or removed table id; closed date not found; unknown route. |
| `CONFLICT` | 409 | Duplicate table name (active tables), duplicate closed date. |
| `SERVICE_UNAVAILABLE` | 503 | Only `GET /health` when the database is not connected. |
| `INTERNAL_ERROR` | 500 | Anything unexpected; generic message, no internals. |

`field` naming: body fields use their path (`name`, `days[1].periods[0].end`); query and path
fields are prefixed (`query.includePast`, `params.date`); a malformed JSON body uses `body`.

## Health

### `GET /health` 🔓

- **200** `{ "status": "ok", "database": "up" }`
- **503** `SERVICE_UNAVAILABLE`, `details: { "database": "down" }`

## Auth

### `POST /auth/login` 🔓

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
  `expiresAt` is a UTC ISO 8601 instant equal to the token's `exp`.
- Errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`.

### `GET /auth/me` 🔒

- **200** `{ "name": "Ana", "email": "ana@resto.com" }` (never a password or hash).

## Tables

`Table` = `{ "id": "<24-hex>", "name": "T1", "capacity": 4 }`

### `POST /tables` 🔒

Request `{ "name": string (1–50 after trim), "capacity": integer 1–50 }` (both required).

- **201** `Table` (name stored trimmed, original case kept).
- Errors: `400 VALIDATION_ERROR`, `409 CONFLICT` (name matches an active table, ignoring case
  and surrounding spaces).

### `GET /tables` 🔒

- **200** `Table[]`, active tables only, ordered by name (case-insensitive, numeric-aware:
  `T2` before `T10`).

### `GET /tables/{id}` 🔒

- **200** `Table`. Errors: `404 NOT_FOUND` (unknown, malformed or removed id).

### `PATCH /tables/{id}` 🔒

Request: partial `{ "name"?: string, "capacity"?: integer }`; at least one field
(`{}` → `400 VALIDATION_ERROR`, `field: "body"`).

- **200** updated `Table`. Resubmitting the table's own name (any case) is not a conflict.
- Errors: `400 VALIDATION_ERROR`, `404 NOT_FOUND`, `409 CONFLICT`.

### `DELETE /tables/{id}` 🔒

Soft delete. The name becomes reusable.
*Documented rule (FR-011): once reservations exist (feature 002), removing a table with
future reservations will return `409 CONFLICT`. Not enforced in this feature.*

- **204** no body. Errors: `404 NOT_FOUND`.

## Weekly schedule

`DayName` = `"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday"`
`ServicePeriod` = `{ "name": string (1–50 after trim), "start": "HH:mm", "end": "HH:mm" }`
`WeeklySchedule` = `{ "days": [ { "day": DayName, "periods": ServicePeriod[] } ] }`

Times are restaurant-local (`RESTAURANT_TIME_ZONE`), `00:00`–`23:59`, no midnight crossing.

### `GET /schedule` 🔒

- **200** `WeeklySchedule` with all 7 days, Monday first, periods sorted by `start`. Before any
  `PUT`, every day has `periods: []`.

### `PUT /schedule` 🔒

Replaces the whole schedule. Request `WeeklySchedule`; each day at most once; omitted days are
closed.

```json
{ "days": [
  { "day": "monday", "periods": [] },
  { "day": "tuesday", "periods": [
    { "name": "Lunch", "start": "12:00", "end": "15:00" },
    { "name": "Dinner", "start": "20:00", "end": "23:30" } ] } ] }
```

- **200** the stored `WeeklySchedule` (normalized: 7 days, sorted periods, trimmed names).
- **400** `VALIDATION_ERROR` refuses the whole update; the stored schedule is unchanged.
  Example `details`:
  ```json
  [ { "field": "days[1].periods[1].start",
      "reason": "tuesday 'Late lunch' overlaps 'Lunch' (12:00-15:00)" },
    { "field": "days[2].periods[1].name",
      "reason": "wednesday: duplicate period name 'lunch'" } ]
  ```
  Causes: invalid time format, end ≤ start, overlap, empty or too-long name, duplicate name
  within a day (case-insensitive, trimmed), unknown day, repeated day, unknown field.

## Closed dates

`ClosedDate` = `{ "date": "YYYY-MM-DD", "reason": string | null }`
Dates are restaurant-local calendar dates; "today" is computed in `RESTAURANT_TIME_ZONE`.

### `POST /closed-dates` 🔒

Request `{ "date": "2026-12-25", "reason"?: string (≤ 200 after trim) }`.

- **201** `ClosedDate`.
- Errors: `400 VALIDATION_ERROR` (bad format, impossible date such as `2026-02-30`, date before
  today; today is accepted), `409 CONFLICT` (date already closed).

### `GET /closed-dates` 🔒

Query: `includePast` = `"true" | "false"` (default `"false"`).

- **200** `ClosedDate[]` in ascending date order; from today onwards unless `includePast=true`.
- Errors: `400 VALIDATION_ERROR` (e.g. `includePast=yes`, unknown query param).

### `DELETE /closed-dates/{date}` 🔒

Any date can be removed, including past ones.

- **204** no body.
- Errors: `400 VALIDATION_ERROR` (bad format or impossible date), `404 NOT_FOUND` (date is not
  closed).

## Documentation

### `GET /openapi.json` 🔓

- **200** the generated OpenAPI 3.1 document.

### `GET /docs` 🔓

- Swagger UI for `/openapi.json`, with `persistAuthorization: true`. Served by
  swagger-ui-express and not itself an API operation in the document.

## Unknown routes

Any other method + path → `404 NOT_FOUND` (`"Route not found"`) in the standard shape.
