# Data Model: Customer Booking Interface

The frontend owns no persistent data. Everything below is in-memory UI state or a UI-facing view of
an API response. Wire types come from the generated `src/api/schema.d.ts`; the types here are the
narrowed shapes the UI is allowed to see.

## UI-facing API types (`src/api/types.ts`)

| Type | Fields | Notes |
|---|---|---|
| `BookableTimes` | `date: string`, `partySize: number`, `periods: { name: string; times: string[] }[]`, `reason?: AvailabilityReason` | `reason` present iff `periods` is empty (mirrors the contract). Periods are kept in the returned order; empty periods are dropped defensively. |
| `Confirmation` | `date`, `startTime`, `endTime`, `partySize`, `guestName` | Built field by field. **No** `secretCode`, `table`, `id`, email, phone or `createdAt`. |
| `CancellationDone` | `date`, `startTime`, `endTime`, `partySize` | No id, no `cancelledAt`. |
| `ApiResult<T, R>` | `{ kind: "success"; value: T }` \| `{ kind: "refusal"; refusal: R }` \| `{ kind: "serverError" }` \| `{ kind: "unreachable" }` | Discriminated union; the client also returns an internal `{ kind: "aborted" }` only for caller-cancelled requests (never rendered). |
| `FieldProblem` | `{ field: BookingField \| "form"; ... }` | Server field errors are reduced to the field name only; the server `reason` text is discarded (FR-028). |

`BookingField` = `"date" | "time" | "partySize" | "name" | "email" | "phone"`. Any other field name
from the server maps to `"form"` (a generic form-level message).

### Refusal shapes (typed on the generated enums)

| Operation | `refusal` |
|---|---|
| times | `{ code: "VALIDATION_ERROR"; fields: (BookingField \| "form")[] }` |
| create | `{ code: "VALIDATION_ERROR"; fields }`, `{ code: "CONFLICT"; reason: ConflictReason }`, `{ code: "NO_AVAILABILITY"; reason: AvailabilityReason }`, `{ code: OtherErrorCode }` |
| cancel | `{ code: "VALIDATION_ERROR" }`, `{ code: "NOT_FOUND" }`, `{ code: "ALREADY_CANCELLED" }`, `{ code: "CANNOT_CANCEL" }`, `{ code: OtherErrorCode }` |

`OtherErrorCode` is any other member of the generated error-code enum or an unknown string; both
resolve to the generic message through the catalog.

## `ApiClient` interface (`src/api/client.ts`)

```text
getTimes(query: { date: string; partySize: number }, signal?: AbortSignal)
  -> ApiResult<BookableTimes, TimesRefusal> | aborted
createReservation(input: { date; time; partySize; name; email; phone }, signal?: AbortSignal)
  -> ApiResult<Confirmation, CreateRefusal> | aborted
cancelReservation(input: { code: string }, signal?: AbortSignal)
  -> ApiResult<CancellationDone, CancelRefusal> | aborted
```

Implemented by `createApiClient(...)` (fetch) and by `FakeApiClient` in `tests/support/`.

## Booking state (`features/booking`)

**BookingDraft** (held by `BookingPage`, discarded on completion or reload):

| Field | Type | Rules |
|---|---|---|
| `date` | `string` (`""` initially) | Format `YYYY-MM-DD` only; no min/max or past check. |
| `partySize` | `string` (`""` initially) | Valid when a whole number 1-50 with no sign, decimals or leading zeros. Kept as text so partial typing is not coerced. |
| `time` | `string \| null` | Cleared whenever `date` or `partySize` changes, and on `NO_AVAILABILITY` after confirm. |
| `name` | `string` | Trimmed on validate; 1-100 characters. |
| `email` | `string` | Trimmed; a single valid address, no display name or list; at most 254 characters. |
| `phone` | `string` | Trimmed; digits, spaces, hyphens, parentheses, optional leading `+`; 7-20 characters with at least 7 digits. |

Validation result: `Record<BookingField, ProblemKey | undefined>` where `ProblemKey` indexes the
catalog (never raw text). Details are kept after every refusal; "Start a new booking" resets all.

### Times state machine (`useBookableTimes`)

```text
idle ──(date & partySize valid)──> loading ──> ready(periods)
  ^                                   │──────> empty(reason | unknown)
  │                                   │──────> error          (serverError / refusal)
  └──(either becomes invalid)         └──────> unreachable    (retry button)
```

- Each transition to `loading` increments a request id (ref) and aborts the previous request; a
  result is applied only if its id is still the latest (FR-003).
- `retry` re-runs the same query. `refresh` (after `NO_AVAILABILITY`) reloads for the same date and
  party size.
- `idle` shows the prompt "Choose a date and a party size to see the available times."

### Submission state machine (`useReservation`)

```text
editing ──submit(valid)──> submitting ──success────────> confirmed
   ^   (lock held in a ref)       │──refusal(field)────> editing (field problems, values kept)
   │                              │──NO_AVAILABILITY───> editing (message; times reloaded; time cleared)
   │                              │──duplicate─────────> editing (duplicate message)
   │                              │──serverError───────> editing (general message, retry allowed)
   └──────────────────────────────└──unreachable───────> editing (unknown-outcome message)
```

`confirmed` holds only a `Confirmation`. "Start a new booking" returns to `idle` with an empty draft.
The lock is set synchronously before the request, released in `finally`; while locked, submit
handlers return immediately, so double click and repeated Enter send exactly one request (FR-010).

## Cancellation state (`features/cancel`)

| Field | Type | Rules |
|---|---|---|
| `code` | `string` | From the fragment (via `initialCancelCode`) or typed by hand; trimmed on submit; cleared when the outcome is final; never stored. |
| `phase` | `"ready" \| "submitting" \| "done"` | `ready` with a code shows the explicit button; without a code shows the manual field first. |
| `outcome` | `cancelled(CancellationDone) \| alreadyCancelled \| cannotCancel \| notFound \| temporaryFailure(serverError \| unreachable)` | The first four are final (clear the code); `temporaryFailure` keeps it for a retry. |

```text
ready ──press(code non-empty, lock free)──> submitting ──cancelled / already / cannot / notFound──> done (code cleared)
  ^                                              └──serverError / unreachable──> ready (message, retry)
  └─ no code: ready (field empty; button disabled while empty)
```

`VALIDATION_ERROR` on cancel is treated as the "not found / check the code" case for the user (the
server only validates that a string is present, which the UI already guarantees).

## Config (`src/config/env.ts`)

`readConfig(raw: string | undefined): { ok: true; apiBaseUrl: string } | { ok: false }`. Valid iff
`new URL(raw)` parses, protocol is `http:` or `https:`, no credentials, query or fragment, and path
is empty or `/`. The trailing slash is removed. `{ ok: false }` renders the service-unavailable
screen with no technical detail.

## Message model (`src/api/messages.ts`)

`Message = { title: string; body: string; next?: string }`. Catalogs are typed `Record`s over the
generated enums; see [contracts/messages.md](./contracts/messages.md).
