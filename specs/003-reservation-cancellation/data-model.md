# Data Model: Confirmation Email and Reservation Cancellation

**Feature**: 003-reservation-cancellation | Builds on [002 data model](../002-guest-reservations/data-model.md)

Only the `reservations` collection changes. `TableDay` and `GuestDay` keep their shape;
cancellation removes an interval from each (`$pull` by `reservationId`).

## Reservation (changed)

| Field | Type | Change | Notes |
|---|---|---|---|
| `status` | `"confirmed" \| "cancelled"` | enum extended | Default `confirmed`. Exactly two values (FR-019). |
| `cancelledAt` | `Date \| null` | new | UTC instant from the injected `Clock`; `null` while confirmed. Presented as ISO-8601 UTC. |
| `cancelledBy` | `"guest" \| "staff" \| null` | new | `null` while confirmed. Tells which of the two cancelled (US4 scenario 5). |
| `secretCodeHash` | string (SHA-256 hex) | **unique index** | Built by `initModels()`; startup fails if it cannot be built. Still `select: false`, never serialized. |
| all other fields | unchanged | — | A cancelled reservation keeps `tableId`, local `date`/`startTime`/`endTime`, `startAt`/`endAt`, party, guest data (FR-018). |

Indexes: existing `{ tableId, endAt }`, `{ endAt }`, `{ date }` plus `{ secretCodeHash: 1 }`
unique. Reservations stored before this feature have no `cancelledAt`/`cancelledBy`; the
schema defaults them to `null` on read, no migration.

### State transitions

```text
confirmed ──(claim: status=confirmed AND startAt > now)──▶ cancelled   (terminal)
```

- Only the atomic claim moves `confirmed → cancelled`; `cancelled` never returns to
  `confirmed`. `cancelledAt`/`cancelledBy` are written in the same single-document update.
- A `confirmed` reservation with `startAt <= now` is not cancellable (`CANNOT_CANCEL`).
- After the claim, the winner releases the table interval and the guest interval. A failure
  leaves `cancelled` with intervals present until a repair release (R3).

### Invariants

1. For a `cancelled` reservation whose release succeeded, no interval with its
   `reservationId` exists in any `TableDay` or `GuestDay` document.
2. A `confirmed` reservation always has its intervals (cancellation never removes them
   before the flip).
3. `cancelledAt` and `cancelledBy` are both set or both `null`, and set iff `status` is
   `cancelled`.
4. The code and its hash are never returned by any operation (FR-020).

## Email notification (not persisted)

Transient, in memory only. No collection. Failures are log lines:

```json
{"event":"email_failed","kind":"confirmation|cancellation","reservationId":"<id>","reason":"<error.code ?? error.name>"}
{"event":"email_skipped","kind":"confirmation|cancellation","reservationId":"<id>"}
```

Never present in a log line: the secret code, the full or partial guest address, the SMTP
error message, the guest name.

### Email message (rendered values)

| Kind | Subject | Body contains | Body never contains |
|---|---|---|---|
| confirmation | `Your reservation at <RESTAURANT_NAME> is confirmed` | guest name (CR/LF stripped), local date, start–end time, party size, `${CANCEL_LINK_BASE_URL}#code=<code>`, the code as plain text | table name |
| cancellation | `Your reservation at <RESTAURANT_NAME> was cancelled` | guest name, local date, start–end time, party size, `You cancelled…` (guest) or `The restaurant cancelled…` (staff) | code, link, table name |

## Configuration (new keys)

See [research R10](./research.md#r10-configuration) and `backend/.env.example`.
