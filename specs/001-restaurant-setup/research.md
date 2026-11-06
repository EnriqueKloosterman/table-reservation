# Research: Staff Access and Restaurant Setup

**Feature**: `001-restaurant-setup` | **Date**: 2026-11-06 | **Plan**: [plan.md](./plan.md)

All Technical Context items are resolved; no `NEEDS CLARIFICATION` remains. Versions below
were checked against the npm registry on 2026-11-06.

## R1. Runtime and language versions

- **Decision**: Node.js 24 LTS (minimum supported: 22.12, declared in `engines`). TypeScript
  **6.0.x** (`~6.0.3`) in `strict` mode, ESM (`"type": "module"`, `module`/`moduleResolution`
  `nodenext`).
- **Rationale**: Vitest 5 requires Node `^22.12 || ^24 || >=26`; Mongoose 9 and
  mongodb-memory-server 11 require `>=20.19`. TypeScript 7.0 is the newest release, but
  `typescript-eslint` 8.72 declares `typescript >=4.8.4 <6.1.0`, so TS 7 would break linting.
  TS 6.0 is the newest version the whole toolchain supports.
- **Alternatives considered**: TS 7.0 (rejected: no typescript-eslint support yet); CommonJS
  (rejected: jose 6 is ESM-only and ESM is the ecosystem default).

## R2. Zod and zod-to-openapi compatibility

- **Decision**: `zod@^4.6` with `@asteasolutions/zod-to-openapi@^9.1`.
- **Rationale**: zod-to-openapi 9.x declares `peerDependencies: { zod: "^4.0.0" }`. Pinning both
  majors together avoids the Zod 3/4 split. `extendZodWithOpenApi(z)` is called once in
  `src/shared/openapi/zod.ts`, and every schema module imports `z` from there.
- **Alternatives considered**: zod-to-openapi 7.x with Zod 3 (rejected: legacy major);
  Zod 4's native `z.toJSONSchema()` plus hand-written OpenAPI paths (rejected: paths,
  parameters, security and responses would be hand-maintained and could drift, against
  Principle I).

## R3. JWT library

- **Decision**: `jose@^6` with HS256 (`SignJWT` / `jwtVerify`, `algorithms: ["HS256"]`).
- **Rationale**: No dependencies, ships its own types, actively maintained, built on Web Crypto.
  `jwtVerify` accepts a `currentDate` option, so expiry tests can inject a clock instead of
  waiting. Restricting `algorithms` blocks `alg: none` and algorithm-confusion tokens.
- **Alternatives considered**: `jsonwebtoken` (rejected: several transitive deps and a separate
  `@types` package); hand-rolled HMAC JWT with `node:crypto` (rejected: easy to get subtly
  wrong, e.g. constant-time comparison or header validation, for a security-critical path).

## R4. Password hashing

- **Decision**: `node:crypto.scrypt` (promisified). Parameters: N=16384, r=8, p=1, keylen=64,
  16-byte random salt per user. Stored as one self-describing string
  `scrypt$16384$8$1$<saltB64>$<hashB64>` so parameters can change later without a migration.
  Comparison uses `timingSafeEqual`. Password input is capped at 1024 characters so a huge
  input cannot make hashing expensive.
- **Unknown email**: a dummy hash is computed once at module load. Login with an unknown email
  verifies the submitted password against it and then returns `INVALID_CREDENTIALS`, so
  response time looks the same as for a wrong password.
- **Alternatives considered**: bcrypt / argon2 packages (rejected: native builds and an extra
  dependency that Principle V says to avoid when the standard library is enough).

## R5. Configuration loading

- **Decision**: Load `.env` with Node's built-in `--env-file-if-exists=.env` (scripts in
  `package.json`; `tsx` passes the flag through to Node). Validate `process.env` with a Zod
  schema in `src/config/env.ts`. On failure, print every invalid key and exit with code 1
  before connecting to anything.
- **Specific rules**:
  - `JWT_SECRET`: `min(32)`.
  - `JWT_EXPIRES_IN`: regex `^\d+[smhd]$`, default `8h`, parsed to seconds by a small pure
    function. `expiresAt` comes from that number, so the response and the token's `exp`
    always agree.
  - `RESTAURANT_TIME_ZONE`: required; valid when `new Intl.DateTimeFormat("en-US", { timeZone })`
    does not throw. This accepts canonical IANA names and `UTC`.
  - `CORS_ORIGINS`: comma-separated, trimmed, empty entries dropped, each must be a URL;
    default `http://localhost:5173`.
  - `PORT`: coerced integer 1–65535, default `3000`.
- **Alternatives considered**: `dotenv` (rejected: Node already does this, Principle V).

## R6. Time zone handling and "today"

- **Decision**: `todayInTimeZone(timeZone, now: Date): string` uses
  `Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })`
  with `formatToParts`, then builds `YYYY-MM-DD` from the parts. That format sorts the same as
  text and by date, so "past" means `date < today` with a string comparison, both in code and
  in the Mongo query (`{ date: { $gte: today } }`).
- **Calendar validity**: `isValidCalendarDate("YYYY-MM-DD")` is pure arithmetic: month 1–12 and
  day 1..daysInMonth, with the Gregorian leap rule. No `Date` parsing, which would silently
  roll `2026-02-30` over to March 2.
- **Clock injection**: `createApp({ config, clock })`, where `clock.now(): Date` defaults to
  `() => new Date()`. Tests pin the clock to an instant where the restaurant's date differs
  from the UTC date (e.g. `2026-11-06T23:30:00Z` with `Pacific/Kiritimati`, UTC+14, where it
  is already 2026-11-07), which covers the "today" boundary.
- **Alternatives considered**: Luxon / date-fns-tz / Temporal polyfill (rejected: `Intl`
  covers all of this).

## R7. Uniqueness under concurrency

- **Decision**: All uniqueness relies on MongoDB unique indexes. The duplicate-key error (code
  `11000`, also caught as `MongoServerError`) maps to `CONFLICT`. No read-then-write
  pre-checks.
  - `staffmembers.email`: unique.
  - `tables.nameKey`: unique with `partialFilterExpression: { removed: false }`, so removed
    tables do not block reuse of their name.
  - `closeddates.date`: unique.
- **Index readiness**: bootstrap (and the test harness) awaits `Model.init()` for every model
  before serving requests, so the concurrent-create test runs against a built index.
  `autoIndex` stays on in development; `init()` makes the build explicit and awaited.
- **Self-rename**: `PATCH` writes the new `nameKey` with `updateOne` / `findOneAndUpdate` on the
  same document. A unique index never conflicts a document with itself, so resubmitting a
  table's own name (any case) succeeds.
- **Alternatives considered**: `findOne` then `insert` (rejected: racy, which is exactly what
  SC-005 and Principle III forbid); transactions (rejected: unnecessary for single-document
  writes, and would require a replica set in tests).

## R8. Route definition, validation and OpenAPI from one source

- **Decision**: A small `defineRoute()` helper in `src/shared/openapi/route.ts`. Each module
  declares its routes as data: `method`, `path` (Express style, `/tables/:id`), `summary`,
  `tags`, `auth: boolean`, `request: { params?, query?, body? }` (Zod), `responses`
  (success schema and status, plus the list of error codes the route can produce), and
  `handler`. The helper:
  1. registers the operation in the shared `OpenAPIRegistry`: it converts `:id` to `{id}`,
     adds `security: [{ bearerAuth: [] }]` when `auth` is true, adds the standard
     `ErrorResponse` for every listed error code plus `401` on protected routes and `500`
     everywhere;
  2. mounts the Express route with, in order: `requireAuth` (if `auth`), a validation step that
     parses `params`, `query`, `body` with the Zod schemas and stores the results in
     `res.locals.input` (Express 5 makes `req.query` a getter, so it is not reassigned), and
     the async handler (Express 5 forwards rejected promises to the error middleware).
- **Rationale**: Validation and documentation cannot drift because they read the same schema
  object, and SC-004 holds by construction. The contract test still checks it independently by
  comparing the Express router stack with the generated document.
- **Strictness**: every request body and query object schema uses `.strict()`; unknown keys
  become `VALIDATION_ERROR` with `reason: "Unknown field"`.
- **Alternatives considered**: separate validation middleware plus hand-written
  `registry.registerPath` calls (rejected: two places to update per route).

## R9. Error model and mapping

- **Decision**: `AppError(code, message, details?)` with a fixed `code → status` table:
  `VALIDATION_ERROR 400`, `AUTHENTICATION_REQUIRED 401`, `INVALID_CREDENTIALS 401`,
  `NOT_FOUND 404`, `CONFLICT 409`, `SERVICE_UNAVAILABLE 503`, `INTERNAL_ERROR 500`. The central
  error middleware maps:
  - `AppError` → as declared;
  - `ZodError` → `VALIDATION_ERROR`, `details: [{ field, reason }]`, where `field` is the issue
    path joined in dot/bracket form (`days[2].periods[1].end`; body fields have no `body.`
    prefix, while query/params fields are prefixed `query.` / `params.`), `reason` is the
    issue message;
  - body-parser `entity.parse.failed` (malformed JSON) → `VALIDATION_ERROR`,
    `details: [{ field: "body", reason: "Malformed JSON" }]`;
  - body-parser `entity.too.large` (over 100 kB) → `VALIDATION_ERROR` (the spec's outcome
    categories are closed, and this is an input fault);
  - Mongo `11000` that reaches the middleware without being mapped → `CONFLICT` (safety net;
    services map it with a specific message);
  - anything else → `INTERNAL_ERROR` with the generic message `"An unexpected error occurred"`.
    The error is logged server-side, and no stack or internal message reaches the client.
- **Malformed ids**: `GET/PATCH/DELETE /tables/:id` with a non-ObjectId `id` → `NOT_FOUND`
  (an id that cannot exist is the same as an unknown id to the caller, and this avoids
  exposing the storage id format). The params schema checks the format, and the handler turns
  a format failure into `NOT_FOUND` instead of `VALIDATION_ERROR`.
- **Malformed closed date in path**: `DELETE /closed-dates/:date` with a bad format or an
  impossible date → `VALIDATION_ERROR`; a well-formed date that is not closed → `NOT_FOUND`.
- **Fallback**: a final middleware returns `NOT_FOUND` ("Route not found") for unknown routes or
  methods.
- **`SERVICE_UNAVAILABLE`** is the one code added beyond the user's list. It is used only by
  `GET /health` when the database is down, so the health endpoint can return the correct 503
  status (Principle IV) while keeping the standard error shape (Principle IV, SC-003). No
  management operation produces it.
- **Alternatives considered**: health always returning 200 with a status field (rejected:
  monitors depend on the status code); 503 with a non-standard body (rejected: breaks the
  single error shape).

## R10. Authentication middleware details

- **Decision**: `requireAuth` reads `Authorization: Bearer <token>`. A missing header, wrong
  scheme, or empty token → `AUTHENTICATION_REQUIRED`. `jwtVerify(token, key, { algorithms:
  ["HS256"], currentDate: clock.now() })`; any verification error (bad signature, malformed,
  expired, missing `sub`) → `AUTHENTICATION_REQUIRED`. A valid token whose `sub` no longer
  matches a staff member → `AUTHENTICATION_REQUIRED`. On success, `res.locals.staff` holds
  `{ id, name, email }`.
- **Token claims**: `sub` (staff ObjectId hex), `iat`, `exp`. No email or name in the token.
- **Rate limiting**: out of scope (spec Assumptions); recorded as known debt in
  `backend/README.md`.

## R11. Weekly schedule representation

- **Decision**:
  - Request: `{ "days": [{ "day": "monday", "periods": [{ "name", "start", "end" }] }] }`. An
    array, so repeated days can be detected; JSON object keys would silently keep the last
    value.
  - Day names are lowercase English (`monday` … `sunday`). An omitted day is closed.
  - Response: always all 7 days, Monday first (ISO 8601 week order), periods sorted by `start`,
    names trimmed.
  - Storage: a single document `{ _id: "weekly", days: [7 × { day, periods }] }`, replaced with
    `findOneAndUpdate({ _id: "weekly" }, { $set: { days } }, { upsert: true, new: true })`.
    This is one atomic single-document write, and it runs only after validation passes, so a
    refused update never touches storage (FR-024).
- **Split of responsibilities**: the Zod schema checks shape and format (strict objects, `day`
  enum, `HH:mm` regex `^([01]\d|2[0-3]):[0-5]\d$`, name 1–50 after trim). The pure
  `validateWeeklySchedule(input)` checks cross-item rules (repeated days, end > start,
  overlaps, duplicate names per day) by comparing minutes since midnight, and returns either
  `{ ok: true, value: NormalizedSchedule }` or `{ ok: false, errors: FieldError[] }`. Error
  fields use the request's indexes (e.g. `days[1].periods[0].end`), and each reason names the
  day and the period (e.g. `"tuesday 'Lunch': end must be after start"`).
- **Overlap rule**: after sorting by start, adjacent periods `a`, `b` overlap when
  `b.start < a.end`. Equal boundary (`a.end == b.start`) is allowed.

## R12. Table ordering

- **Decision**: List sorted by `nameKey` with collation `{ locale: "en", numericOrdering: true }`,
  so `T2` comes before `T10`. Ties cannot happen among active tables because `nameKey` is
  unique.
- **Alternatives considered**: plain binary sort (rejected: "T10" before "T2" is surprising for
  staff).

## R13. Closed-date list and reason

- **Decision**: `GET /closed-dates?includePast=true|false`. The query schema is strict with
  `z.enum(["true","false"]).default("false")`. `z.coerce.boolean()` is avoided because it turns
  `"false"` into `true`. The response is an array sorted by `date` ascending:
  `[{ date, reason }]`, with `reason: string | null`. The input `reason` is trimmed and
  stored as `null` when empty or absent.

## R14. Testing harness

- **Decision**: Vitest `globalSetup` starts a single `MongoMemoryServer` and exposes its URI.
  Each test file connects Mongoose to its own database name (from the file name or a random
  suffix) so files can run in parallel. `beforeEach` clears collections, `afterAll` drops the
  database and disconnects. `tests/helpers/` provides `buildTestApp({ timeZone?, now? })`,
  `seedStaff()`, `loginAs()`, and `expectError(res, status, code)`, which also validates the
  body against `ErrorResponseSchema` so every negative test also checks SC-003.
- **Contract tests** (`tests/contract/`):
  - `auth-coverage.test.ts` (SC-002): builds the OpenAPI document and, for each operation with
    `security`, sends a request with path params filled with syntactically valid dummies and no
    token, expecting 401 `AUTHENTICATION_REQUIRED`. Also checks that the public set is exactly
    `{GET /health, POST /auth/login, GET /openapi.json}` plus `/docs` (served outside the
    registry).
  - `error-shape.test.ts` (SC-003): one request per category (malformed JSON, unknown field,
    missing token, bad credentials, unknown route, unknown id, duplicate, forced internal error
    through a test-only route injected into a test app instance) checked against the schema.
  - `openapi-coverage.test.ts` (SC-004): walks the Express 5 router stack (`app.router.stack`),
    collects `METHOD path`, and asserts each is in the OpenAPI document with at least one 2xx
    response and every declared error response; the reverse direction is checked too.
- **First-run note**: mongodb-memory-server downloads a `mongod` binary on first use
  (cached under `~/.cache/mongodb-binaries`); CI caches it.

## R15. Dependency justification (Principle V)

| Package | Kind | Used for | Why the standard library / existing stack is not enough |
|---|---|---|---|
| `express@^5.3` | runtime | HTTP routing, JSON body parsing | Mandated by the constitution; `node:http` has no routing or middleware chain. |
| `mongoose@^9.12` | runtime | MongoDB ODM: schemas, indexes, queries | Mandated by the constitution; the raw driver would need hand-written index and schema management. |
| `zod@^4.6` | runtime | Request and env validation, single schema source | Mandated by the constitution; no built-in schema validation. |
| `@asteasolutions/zod-to-openapi@^9.1` | runtime | Generates the OpenAPI document from Zod schemas | Principle I requires generating OpenAPI from Zod; hand-writing it defeats the single source of truth. |
| `swagger-ui-express@^5.0` | runtime | Serves interactive docs at `/docs` | FR-025 requires interactive docs; building a UI is out of scope. |
| `jose@^6.2` | runtime | Sign and verify HS256 JWTs | Hand-rolled JWT is security-sensitive; jose has zero dependencies (see R3). |
| `cors@^2.8` | runtime | CORS for the configured frontend origins | Preflight handling is easy to get wrong by hand; tiny, standard middleware. |
| `typescript@~6.0.3` | dev | Type checking, build | Constitution stack; 6.0 for typescript-eslint compatibility (R1). |
| `tsx@^4.23` | dev | Run TS directly (dev server, seed script) | Node's type stripping does not support every TS feature or path handling the project uses; tsx is a single zero-config runner. |
| `vitest@^5.1` | dev | Test runner | Mandated by the constitution. |
| `supertest@^7.3` | dev | HTTP assertions against the app factory | Mandated by the constitution. |
| `mongodb-memory-server@^11.3` | dev | In-process MongoDB for tests | Mandated by the constitution (no external DB in tests). |
| `eslint@^10` + `typescript-eslint@^8.72` | dev | Linting | ESLint cannot parse TypeScript without typescript-eslint. |
| `@types/express`, `@types/cors`, `@types/swagger-ui-express`, `@types/supertest`, `@types/node@^24` | dev | Type definitions | These packages do not ship their own types. |

Not added, on purpose: `dotenv` (Node `--env-file`), `bcrypt`/`argon2` (`crypto.scrypt`),
date libraries (`Intl`), `helmet`/`express-rate-limit` (out of scope, noted as debt),
`jsonwebtoken` (jose).
