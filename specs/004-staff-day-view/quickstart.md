# Quickstart: validating the staff day view

Prerequisites: Node ≥ 22.12, MongoDB available for manual runs (tests use
mongodb-memory-server), a staff account (`npm run seed:staff`), `.env` as in the README.
Details of the shapes: [contracts/api.md](./contracts/api.md); stored fields:
[data-model.md](./data-model.md).

## Automated

From `backend/`:

```bash
npm run typecheck && npm run lint
npm test                      # whole suite, features 001-004
npx vitest run tests/unit/reservation-view.domain.test.ts
npx vitest run tests/integration/day-view.test.ts tests/integration/day-view-status.test.ts \
  tests/integration/reservation-read.test.ts tests/integration/day-view-privacy.test.ts
npx vitest run tests/integration/day-view-performance.test.ts   # SC-010
npx vitest run tests/contract                                   # 21 operations, auth sweep, error shape
```

Expected: all green; before each story's implementation its tests were seen failing (RED).

## Manual walk-through

1. Start the server (`npm run dev`) and log in: `POST /auth/login` → copy the token.
2. Create two reservations for the same date as a guest (`POST /reservations`), cancel one by
   its code (`POST /reservations/cancel`).
3. `GET /reservations?date=<date>` with `Authorization: Bearer <token>` → 200, one confirmed
   reservation, summary `{ reservations: 1, guests: n, tablesUsed: 1 }`, header
   `Cache-Control: no-store`.
4. `…&status=all` → both, in start-time order, the cancelled one with `cancelledAt` /
   `cancelledBy: "guest"`; summary unchanged. `…&status=cancelled` → only the cancelled one.
5. `GET /reservations/<id>` → the item without `secretCode`; `GET /reservations/xyz` → 404
   `Reservation not found`.
6. Same calls without a token, with `date` missing → 401 (not 400).
7. Closure flow (SC-007): add a closed date on a day with reservations → take an id from
   `affectedReservations` → `GET /reservations/<id>` → `POST /reservations/<id>/cancel` →
   `GET /reservations/<id>` shows `status: "cancelled"` with `cancelledBy: "staff"`.
8. Open `/docs`: both operations show the lock, the request example and 200/400/401/500 and
   200/401/404/500 responses.
