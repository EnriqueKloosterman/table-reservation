# Contract: Backend Operations Used by the Frontend

The backend OpenAPI document (`GET /openapi.json`, UI at `/docs`) is the only contract. The
frontend uses exactly these three public operations, with no sign-in. It never calls `GET
/availability` or any staff operation. Types come from `src/api/schema.d.ts` (generated; see
`npm run api:types` / `npm run api:check`).

Base URL: `VITE_API_BASE_URL`. All requests: `credentials: "omit"`, `cache: "no-store"`,
`referrerPolicy: "no-referrer"`, 8 s timeout, JSON bodies with `Content-Type: application/json`.
CORS: the backend allows `GET`/`POST`, the `Content-Type` header and the origin listed in
`CORS_ORIGINS`.

## 1. `GET /availability/times?date=YYYY-MM-DD&partySize=N`

Sent only when the date is a valid `YYYY-MM-DD` and the party size is a whole number 1-50.

| Status | Body (summary) | Result |
|---|---|---|
| 200 | `{ date, partySize, periods: [{ name, times: string[] }], reason? }` | `success`: ready (periods non-empty, no `reason`) or empty with `reason` |
| 400 | `VALIDATION_ERROR` + `details` field list | `refusal` (form-level generic message; should not happen after client validation) |
| 5xx, 503 | any | `serverError` |
| network / CORS / timeout | - | `unreachable` |
| unparsable / unexpected body | - | `serverError` |

Empty-day `reason` values (`AvailabilityReason`): `too_soon`, `too_far_ahead`, `closed_date`,
`closed_day`, `outside_service_hours`, `party_too_large`, `no_table_free`. Each has its own message.

## 2. `POST /reservations`

Body: `{ date, time, partySize (number), name, email, phone }` with trimmed strings.

| Status | Body | Result / UI outcome |
|---|---|---|
| 201 | `ReservationConfirmation` | `success` -> `Confirmation` built from `date`, `startTime`, `endTime`, `partySize`, `guest.name`; **`secretCode`, `table`, `id`, `guest.email`, `guest.phone`, `createdAt` are dropped inside the client** |
| 400 | `VALIDATION_ERROR`, `details: [{ field, reason }]` | `refusal` with the field names only; shown next to the matching field; unknown field -> generic form message; `reason` text discarded |
| 409 | `CONFLICT`, `details.reason = duplicate_reservation` | `refusal`: "already has a reservation" message, no detail of the other reservation |
| 409 | `CONFLICT`, other/unknown reason | `refusal`: generic message |
| 409 | `NO_AVAILABILITY`, `details.reason` (7 values) | `refusal`: reason message, reload times for the same date and party size, clear only the selected time, keep details |
| 5xx, 503 | any | `serverError`: "could not be completed; check your email before trying again" with retry |
| network / CORS / timeout after sending | - | `unreachable`: "unknown outcome; check your email before trying again" (FR-014) |

Retrying after an unknown outcome that actually succeeded returns `CONFLICT` /
`duplicate_reservation`; its message mentions that the email may already hold the reservation.

## 3. `POST /reservations/cancel`

Body: `{ code }` (the trimmed code, sent only in the body, never in a URL).

| Status | Body | Result / UI outcome |
|---|---|---|
| 200 | `CancellationResult` | `success` -> `CancellationDone` (`date`, `startTime`, `endTime`, `partySize`); final; code cleared |
| 404 | `NOT_FOUND` | `refusal`: "not found" (final; code cleared) |
| 409 | `ALREADY_CANCELLED` | `refusal`: "already cancelled" (final; nothing more is needed) |
| 409 | `CANNOT_CANCEL` | `refusal`: "can no longer be cancelled online" (final) |
| 400 | `VALIDATION_ERROR` | `refusal`: treated as "not found, check the code" |
| 5xx, 503 | any | `serverError`: temporary failure, retry is safe, code kept |
| network / CORS / timeout | - | `unreachable`: temporary failure, retry is safe, code kept |

## Classification rules (all operations)

1. `fetch` rejects (network, DNS, CORS, abort-by-timeout) -> `unreachable`.
2. Caller-initiated abort (a newer request superseded this one) -> internal `aborted`, ignored.
3. HTTP >= 500 -> `serverError` (503 `SERVICE_UNAVAILABLE` included).
4. 2xx with a body that fails the narrow runtime shape check -> `serverError`.
5. 4xx whose body matches `{ error: { code, message, details? } }` -> `refusal` with a typed `code`
   (known or unknown string) and parsed `details`; any other 4xx body -> `serverError`.
6. The server `message` is never used for display; the catalog is.

## Drift control

`npm run api:check` regenerates the types from `API_SPEC_URL` (default
`http://localhost:3000/openapi.json`) and exits non-zero if the result differs from
`src/api/schema.d.ts` or if the backend cannot be reached. The message catalog is typed on the
generated enums, so a new availability reason, conflict reason or error code fails compilation
until a message is added.
