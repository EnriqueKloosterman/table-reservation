# Quickstart: Staff Access and Restaurant Setup

**Feature**: `001-restaurant-setup` | **Plan**: [plan.md](./plan.md) |
**Contract**: [contracts/api.md](./contracts/api.md) | **Data model**: [data-model.md](./data-model.md)

A guide for running the backend and checking the feature end to end. Request and response
shapes are in the contract; this file covers how to run things and what to expect.

## Prerequisites

- Node.js 24 LTS (22.12 or later works).
- A MongoDB instance for manual runs (local `mongod`, Docker `mongo:8`, or Atlas). Tests need
  **no** database: they use mongodb-memory-server, which downloads a `mongod` binary on the
  first run (needs network access once).

## Setup

```bash
cd backend
npm install
cp .env.example .env     # then edit values
```

Required `.env` keys (see `.env.example`): `MONGODB_URI`, `JWT_SECRET` (≥ 32 chars),
`RESTAURANT_TIME_ZONE` (e.g. `Europe/Madrid`). Optional: `JWT_EXPIRES_IN` (`8h`),
`CORS_ORIGINS` (`http://localhost:5173`), `PORT` (`3000`). Seed-only: `STAFF_NAME`,
`STAFF_EMAIL`, `STAFF_PASSWORD`.

## Validation scenarios

### 1. Automated suite (primary check)

```bash
npm test            # vitest run: unit + integration + contract
npm run typecheck   # tsc --noEmit
npm run lint
```

Expected: all green. The contract tests cover SC-002 (every protected operation returns
`401 AUTHENTICATION_REQUIRED` without a token), SC-003 (every error matches the standard shape)
and SC-004 (every route is in the OpenAPI document and the reverse).

### 2. Fail-fast configuration

```bash
RESTAURANT_TIME_ZONE=Mars/Olympus npm run dev
```

Expected: the process exits with a non-zero code and lists `RESTAURANT_TIME_ZONE` as invalid;
nothing listens on `PORT`. The same happens with `JWT_SECRET` shorter than 32 characters.

### 3. Seed and start

```bash
npm run seed:staff  # creates STAFF_EMAIL (normalized); running it again is a no-op
npm run dev         # tsx watch src/server.ts
curl -s localhost:3000/health
```

Expected: `{"status":"ok","database":"up"}`. If MongoDB is stopped, `/health` returns
`503 SERVICE_UNAVAILABLE`.

### 4. End-to-end via the interactive docs (SC-001, US5)

1. Open `http://localhost:3000/docs`. All operations from the contract are listed with their
   error responses.
2. `POST /auth/login` with the seeded credentials (try the email with mixed case and spaces).
   Copy `token`, then click **Authorize** and paste it.
3. `GET /auth/me` → name and email, no password.
4. Create 10 tables (`T1`…`T10`, capacities 2–8). `GET /tables` lists them with `T2` before `T10`.
   Creating ` t1 ` → `409 CONFLICT`. `DELETE` `T10`, then create `T10` again → `201`.
5. `GET /schedule` → 7 empty days. `PUT /schedule` with Lunch 12:00–15:00 and Dinner
   20:00–23:30 on Tuesday–Sunday and Monday empty → `200`; `GET` shows the same.
   Submit an overlapping period → `400` with `details` naming the day and period; `GET`
   shows the previous schedule.
6. `POST /closed-dates` for three future dates (one with reason "Christmas"). Repeat one →
   `409`. `2026-02-30` → `400`. Yesterday → `400`. `GET /closed-dates` lists them in order;
   `DELETE /closed-dates/2026-12-25` → `204`, then again → `404`.

Expected: steps completed in under 10 minutes; every refused call shows
`{ "error": { "code", "message", "details?" } }`.

### 5. Authentication edge checks

```bash
curl -s localhost:3000/tables                                   # 401 AUTHENTICATION_REQUIRED
curl -s -H "Authorization: Bearer abc.def.ghi" localhost:3000/tables   # 401 AUTHENTICATION_REQUIRED
curl -s localhost:3000/nope                                     # 404 NOT_FOUND
```

Expiry is covered by the automated suite with an injected clock, so there is no need to wait 8h.

## Known debt (also in `backend/README.md`)

- No login rate limiting or lockout (out of scope for this feature).
- No server-side token revocation; sign-out = client discards the token.
