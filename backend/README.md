# Table Reservation — Backend

## Overview

HTTP JSON API for a single restaurant: staff sign-in (JWT), tables, weekly service hours and
closed dates. Express 5 + Mongoose + Zod, strict TypeScript (ESM). The OpenAPI document is
generated from the Zod schemas and is the contract with the future frontend.

Code layout (`src/modules/<module>/`): `*.routes.ts` declares each operation with
`defineRoute` (path, auth, schemas, docs, error codes), `*.controller.ts` holds the HTTP
handlers, `*.service.ts` the business logic and persistence, `*.model.ts` the Mongoose model
and `*.domain.ts` pure rules. Cross-cutting code lives in `src/shared/`.

## Requirements

- Node.js 24 LTS (minimum 22.12)
- MongoDB for running the server (local `mongod`, Docker `mongo:8` or Atlas). The tests need
  no running database.

## Setup

```bash
cd backend
npm install
cp .env.example .env     # then edit the values
npm run seed:staff       # create the first staff account (see below)
npm run dev
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Starts the server with reload (`tsx watch`), loading `.env` if present. |
| `npm run build` | Compiles to `dist/` with `tsc`. |
| `npm start` | Runs the compiled server (`dist/src/server.js`), loading `.env` if present. |
| `npm test` | Runs every test once (Vitest: unit, integration, contract). |
| `npm run test:watch` | Runs the tests in watch mode. |
| `npm run typecheck` | Type-checks without emitting (`tsc --noEmit`). |
| `npm run lint` | Lints with ESLint + typescript-eslint. |
| `npm run seed:staff` | Creates a staff account from `STAFF_*` variables (idempotent). |

## Configuration

All configuration comes from environment variables (`.env` is loaded with Node's
`--env-file-if-exists`). They are validated at startup: on any invalid value the process
prints **every** invalid key and exits with code 1 before connecting to anything. Never commit
`.env`; `.env.example` holds placeholders only.

| Key | Required | Default | Rule |
|---|---|---|---|
| `MONGODB_URI` | yes | — | Non-empty MongoDB connection string. |
| `JWT_SECRET` | yes | — | At least 32 characters. |
| `JWT_EXPIRES_IN` | no | `8h` | `<integer><s\|m\|h\|d>`, e.g. `30m`, `8h`, `2d`. |
| `RESTAURANT_TIME_ZONE` | yes | — | IANA time zone (e.g. `Europe/Madrid`) or `UTC`. Decides "today" for closed dates. |
| `CORS_ORIGINS` | no | `http://localhost:5173` | Comma-separated list of allowed origins; each must be a URL. |
| `PORT` | no | `3000` | Integer 1–65535. |
| `STAFF_NAME` | seed only | — | 1–100 characters after trimming. |
| `STAFF_EMAIL` | seed only | — | Valid email; stored trimmed and lowercased. |
| `STAFF_PASSWORD` | seed only | — | 1–1024 characters. Stored only as a scrypt hash. |

## Staff accounts

There is no API to create staff. Run:

```bash
npm run seed:staff
```

It reads `MONGODB_URI` and `STAFF_NAME` / `STAFF_EMAIL` / `STAFF_PASSWORD`, normalizes the
email, and prints `created` or `already exists`. It is idempotent: running it again with the
same email (in any case or with spaces) changes nothing, including the stored name and
password. An invalid variable is reported before connecting (exit code 1).

## Testing

```bash
npm test
```

Tests use [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server): one
in-memory `mongod` per run, with a separate database per test file. On the **first run** it
downloads a `mongod` binary (network access needed once; cached under
`~/.cache/mongodb-binaries`). Suites:

- `tests/unit/` — pure functions (config, normalization, password, schedule and date rules).
- `tests/integration/` — every user story through HTTP, plus a p95 latency smoke test (SC-006).
- `tests/contract/` — SC-002 (every protected operation refuses requests without a token),
  SC-003 (every error has the standard shape), SC-004 (the OpenAPI document matches the
  mounted routes, fully described).

## API docs

- Swagger UI: `http://localhost:3000/docs` — sign in with `POST /auth/login`, copy `token`,
  click **Authorize**, paste it, then call any protected operation. The token survives page
  reloads.
- OpenAPI 3.1 document: `http://localhost:3000/openapi.json`.
- Design-time contract: [`specs/001-restaurant-setup/contracts/api.md`](../specs/001-restaurant-setup/contracts/api.md).

## Known debt

Accepted for this feature (see the spec's assumptions):

- **No sign-in rate limiting or lockout.** Repeated login attempts are not throttled; there is
  no `429`.
- **No server-side token revocation.** Sign-out means the client discards its token; a token
  stays valid until `expiresAt`, unless its staff account is deleted.
- **No token refresh.** After `expiresAt` the client signs in again.
