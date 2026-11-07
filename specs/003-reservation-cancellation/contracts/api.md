# API Contract: Reservation Cancellation

**Feature**: 003-reservation-cancellation. The OpenAPI document served at `/docs` and
`/openapi.json` is generated from the Zod schemas and is the source of truth; this file is
the design intent. Errors use the standard body `{ "error": { "code", "message", "details"? } }`.

Refusal order (both operations): route match → auth (staff only) → validation → not found →
conflicts.

## POST /reservations/cancel — PUBLIC

Description in OpenAPI starts with **"Public — no sign-in required."** and states that the
code is accepted only in the body, never in the URL.

Request body (strict): `{ "code": string }`. `code` is any string: no trimming, no length
limit beyond the 100 kB body limit.

```json
{ "code": "k3J9xQ7mV0aB4tYw2uHnR8dLzE5cFgS1pXoI6vMqTaU" }
```

| Status | Code | When |
|---|---|---|
| 200 | — | Cancelled now. Body below. `Cache-Control: no-store`. |
| 400 | `VALIDATION_ERROR` | `code` missing or not a string; unknown field; bad JSON / content type / size. |
| 404 | `NOT_FOUND` | No reservation matches the code. One generic message, `"Reservation not found"`, identical for unknown, empty, short, long and malformed codes. |
| 409 | `ALREADY_CANCELLED` | The reservation is already cancelled. Nothing changes, no email. |
| 409 | `CANNOT_CANCEL` | The reservation has started or ended. Nothing changes. |
| 500 | `INTERNAL_ERROR` | Database failure, or the releases failed after the retry (the reservation stays `cancelled`; a retry repairs the release). |

## POST /reservations/{id}/cancel — STAFF (bearer token)

Path parameter `id`: reservation id (24 hex characters). No request body (a body is ignored
as for other bodiless staff operations).

| Status | Code | When |
|---|---|---|
| 200 | — | Cancelled now (`cancelledBy: staff` stored). Same body. |
| 401 | `AUTHENTICATION_REQUIRED` | No / invalid / expired token. Nothing changes. |
| 404 | `NOT_FOUND` | Malformed or unknown id. |
| 409 | `ALREADY_CANCELLED` / `CANNOT_CANCEL` | As above. |
| 500 | `INTERNAL_ERROR` | As above. |

## 200 response (both)

```json
{
  "id": "6730f1c2a1b2c3d4e5f60718",
  "status": "cancelled",
  "date": "2026-11-14",
  "startTime": "20:00",
  "endTime": "22:00",
  "partySize": 2,
  "cancelledAt": "2026-11-10T09:30:00.000Z"
}
```

Never present: the code, its hash, the table name, guest contact data.

## Error codes (additions)

| Code | HTTP | Meaning |
|---|---|---|
| `ALREADY_CANCELLED` | 409 | The reservation was already cancelled (by anyone). Safe to repeat. |
| `CANNOT_CANCEL` | 409 | The reservation start has been reached or passed. |

`NOT_FOUND` is reused. `ErrorCode`, `ERROR_STATUS`, `ERROR_CODES` (the `ErrorResponse` enum)
and the per-code OpenAPI descriptions are extended.

## Other documented changes

- `ReservationStatus` enum documents `confirmed` and `cancelled`.
- `POST /reservations` description no longer says "No email is sent": a confirmation email is
  sent after a successful creation; a send failure never changes the 201 response.

## Email contract (not an HTTP operation)

Plain text, English. Subjects `Your reservation at <RESTAURANT_NAME> is confirmed` /
`… was cancelled`. Confirmation body includes the cancellation link
`<CANCEL_LINK_BASE_URL>#code=<code>` (fragment, never sent to a server) and the code in
plain text. Cancellation body: `You cancelled …` or `The restaurant cancelled …`. Neither
contains the table name.
