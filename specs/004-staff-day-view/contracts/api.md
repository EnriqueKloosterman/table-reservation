# API Contract: Staff Day View of Reservations

Both operations: tag `Reservations`, bearer token required (`security: bearerAuth`),
`Cache-Control: no-store` on every 2xx answer. Errors use the standard body
`{ "error": { "code", "message", "details"? } }` (codes and messages of features 001 and 003; never personal data, documents or stack traces, also for 500). Neither operation writes anything; log lines carry ids and event names only, never guest data or any trace of the secret code.

Check order: route match → sign-in (401, before the query is looked at) → validation (400) →
not found (404).

## GET /reservations — Reservations of one day (staff)

**Description (documented)**: "Staff sign-in required. Lists the reservations of one
restaurant-local date, ordered by start time (ties: table name in natural order, then id).
`status` chooses `confirmed` (default), `all` or `cancelled`. The `summary` counts confirmed
reservations only under every status choice, so it is identical for all three. Any valid
date is accepted, past or future; a day without matches answers 200 with an empty list and a
zero summary. The response contains guests' personal data and is never cached. Read-only."

### Query (strict)

| Parameter | Rule | Default |
|---|---|---|
| `date` | required, `CalendarDateSchema` (real calendar date, `YYYY-MM-DD`) | — |
| `status` | `confirmed` \| `all` \| `cancelled`; a repeated or empty parameter fails (no fallback to the default) | `confirmed` |
| anything else | refused | — |

Request example: `GET /reservations?date=2026-11-14&status=all`

### Responses

| Status | When |
|---|---|
| 200 | `DayView` below |
| 400 | `VALIDATION_ERROR`; `details` lists every offending field, e.g. `[{ "field": "query.date", "reason": "..." }, { "field": "query.status", "reason": "..." }]`, unknown parameters named |
| 401 | `AUTHENTICATION_REQUIRED` (missing, malformed, tampered or expired token) — also when the query is invalid |
| 500 | `INTERNAL_ERROR` |

### 200 body

```json
{
  "date": "2026-11-14",
  "status": "all",
  "summary": { "reservations": 1, "guests": 3, "tablesUsed": 1 },
  "reservations": [
    {
      "id": "6741a0ffee0123456789abcd",
      "status": "confirmed",
      "date": "2026-11-14",
      "startTime": "20:30",
      "endTime": "22:30",
      "partySize": 3,
      "guest": { "name": "Ana García", "email": "ana@mail.com", "phone": "+34 600 123 456" },
      "table": { "name": "T4" },
      "createdAt": "2026-11-07T10:15:00.000Z"
    },
    {
      "id": "6741a0ffee0123456789abce",
      "status": "cancelled",
      "date": "2026-11-14",
      "startTime": "21:00",
      "endTime": "23:00",
      "partySize": 2,
      "guest": { "name": "Luis Pérez", "email": "luis@mail.com", "phone": "+34 600 000 111" },
      "table": { "name": "T10" },
      "createdAt": "2026-11-07T11:00:00.000Z",
      "cancelledAt": "2026-11-10T09:30:00.000Z",
      "cancelledBy": "guest"
    }
  ]
}
```

The summary counts only the confirmed reservation, although the list (`status=all`) also
shows the cancelled one.

## GET /reservations/{id} — One reservation (staff)

**Description (documented)**: "Staff sign-in required. Reads one reservation of any status
and date by its id (the ids in `affectedReservations` and in the day view). A malformed or
unknown id is 404 `NOT_FOUND` 'Reservation not found'. Contains personal data; never cached.
Read-only."

### Path and query

No query parameters are defined: any query parameter is refused with 400 (after sign-in). Without sign-in the answer is always 401, whether or not the id exists. The route is `GET`, so it cannot collide with `POST /reservations/cancel`.

`id` — 24 hex characters, plain string in the schema (a malformed id is 404, not 400).

### Responses

| Status | When |
|---|---|
| 200 | one `ReservationView` (shape above; `cancelledAt` / `cancelledBy` only when cancelled) |
| 400 | `VALIDATION_ERROR` for an unknown query parameter only |
| 401 | `AUTHENTICATION_REQUIRED` |
| 404 | `NOT_FOUND`, message exactly `Reservation not found` (malformed, empty-like and unknown ids alike) |
| 500 | `INTERNAL_ERROR` |

## Schemas added (registered components)

`ReservationView`, `ReservationSummary`, `DayView`; `ReservationStatus` (existing) is referenced
and its description explains `confirmed` / `cancelled`; the `status` query parameter lists its
three values with a description of each.

## Never present in any response

`secretCode`, `secretCodeHash`, any hash or derivative of the code (prefix, length, comparison hint), in success or error bodies and in logs.

`table.name` shows the table's current name; `unknown` only if its record cannot be found.
