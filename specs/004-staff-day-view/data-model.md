# Data Model: Staff Day View of Reservations

**No schema changes.** No new model, field or index. This feature only reads `reservations`
and `tables`.

## Stored entities read

### Reservation (feature 002/003, unchanged)

| Field | Used as | Notes |
|---|---|---|
| `_id` | `id` (hex string); final sort tie-break | |
| `status` | `status`; list filter; summary filter | `confirmed` \| `cancelled` |
| `date` | day filter (equality) | restaurant-local `YYYY-MM-DD` text, index `{ date: 1 }` |
| `startTime`, `endTime` | same names | restaurant-local `HH:mm` text |
| `startAt` | primary sort key | UTC instant, not returned |
| `partySize` | `partySize`; summary `guests` | |
| `guestName`, `guestEmail`, `guestPhone` | `guest.name/email/phone` | personal data (staff only, `no-store`) |
| `tableId` | resolves `table.name`; summary `tablesUsed` | distinct ids |
| `createdAt` | `createdAt` | UTC instant → ISO-8601 |
| `cancelledAt`, `cancelledBy` | same names, **only when cancelled** | `null` while confirmed → omitted |
| `secretCodeHash` | **never selected, never returned** | `select: false` |

### Table (feature 001, unchanged)

`name` is read by `_id` (removed tables included). `removed`, `capacity`, `nameKey` are not read.

## Derived (not stored)

### ReservationView (response item)

```text
{ id, status, date, startTime, endTime, partySize,
  guest: { name, email, phone },
  table: { name },                 // current name by tableId; "unknown" if the table document is missing
  createdAt,                       // ISO-8601 UTC
  cancelledAt?, cancelledBy? }     // present only when status = "cancelled"
```

### DaySummary

```text
{ reservations, guests, tablesUsed }   // confirmed reservations of the date only
```

- `reservations` = count of confirmed; `guests` = sum of their `partySize`; `tablesUsed` = number of distinct `tableId` among them.
- Empty day → `{ 0, 0, 0 }`.
- Identical for `status` = `confirmed`, `all` and `cancelled`.

### DayView (list response)

```text
{ date, status, summary: DaySummary, reservations: ReservationView[] }
```

`status` echoes the effective choice (`confirmed` when omitted).

## Pure functions (`reservation-view.domain.ts`, no I/O)

| Function | Contract |
|---|---|
| `sortReservations(rows, nameOf)` | total order: `startAt` asc → table name (`Intl.Collator("en", { numeric: true, sensitivity: "base" })`) → id hex; returns a new array |
| `buildSummary(rows)` | counts confirmed only; distinct `tableId`; zeros for empty |
| `toReservationView(row, tableName)` | explicit whitelist; cancelled fields only when cancelled; never spreads the row |

## Relationships and state

Reservation → Table by `tableId` (soft-deleted tables remain). No state transitions: nothing
is written. Reading never changes `status`, holds (`tablesdays`, `guestdays`) or sends email.
