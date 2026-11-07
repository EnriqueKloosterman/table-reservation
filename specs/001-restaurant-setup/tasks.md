---

description: "Task list for feature 001-restaurant-setup (Staff Access and Restaurant Setup)"
---

# Tasks: Staff Access and Restaurant Setup

**Input**: Design documents from `/specs/001-restaurant-setup/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle II (Test-First, NON-NEGOTIABLE) mandates Vitest +
Supertest tests written first and **observed failing** before implementation, with
mongodb-memory-server for persistence. Every story phase therefore starts with test tasks
followed by an explicit "run and confirm RED" task. Foundational code (validation pipeline,
error middleware) is covered by its own failing tests (T013a, T029a) before it is written.
Tests that verify behavior already delivered by earlier stories (T078, T079, T086) prove they
can fail through a temporary mutation check, the one documented deviation in plan.md
"Complexity Tracking".

**Organization**: Tasks are grouped by user story so each story can be implemented and tested
on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: The user story the task belongs to (US1–US5)
- All paths are relative to the repository root; all code lives under `backend/`

## Conventions used by every task

- Module layering (see plan.md "Structure Decision"): `*.routes.ts` only declares operations
  with `defineRoute` and sets `handler: controller.<name>`; HTTP handlers live in
  `*.controller.ts` (`create<Module>Controller(deps)`, typed with `RouteHandler<P, Q, B>`), which
  read `res.locals.input`, call the service and set status/headers/body; services stay HTTP-free.
  Wherever a task below says a route's "handler" does something, that code goes in the controller.
- ESM + TypeScript strict (`nodenext`): relative imports use the `.js` extension
  (e.g. `import { AppError } from "../errors/app-error.js"`).
- Every schema module imports `z` from `backend/src/shared/openapi/zod.ts` (never directly from
  `zod`), so `.openapi()` is available.
- Error body shape, always: `{ "error": { "code": string, "message": string, "details"?: unknown } }`.
- Error codes → status: `VALIDATION_ERROR 400`, `AUTHENTICATION_REQUIRED 401`,
  `INVALID_CREDENTIALS 401`, `NOT_FOUND 404`, `CONFLICT 409`, `SERVICE_UNAVAILABLE 503`,
  `INTERNAL_ERROR 500`.
- Field-path convention for `details[].field`: body fields from the body root with dots and
  `[i]` (`days[1].periods[0].end`), the whole body as `body`, query as `query.<name>`, path
  params as `params.<name>`.
- Check order: route match (404) → auth (401) → validation (400) → existence (404) →
  uniqueness (409).
- Uniqueness is enforced only by MongoDB unique indexes; catch duplicate key `11000` and map to
  `CONFLICT`. Never read-then-write.
- Restaurant-local values (`"HH:mm"`, `"YYYY-MM-DD"`) are stored as text and never converted to
  UTC. Instants (`createdAt`, `updatedAt`, `removedAt`, `expiresAt`) are UTC.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the `backend/` package and its tooling.

- [X] T001 Create the directory skeleton `backend/src/{config,db,shared/{errors,middleware,openapi,validation},modules/{health,auth,tables,schedule,closed-dates}}`, `backend/scripts/`, `backend/tests/{setup,helpers,unit,integration,contract}` per plan.md "Source Code"; do NOT create `frontend/`
- [X] T002 Create `backend/package.json`: `"name": "table-reservation-backend"`, `"type": "module"`, `"private": true`, `"engines": { "node": ">=22.12" }`; dependencies `express@^5.3`, `mongoose@^9.12`, `zod@^4.6`, `@asteasolutions/zod-to-openapi@^9.1`, `swagger-ui-express@^5.0`, `jose@^6.2`, `cors@^2.8`; devDependencies `typescript@~6.0.3`, `tsx@^4.23`, `vitest@^5.1`, `supertest@^7.3`, `mongodb-memory-server@^11.3`, `eslint@^10`, `typescript-eslint@^8.72`, `@types/express`, `@types/cors`, `@types/swagger-ui-express`, `@types/supertest`, `@types/node@^24`; scripts `dev` = `tsx watch --env-file-if-exists=.env src/server.ts`, `build` = `tsc -p tsconfig.json`, `start` = `node --env-file-if-exists=.env dist/src/server.js`, `test` = `vitest run`, `test:watch` = `vitest`, `typecheck` = `tsc --noEmit`, `lint` = `eslint .`, `seed:staff` = `tsx --env-file-if-exists=.env scripts/seed-staff.ts`; then run `npm install` in `backend/` to produce `backend/package-lock.json`. Add no other package (Principle V)
- [X] T003 [P] Create `backend/tsconfig.json`: `strict: true`, `module`/`moduleResolution: "nodenext"`, `target: "es2023"`, `outDir: "dist"`, `rootDir: "."`, `include: ["src", "scripts", "tests", "vitest.config.ts"]`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: false`, `verbatimModuleSyntax: true`, `skipLibCheck: true`
- [X] T004 [P] Create `backend/eslint.config.js` (flat config) using `typescript-eslint` `recommendedTypeChecked` with `parserOptions.projectService: true`; ignore `dist/` and `node_modules/`
- [X] T005 [P] Create `backend/vitest.config.ts`: `test.globalSetup: ["tests/setup/global-setup.ts"]`, `test.environment: "node"`, `test.include: ["tests/**/*.test.ts"]`, `test.testTimeout: 20000`, `test.hookTimeout: 60000` (first-run `mongod` download)
- [X] T006 [P] Create `backend/.env.example` with placeholders only: `MONGODB_URI=mongodb://localhost:27017/table-reservation`, `JWT_SECRET=change-me-to-a-random-string-of-at-least-32-chars`, `JWT_EXPIRES_IN=8h`, `RESTAURANT_TIME_ZONE=Europe/Madrid`, `CORS_ORIGINS=http://localhost:5173`, `PORT=3000`, `STAFF_NAME=`, `STAFF_EMAIL=`, `STAFF_PASSWORD=`; add a root `.gitignore` (or extend the existing one) with `node_modules/`, `dist/`, `.env`, `coverage/`
- [X] T007 [P] Create `backend/README.md` skeleton with sections: Overview, Requirements (Node 24 LTS, min 22.12; MongoDB), Setup, Scripts, Configuration (table of env keys), Testing, API docs (`/docs`, `/openapi.json`), Known debt (filled in T087)

**Checkpoint**: `npm install`, `npm run typecheck` and `npm run lint` run (no sources yet is fine).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config, DB connection, clock, error model, validation, OpenAPI/`defineRoute`
scaffolding, app factory, server, health, CORS and the test harness. Every story depends on this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Test harness (needed before any test can run)

- [X] T008 Create `backend/tests/setup/global-setup.ts`: Vitest `globalSetup` that starts one `MongoMemoryServer`, exposes its URI to workers via `project.provide("mongoUri", uri)` (declare the `ProvidedContext` type augmentation in `backend/tests/setup/vitest.d.ts`), and stops it in teardown
- [X] T009 Create `backend/tests/setup/db.ts` exporting `useTestDatabase()`: registers `beforeAll` (connect Mongoose to `inject("mongoUri")` with a unique `dbName` per test file, e.g. `test_${crypto.randomUUID()}`, then `await initModels()`), `beforeEach` (delete all documents in every collection), `afterAll` (drop database, disconnect). Depends on T020 for `initModels` (write the import now; it compiles once T020 exists)
- [X] T010 [P] Create `backend/tests/helpers/expect-error.ts` exporting `expectError(res, status, code)`: asserts `res.status`, asserts `res.headers["content-type"]` matches `application/json`, parses `res.body` with `ErrorResponseSchema` from `backend/src/shared/openapi/common.ts` (must succeed), asserts `body.error.code === code`, and returns `body.error` for further assertions (e.g. on `details`)
- [X] T011 [P] Create `backend/tests/helpers/build-test-app.ts` exporting `buildTestApp(options?: { timeZone?: string; now?: Date | (() => Date); jwtSecret?: string; jwtExpiresIn?: string; isDatabaseUp?: () => boolean; configureTestRoutes?: (ctx: RouteContext) => void })` (the `RouteContext` of T025, so test routes can use `defineRoute` or plain `ctx.router` handlers) that builds a valid `Config` (defaults: `RESTAURANT_TIME_ZONE "UTC"`, `JWT_SECRET` = 32+ char test string, `JWT_EXPIRES_IN "8h"`, `CORS_ORIGINS ["http://localhost:5173"]`) and a `Clock` (fixed when `now` is given) and returns `createApp({ config, clock, isDatabaseUp, configureTestRoutes })`

### Unit tests for foundational pure functions (write first, see them fail)

- [X] T012 [P] Write `backend/tests/unit/normalize.test.ts`: `normalizeEmail(" Ana@Resto.com ")` → `"ana@resto.com"`; `normalizeName("  T1 ")` → `"T1"` (case kept); `nameKey("  T1 ")` → `"t1"`
- [X] T013 [P] Write `backend/tests/unit/env.test.ts`: `parseDuration` (`"8h"` → 28800, `"30s"` → 30, `"15m"` → 900, `"2d"` → 172800; `"8"`, `"h"`, `"1.5h"`, `"8w"` throw); `loadConfig(env)` returns typed config with defaults (`JWT_EXPIRES_IN "8h"`, `CORS_ORIGINS ["http://localhost:5173"]`, `PORT 3000`); refuses `JWT_SECRET` shorter than 32 chars, `RESTAURANT_TIME_ZONE "Mars/Olympus"`, missing `MONGODB_URI`, `PORT "0"` / `"70000"`, a non-URL entry in `CORS_ORIGINS`; accepts `RESTAURANT_TIME_ZONE "UTC"` and `"Europe/Madrid"`; trims `CORS_ORIGINS` entries and drops empty ones (`"http://a.test, ,http://b.test"` → 2 entries); on failure the thrown `ConfigError` lists **every** invalid key, not just the first
- [X] T013a [P] Write `backend/tests/unit/zod-issues.test.ts` for `zodIssuesToDetails` (T019), building `ZodError`s with real `safeParse` calls: nested path `days[1].periods[0].end` (dots for keys, `[i]` for indexes); empty path → `"body"` without prefix and `"query"` / `"params"` with a prefix; prefix applied to non-empty paths (`query.includePast`, `params.date`); body fields carry no `body.` prefix; an `unrecognized_keys` issue with two unknown keys → **two** entries `reason: "Unknown field"`, each at the issue path plus the key (`color`, `days[0].periods[0].foo`); `reason` equals the issue message for other issues; several issues → one entry each, in issue order
- [X] T014 Run `npm test -- tests/unit` in `backend/` and confirm T012–T013a FAIL (modules missing) — record RED

### Implementation

- [X] T015 [P] Implement `backend/src/shared/validation/normalize.ts`: `normalizeEmail(s) = s.trim().toLowerCase()`, `normalizeName(s) = s.trim()`, `nameKey(s) = normalizeName(s).toLowerCase()`
- [X] T016 [P] Implement `backend/src/config/env.ts`: Zod schema for `MONGODB_URI` (required, non-empty), `JWT_SECRET` (`min(32)`), `JWT_EXPIRES_IN` (regex `^\d+[smhd]$`, default `"8h"`), `RESTAURANT_TIME_ZONE` (required; valid iff `new Intl.DateTimeFormat("en-US", { timeZone })` does not throw), `CORS_ORIGINS` (comma-separated, trimmed, empty entries dropped, each a URL; default `http://localhost:5173`), `PORT` (coerced integer 1–65535, default 3000); export `type Config` (with `jwtExpiresInSeconds: number` computed by `parseDuration`), `parseDuration(s): number`, `class ConfigError` (carries the list of invalid keys), and `loadConfig(env = process.env): Config` that throws `ConfigError` listing every invalid key
- [X] T017 [P] Implement `backend/src/shared/clock.ts`: `interface Clock { now(): Date }`, `systemClock: Clock = { now: () => new Date() }`, `fixedClock(at: Date): Clock`
- [X] T018 [P] Implement `backend/src/shared/errors/app-error.ts`: `type ErrorCode = "VALIDATION_ERROR" | "AUTHENTICATION_REQUIRED" | "INVALID_CREDENTIALS" | "NOT_FOUND" | "CONFLICT" | "SERVICE_UNAVAILABLE" | "INTERNAL_ERROR"`, `ERROR_STATUS: Record<ErrorCode, number>` (400/401/401/404/409/503/500), `type FieldError = { field: string; reason: string }`, `class AppError extends Error { code; details? }`, and factory helpers `validationError(details: FieldError[])` (message `"Request validation failed"`), `authenticationRequired()` (message exactly `"Authentication required"`), `invalidCredentials()` (message exactly `"Invalid email or password"`), `notFound(message)`, `conflict(message)`, `serviceUnavailable()` (details `{ database: "down" }`)
- [X] T019 [P] Implement `backend/src/shared/validation/zod-issues.ts`: `zodIssuesToDetails(error: ZodError, prefix?: "query" | "params"): FieldError[]` — join the issue path with `.` for keys and `[i]` for numeric indexes; empty path → `"body"` (no prefix) or the prefix itself; `unrecognized_keys` issues produce **one entry per unknown key** with `reason: "Unknown field"`; body fields carry no `body.` prefix; `reason` = issue message
- [X] T020 Implement `backend/src/db/connection.ts`: `connectDatabase(uri)`, `disconnectDatabase()`, `isDatabaseUp(): boolean` (`mongoose.connection.readyState === 1`), and `initModels(): Promise<void>` that awaits `Model.init()` for every model in a module-level registry populated by `registerModel(model)` (each model file calls `registerModel` in US1–US4) so unique indexes are built before requests are served (research R7)
- [X] T021 [P] Implement `backend/src/shared/openapi/zod.ts`: `import { z } from "zod"; import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi"; extendZodWithOpenApi(z); export { z };`
- [X] T022 Implement `backend/src/shared/openapi/common.ts`: `FieldErrorSchema` (`{ field: string, reason: string }`), `ErrorResponseSchema` = `{ error: { code: enum of the 7 codes, message: string, details?: oneOf(FieldError[] non-empty, { database: "down" }) } }` registered as component `ErrorResponse`; and `backend/src/shared/openapi/registry.ts` exporting a factory `createRegistry()` that returns a fresh `OpenAPIRegistry` with `ErrorResponse` registered and `registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer", bearerFormat: "JWT" })` (a fresh registry per `createApp` call so test apps do not share state)
- [X] T023 Implement `backend/src/shared/validation/validate.ts`:
  - `jsonBody(): RequestHandler[]` — the **per-route** body parser, used only by routes with a body schema and mounted by `defineRoute` **after** `requireAuth` (never globally, so unknown routes answer 404 and protected routes answer 401 before any body is read): (1) refuses a missing/non-JSON `Content-Type` with `validationError([{ field: "body", reason: "Content-Type must be application/json" }])` (`charset` parameter allowed) before reading the body; (2) `express.json({ limit: "100kb" })` (default `type`, `strict: true`); parse/size failures reach the error middleware (T024)
  - `buildValidationStep({ params?, query?, body? })` Express middleware that (1) parses `req.params` (prefix `params`), `req.query` (prefix `query`; schemas are `.strict()`), `req.body` (strict) with `safeParse`, collecting the issues of **all three** before failing, so one response reports every stage-1 error; (2) stores results in `res.locals.input = { params, query, body }` (never reassign `req.query`, Express 5 getter). Routes without a query schema ignore the query string; routes without a body schema never parse a body and ignore it
- [X] T024 Implement `backend/src/shared/errors/error-middleware.ts` and `backend/src/shared/errors/not-found.ts`: error middleware maps `AppError` → its status/body; `ZodError` → `VALIDATION_ERROR` via `zodIssuesToDetails`; body-parser `type === "entity.parse.failed"` → `VALIDATION_ERROR` `[{ field: "body", reason: "Malformed JSON" }]`; `type === "entity.too.large"` → `VALIDATION_ERROR` `[{ field: "body", reason: "Request body exceeds 100 kB" }]`; Mongo error with `code === 11000` → `CONFLICT` (safety net); anything else → log server-side (`console.error`) and return `500 { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } }` with no details, stack, or driver message. `notFound` middleware returns `404 NOT_FOUND` with message `"Route not found"` for any unmatched method+path
- [X] T025 Implement `backend/src/shared/openapi/route.ts`: `type RouteContext = { router: express.Router; registry: OpenAPIRegistry; requireAuth: RequestHandler; config: Config; clock: Clock }` and `defineRoute(ctx, { method, path /* Express style, "/tables/:id" */, summary, description, tags, auth: boolean, request?: { params?, query?, body?: { schema, example } }, success: { status, description, schema?, headers? }, errors: ErrorCode[], handler })`. It (1) calls `registry.registerPath` with the path converted to `{id}` form, `summary`, `description`, `tags`, request params/query/body (body as `application/json` with its `example`), the success response, one response per status in `errors` **plus `401 AUTHENTICATION_REQUIRED` when `auth` and `500 INTERNAL_ERROR` always**, each referencing `ErrorResponse` and naming the possible codes in its description, and `security: [{ bearerAuth: [] }]` only when `auth`; (2) mounts `router[method](path, ...(auth ? [ctx.requireAuth] : []), ...(request?.body ? jsonBody() : []), buildValidationStep(request), handler)` — this order implements the refusal precedence route match (404) → auth (401) → validation (400, including malformed/oversized/non-JSON bodies). Handlers are async (Express 5 forwards rejections)
- [X] T026 Implement `backend/src/shared/openapi/document.ts`: `buildOpenApiDocument(registry)` using `OpenApiGeneratorV31` with `openapi: "3.1.0"`, `info: { title: "Table Reservation API", version: "0.1.0", description }`; and `registerDocsRoutes(ctx)` that adds `GET /openapi.json` via `defineRoute` (public, tag `Documentation`, success 200 described as the generated document, errors `[]`) returning the document generated lazily after all routes are registered, and mounts `swagger-ui-express` at `/docs` (not in the registry) with `swaggerOptions: { url: "/openapi.json", persistAuthorization: true, tryItOutEnabled: true }`
- [X] T027 Implement `backend/src/shared/middleware/require-auth.ts` as a **fail-closed placeholder**: `createRequireAuth(deps)` returning middleware that always throws `authenticationRequired()`. US1 (T046) replaces the body with real JWT verification; the signature stays the same

### Health and CORS (test first)

- [X] T028 [P] Write `backend/tests/integration/health.test.ts` (calls `useTestDatabase()` so the default `isDatabaseUp` sees a connected Mongoose): `GET /health` → `200 { status: "ok", database: "up" }`; with `buildTestApp({ isDatabaseUp: () => false })` → `expectError(res, 503, "SERVICE_UNAVAILABLE")` and `details` equals `{ database: "down" }`; `GET /nope` → `expectError(404, "NOT_FOUND")`; `DELETE /health` (unsupported method) → `404 NOT_FOUND`; `POST /nope` with `Content-Type: application/json` and malformed JSON `{"a":` → `404 NOT_FOUND` (not 400: unknown routes never parse a body); the same for `POST /nope` with a body over 100 kB and with `Content-Type: text/plain` → 404; `GET /openapi.json` → 200 with `openapi` starting with `"3.1"`; `GET /docs/` → 200 HTML
- [X] T029 [P] Write `backend/tests/integration/cors.test.ts`: `OPTIONS /tables` with `Origin: http://localhost:5173` and `Access-Control-Request-Method: POST` → 204 with `Access-Control-Allow-Origin: http://localhost:5173`, allowed methods `GET,POST,PUT,PATCH,DELETE`, allowed headers including `Authorization` and `Content-Type`, and **no** `Access-Control-Allow-Credentials`; same preflight from `http://evil.test` → no `Access-Control-Allow-Origin` header; preflight is answered without a token (before auth and route match)
- [X] T029a [P] Write `backend/tests/integration/validation-pipeline.test.ts` (FR-021–FR-024, SC-003 groundwork) for the request pipeline and error middleware (T023–T025), using `buildTestApp({ configureTestRoutes: ctx => … })` to mount test-only routes; no module routes are needed:
  - `defineRoute` `POST /__test/items` (public; strict body `{ name: z.string().trim().min(1), qty: z.number().int().min(1) }`; success 201 echoing `res.locals.input.body`): valid body → 201 with trimmed `name`; malformed JSON `{"name":` → 400 `[{ field: "body", reason: "Malformed JSON" }]`; body over 100 kB → 400 `[{ field: "body", reason: "Request body exceeds 100 kB" }]`; `Content-Type: text/plain` and a missing `Content-Type` → 400 field `body`; `application/json; charset=utf-8` accepted; top-level array → 400 field `body`; unknown field `color` → reason `"Unknown field"`; both `name` and `qty` invalid → **two** details in one response; `?x=1` on this route (no query schema) is ignored → 201
  - `defineRoute` `GET /__test/items` (public; strict query `{ flag: z.enum(["true","false"]).optional() }`) plus params route `GET /__test/items/:code` (params `{ code: z.string().regex(/^\d{3}$/) }`): `?foo=1` → 400 field `query.foo`; `?flag=yes` → field `query.flag`; `/__test/items/ab` → field `params.code`; an invalid query **and** an invalid param on one request → both details in one response (all stage-1 issues collected)
  - Plain `ctx.router` handlers: throwing `conflict("x")` → `409 CONFLICT`; throwing an object with `code: 11000` → `409 CONFLICT` (safety net); throwing `new Error("secret driver message at /src/x.ts")` → `500 INTERNAL_ERROR`, message `"An unexpected error occurred"`, no `details`, and the serialized body contains neither `"secret"` nor `"/src/"`
  - Every negative case goes through `expectError`
- [X] T030 Run `npm test -- tests/integration/health.test.ts tests/integration/cors.test.ts tests/integration/validation-pipeline.test.ts` and confirm they FAIL — record RED
- [X] T031 Implement `backend/src/modules/health/health.routes.ts`: `registerHealthRoutes(ctx, isDatabaseUp)` with `defineRoute` `GET /health` (public, tag `Health`, summary/description, success 200 `{ status: "ok", database: "up" }`, errors `["SERVICE_UNAVAILABLE"]`); handler throws `serviceUnavailable()` when `isDatabaseUp()` is false
- [X] T032 Implement `backend/src/app.ts`: `createApp({ config, clock = systemClock, isDatabaseUp = defaultIsDatabaseUp, configureTestRoutes? })` that, in order: `app.disable("x-powered-by")`; `cors({ origin: config.CORS_ORIGINS, methods: ["GET","POST","PUT","PATCH","DELETE"], allowedHeaders: ["Authorization","Content-Type"], credentials: false })` plus `app.options(/.*/, cors(...))` so preflight runs before routes/auth; **no global body parser** (bodies are parsed per route by `jsonBody()` inside `defineRoute`, after auth; see T023/T025); creates `registry`, `router`, `requireAuth`, the `RouteContext`; registers health, docs, and (later) module routes; calls `configureTestRoutes?.(ctx)`; mounts `router`; then `notFound`; then the error middleware. Exports `createApp` only (no `listen`). Leave clearly marked `// register module routes here` lines for US1–US4
- [X] T033 Implement `backend/src/server.ts`: `loadConfig()` (on `ConfigError` print every invalid key to stderr and `process.exit(1)` before connecting); `connectDatabase(MONGODB_URI)`; `initModels()`; `createApp({ config })`; `listen(PORT)`; on `SIGINT`/`SIGTERM` close the server then `disconnectDatabase()`
- [X] T034 Run `npm test` in `backend/` and confirm T012, T013, T013a, T028, T029, T029a PASS (GREEN); run `npm run typecheck` and `npm run lint` clean

**Checkpoint**: Foundation ready. `GET /health`, `/openapi.json`, `/docs`, CORS, 404 fallback and the
error model work; every protected route will refuse with 401 until US1 lands.

---

## Phase 3: User Story 1 - Staff sign-in and protected access (Priority: P1) 🎯 MVP

**Goal**: Staff sign in with email/password, receive a JWT with its expiry, and every management
operation refuses requests without valid, unexpired proof for an existing staff member.

**Independent Test**: Seed a staff account, `POST /auth/login`, then call `GET /auth/me` with and
without the token; only the authenticated call succeeds.

### Tests for User Story 1 (write first, must FAIL) ⚠️

- [X] T035 [P] [US1] Write `backend/tests/unit/password.test.ts`: `hashPassword("pw")` returns `scrypt$16384$8$1$<saltB64>$<hashB64>`; two hashes of the same password differ (random salt); `verifyPassword("pw", hash)` → true; wrong password → false; malformed stored hash → false (never throws); a 1024-char password hashes and verifies
- [X] T036 [P] [US1] Create `backend/tests/helpers/seed-staff.ts` exporting `seedStaff({ name = "Ana", email = "ana@resto.com", password = "correct horse battery" } = {})` that inserts via `StaffMember` with `normalizeEmail(email)` and `await hashPassword(password)`, returning `{ id, name, email, password }`; and `backend/tests/helpers/login-as.ts` exporting `loginAs(app, creds?)` that calls `POST /auth/login` and returns the bearer token string
- [X] T037 [US1] Write `backend/tests/integration/auth.test.ts` (uses `useTestDatabase`, `buildTestApp`, `seedStaff`, `expectError`) covering:
  - US1 #1: correct login → 200 `{ token, expiresAt, staff: { name: "Ana", email: "ana@resto.com" } }`; `expiresAt` matches `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$` and equals the token's `exp` claim ×1000; with a fixed clock and `JWT_EXPIRES_IN "8h"`, `expiresAt` = now + 8h (truncated to seconds)
  - US1 #2: wrong password and unknown email → `expectError(401, "INVALID_CREDENTIALS")` with identical `message` `"Invalid email or password"`
  - US1 #5: login with `" Ana@Resto.com "` succeeds
  - US1 #6: `GET /auth/me` with token → 200 `{ name, email }`; body has no `password`/`passwordHash` keys anywhere
  - US1 #3: `GET /auth/me` with no header, with `Authorization: Basic x`, with `Bearer ` (empty) → `401 AUTHENTICATION_REQUIRED`, message `"Authentication required"`
  - US1 #4: expired token (login with clock at T, verify with app clock at T + 8h + 1s) → 401; tampered token (flip one char of the signature) → 401; `alg: none` token with valid-looking payload → 401; token signed with a different 32+ char secret → 401; `"abc.def.ghi"` → 401; token for a staff member deleted after login → 401 — all `AUTHENTICATION_REQUIRED` with the same message
  - Validation: `{ email: "ana", password: "x" }` → `400 VALIDATION_ERROR` field `email`; empty password → field `password`; password longer than 1024 → field `password`; unknown field `{ ..., remember: true }` → field `remember` reason `"Unknown field"`; `null` email → 400
  - Check order: `GET /auth/me` without token is 401, unknown route without token is 404
- [X] T038 [P] [US1] Write `backend/tests/integration/provision-staff.test.ts` (FR-006; uses `useTestDatabase`) for the provisioning logic behind the seed script, imported from `backend/src/modules/auth/provision-staff.ts`:
  - `parseProvisionEnv(env)`: valid `{ MONGODB_URI, STAFF_NAME: " Ana ", STAFF_EMAIL: " Ana@Resto.com ", STAFF_PASSWORD }` → `{ mongoUri, name: "Ana", email: "ana@resto.com", password }`; missing `MONGODB_URI`, missing `STAFF_NAME`, 101-char name, `STAFF_EMAIL "ana"`, empty `STAFF_PASSWORD`, 1025-char password → throws `ProvisionConfigError` whose `keys` lists **every** invalid key in one error (e.g. all four at once), never echoing the password value
  - `provisionStaff({ name, email, password })` on an empty DB → returns `"created"`; the stored document has the normalized email, a `passwordHash` in `scrypt$…` form, `verifyPassword(password, passwordHash)` is true, and the password itself is stored nowhere
  - Idempotency: a second call with the same email (also as `" ANA@resto.com "` before normalization through `parseProvisionEnv`) and a different name/password → returns `"exists"`; exactly one document; name and `passwordHash` unchanged
  - Concurrency: two `provisionStaff` calls with the same email via `Promise.all` → one `"created"`, one `"exists"` (duplicate key `11000` mapped to `"exists"`, no read-then-write), exactly one document
  - The created account can sign in: `POST /auth/login` with the provisioned credentials → 200
- [X] T039 [US1] Run `npm test -- tests/unit/password.test.ts tests/integration/auth.test.ts tests/integration/provision-staff.test.ts` and confirm FAIL — record RED

### Implementation for User Story 1

- [X] T040 [P] [US1] Implement `backend/src/modules/auth/password.ts`: promisified `crypto.scrypt` with N=16384, r=8, p=1, keylen=64, 16-byte random salt; `hashPassword(pw): Promise<string>` → `scrypt$16384$8$1$<saltB64>$<hashB64>`; `verifyPassword(pw, stored): Promise<boolean>` parses the parameters from the stored string, uses `timingSafeEqual`, returns false on any malformed input; export `DUMMY_HASH` computed once at module load (top-level await) for unknown-email verification
- [X] T041 [P] [US1] Implement `backend/src/modules/auth/token.ts` with jose: `signToken({ staffId, secret, expiresInSeconds, now }): Promise<{ token, expiresAt: Date }>` — HS256, claims `sub` = staffId hex, `iat` = floor(now/1000), `exp` = iat + expiresInSeconds, `expiresAt = new Date(exp * 1000)`; `verifyToken(token, { secret, now }): Promise<{ staffId: string }>` with `jwtVerify(token, key, { algorithms: ["HS256"], currentDate: now })`, throwing on any failure or missing/non-ObjectId `sub`
- [X] T042 [P] [US1] Implement `backend/src/modules/auth/staff.model.ts`: Mongoose model `StaffMember` (collection `staffmembers`) with `name` ("Required, trimmed, 1–100 chars"), `email` ("Required; stored as `normalizeEmail(input)` = `trim().toLowerCase()`; valid email format. **Unique index**"), `passwordHash` ("Required; `scrypt$N$r$p$<saltB64>$<hashB64>`; `select: false`; never serialized"), `timestamps: true`; call `registerModel(StaffMember)` from `backend/src/db/connection.ts`
- [X] T043 [P] [US1] Implement `backend/src/modules/auth/auth.schemas.ts`: `LoginRequestSchema` = strict `{ email: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().min(1).max(1024) }` with OpenAPI example `{ "email": " Ana@Resto.com ", "password": "correct horse battery" }`; `StaffProfileSchema` = `{ name, email }`; `LoginResponseSchema` = `{ token: string, expiresAt: string (ISO date-time, UTC), staff: StaffProfileSchema }`; register each with `.openapi("<Name>")`
- [X] T044 [US1] Implement `backend/src/modules/auth/auth.service.ts`: `login({ email, password }, { config, clock })` — `findOne({ email })` selecting `+passwordHash`; if absent, `await verifyPassword(password, DUMMY_HASH)` then throw `invalidCredentials()`; if wrong password throw `invalidCredentials()`; else `signToken` and return `{ token, expiresAt: expiresAt.toISOString(), staff: { name, email } }`; `findStaffById(id)` returning `{ id, name, email } | null`
- [X] T045 [US1] Implement `backend/src/modules/auth/auth.routes.ts`: `registerAuthRoutes(ctx)` with `defineRoute` for `POST /auth/login` (public, tag `Auth`, body `LoginRequestSchema` + example, success 200 `LoginResponseSchema`, errors `["VALIDATION_ERROR", "INVALID_CREDENTIALS"]`) and `GET /auth/me` (auth, tag `Auth`, success 200 `StaffProfileSchema`, errors `[]`; handler returns `{ name, email }` from `res.locals.staff`); each with summary and description
- [X] T046 [US1] Replace the placeholder in `backend/src/shared/middleware/require-auth.ts`: parse `Authorization` with `/^Bearer (\S+)$/`; missing/wrong scheme/empty → `authenticationRequired()`; `verifyToken(token, { secret: config.JWT_SECRET, now: clock.now() })` failure → `authenticationRequired()`; `findStaffById(staffId)` null → `authenticationRequired()`; else set `res.locals.staff = { id, name, email }` and `next()`
- [X] T047 [US1] Wire `registerAuthRoutes(ctx)` into `backend/src/app.ts` and make sure `StaffMember` is registered for `initModels()`
- [X] T048 [US1] Implement staff provisioning (FR-006) in two parts so all logic is covered by T038:
  - `backend/src/modules/auth/provision-staff.ts`: `class ProvisionConfigError` (carries `keys: string[]`); `parseProvisionEnv(env = process.env)` — Zod schema for `MONGODB_URI` (required, non-empty), `STAFF_NAME` (trimmed, 1–100), `STAFF_EMAIL` (`normalizeEmail` then valid email), `STAFF_PASSWORD` (1–1024), collecting every invalid key into one `ProvisionConfigError`; `provisionStaff({ name, email, password }): Promise<"created" | "exists">` — `StaffMember.create({ name, email, passwordHash: await hashPassword(password) })`, catch duplicate key `11000` → `"exists"` without modifying the existing document (idempotent; uniqueness only via the index, never read-then-write). No `process.exit`, no console output, no connection handling
  - `backend/scripts/seed-staff.ts`: thin CLI wrapper with no logic of its own — `parseProvisionEnv()` (on `ProvisionConfigError` print every invalid key to stderr and exit 1 before connecting); `connectDatabase(mongoUri)`; `initModels()`; `provisionStaff(...)`; print `"created"` or `"already exists"`; `disconnectDatabase()`; exit 0
- [X] T049 [US1] Run `npm test` and confirm T035, T037 and T038 PASS (GREEN) along with all earlier tests; refactor if needed; `npm run typecheck && npm run lint` clean

**Checkpoint**: Sign-in works; `/auth/me` is protected; the MVP is demonstrable.

---

## Phase 4: User Story 2 - Manage tables (Priority: P1)

**Goal**: Staff create, list, read, update and soft-delete tables with unique (case-insensitive,
trimmed) names among active tables.

**Independent Test**: Sign in, create several tables, list them (natural order), edit one,
remove one, and confirm the list reflects each change.

### Tests for User Story 2 (write first, must FAIL) ⚠️

- [X] T050 [US2] Write `backend/tests/integration/tables.test.ts` (authenticated via `seedStaff` + `loginAs`) covering:
  - US2 #1: `POST /tables { name: "T1", capacity: 4 }` → 201 `{ id (24-hex), name: "T1", capacity: 4 }` and header `Location: /tables/{id}`; `{ name: "  Patio 3 " }` stored as `"Patio 3"`
  - US2 #2: create `T10`, `t2`, `T1` → `GET /tables` returns `T1`, `t2`, `T10` (case-insensitive, numeric ordering); each item has exactly `id`, `name`, `capacity`
  - US2 #3: create `" t1 "` when `T1` exists → `409 CONFLICT`; rename another table to `"T1 "` → 409
  - Concurrency: `Promise.all` of two `POST /tables { name: "Dup" }` → exactly one 201 and one 409, and exactly one active document in the collection
  - US2 #4: `PATCH { capacity: 6 }` → 200; subsequent `GET /tables/{id}` shows 6
  - Self-rename: `PATCH` of `T1` with `{ name: " t1 " }` → 200 and name becomes `"t1"`; `PATCH` with unchanged values → 200 unchanged
  - US2 #5 (all `400 VALIDATION_ERROR`, check `details[].field`): missing name (`name`), empty/whitespace name (`name`), name of 51 chars after trim (`name`), capacity `0`, `-1`, `4.5`, `51`, `"4"` (`capacity`), `null` name or capacity, both name and capacity invalid → **two** details in one response, unknown field `color` → reason `"Unknown field"`; `PATCH {}` → field `body`; `capacity: 4.0` is accepted as 4
  - Body edge cases: malformed JSON → `[{ field: "body", reason: "Malformed JSON" }]`; `Content-Type: text/plain` → field `body`; body over 100 kB → field `body`; top-level JSON array → field `body`
  - US2 #6: `DELETE /tables/{id}` → 204 empty body; not in `GET /tables`; `GET /tables/{id}` → 404; create `T1` again → 201; old id still 404 on GET/PATCH/DELETE; document still exists in DB with `removed: true` and a `removedAt` Date
  - US2 #7: unknown valid ObjectId and malformed id `"abc"` on GET/PATCH/DELETE → `404 NOT_FOUND` (not 400)
  - Check order: `POST /tables` with no token and an invalid body → 401; `POST /tables` duplicate of an existing name with an invalid capacity → 400 (validation precedes conflict, not 409); `PATCH /tables/0123456789abcdef01234567 { capacity: 0 }` (well-formed but unknown id, invalid body) → 400 (validation precedes existence); `PATCH /tables/abc { capacity: 6 }` (malformed id, valid body) → 404
  - SC-005: a refused `PATCH` (409 or 400) leaves the stored table unchanged
- [X] T051 [US2] Run `npm test -- tests/integration/tables.test.ts` and confirm FAIL — record RED

### Implementation for User Story 2

- [X] T052 [P] [US2] Implement `backend/src/modules/tables/table.model.ts`: model `Table` (collection `tables`) with `name` ("Required; `normalizeName(input)` = `trim()`; 1–50 chars after trim; case kept as entered"), `nameKey` ("Derived: `name.trim().toLowerCase()`; set by the service on every create/rename"), `capacity` ("Required; integer 1–50"), `removed` ("Default `false`"), `removedAt` ("Date | null, Default `null`; set when soft-deleted"), `timestamps: true`; index `{ nameKey: 1 }` **unique** with `partialFilterExpression: { removed: false }`; `registerModel(Table)`
- [X] T053 [P] [US2] Implement `backend/src/modules/tables/tables.schemas.ts`: `TableIdParamsSchema` (`{ id: z.string() }` — format checked in the service, malformed → 404); `CreateTableSchema` strict `{ name: z.string().trim().min(1).max(50), capacity: z.number().int().min(1).max(50) }` with example `{ "name": "T1", "capacity": 4 }`; `UpdateTableSchema` strict partial of the same, refined so `{}` fails with path `[]` (→ field `body`), example `{ "capacity": 6 }`; `TableSchema` `{ id, name, capacity }`; register `.openapi()` names
- [X] T054 [US2] Implement `backend/src/modules/tables/tables.service.ts`: `toTable(doc)` → `{ id: doc._id.toHexString(), name, capacity }`; `parseTableId(id)` → ObjectId or throw `notFound("Table not found")` when not 24-hex; `createTable` (insert with `nameKey`, catch `11000` → `conflict("A table with this name already exists")`); `listTables` (`find({ removed: false }).collation({ locale: "en", numericOrdering: true }).sort({ nameKey: 1 })`); `getTable` (`findOne({ _id, removed: false })` else 404); `updateTable` (`findOneAndUpdate({ _id, removed: false }, { $set: { ...(name && { name, nameKey }), ...(capacity && { capacity }) } }, { new: true, runValidators: true })`, null → 404, `11000` → 409); `removeTable` (`findOneAndUpdate({ _id, removed: false }, { $set: { removed: true, removedAt: clock.now() } })`, null → 404) — no reservation check (FR-011, enforced in feature 002)
- [X] T055 [US2] Implement `backend/src/modules/tables/tables.routes.ts`: `registerTableRoutes(ctx)` with `defineRoute` (all `auth: true`, tag `Tables`, each with summary + description): `POST /tables` (201 `TableSchema`, `Location` header documented, errors `["VALIDATION_ERROR","CONFLICT"]`; handler sets `Location: /tables/{id}`), `GET /tables` (200 `TableSchema[]`, errors `[]`), `GET /tables/:id` (200, errors `["NOT_FOUND"]`), `PATCH /tables/:id` (200, errors `["VALIDATION_ERROR","NOT_FOUND","CONFLICT"]`), `DELETE /tables/:id` (204 no body, errors `["NOT_FOUND"]`; description states the FR-011 rule "once reservations exist (feature 002), removing a table with future reservations will return 409 CONFLICT; not enforced in this feature" — do NOT list 409)
- [X] T056 [US2] Wire `registerTableRoutes(ctx)` into `backend/src/app.ts`; ensure `Table` is registered for `initModels()`
- [X] T057 [US2] Run `npm test` and confirm T050 PASS (GREEN) plus all earlier tests; `npm run typecheck && npm run lint` clean

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 - Define weekly service hours (Priority: P2)

**Goal**: Staff view and replace (as a whole) a weekly schedule of named service periods per day,
with all-or-nothing validation.

**Independent Test**: Sign in, `GET /schedule` (7 empty days), `PUT` lunch + dinner on Tue–Sun with
Monday empty, and confirm the normalized response and the next `GET` match.

### Tests for User Story 3 (write first, must FAIL) ⚠️

- [X] T058 [P] [US3] Write `backend/tests/unit/schedule.domain.test.ts` for `toMinutes` (`"00:00"` → 0, `"23:59"` → 1439, `"12:30"` → 750) and `validateWeeklySchedule(input)`:
  - valid input in any day order → `{ ok: true, value }` with 7 days Monday→Sunday, missing days `periods: []`, periods sorted by `start`, names trimmed
  - adjacent `12:00–15:00` + `15:00–18:00` → ok
  - end == start and end < start → error on `days[i].periods[j].end`, reason names day and period (e.g. `"tuesday 'Lunch': end must be after start"`)
  - overlap `12:00–15:00` + `14:00–17:00` submitted in reverse order → error on the `start` of the period that starts later, using the **submitted** index
  - duplicate names `"Lunch"` and `" lunch "` on the same day (non-overlapping) → error on the second occurrence's `name` in request order
  - repeated day → error on the second occurrence's `days[i].day`
  - multiple errors across days are all returned in one result
- [X] T059 [US3] Write `backend/tests/integration/schedule.test.ts` (authenticated) covering:
  - US3 #1: `GET /schedule` with no document → 200 with 7 days `monday`…`sunday`, each `periods: []`; and no document is written
  - US3 #2: `PUT` with Tue–Sun Lunch `12:00–15:00` + Dinner `20:00–23:30` and Monday `[]` → 200 normalized; next `GET` deep-equals it
  - Normalization: days submitted out of order, periods out of order, names with spaces, Sunday omitted → response Monday-first, sorted, trimmed, Sunday `[]`
  - US3 #3/#4/#6: end ≤ start, overlap, duplicate name → `400 VALIDATION_ERROR` with the field paths from contracts/api.md
  - US3 #5: `"25:00"`, `"12:7"`, `"9:00"`, `"24:00"` → field `days[i].periods[j].start|end`; unknown day `"funday"` → field `days[i].day`; empty name / 51-char name → `.name`; unknown field in a period → `"Unknown field"`; `days` missing → field `days`
  - Stage separation: a request with both a stage-1 error (bad time) and a stage-2 error (overlap) returns only stage-1 errors; a request with two stage-2 errors on different days returns both
  - US3 #7 / FR-024: valid `PUT`, then a refused `PUT` (overlap) → following `GET` equals the first schedule
  - Body edge cases and check order: `PUT /schedule` with no token and malformed JSON / a body over 100 kB / `Content-Type: text/plain` → 401; the same requests with a valid token → 400 field `body`
- [X] T060 [US3] Run `npm test -- tests/unit/schedule.domain.test.ts tests/integration/schedule.test.ts` and confirm FAIL — record RED

### Implementation for User Story 3

- [X] T061 [P] [US3] Implement `backend/src/modules/schedule/schedule.domain.ts`: `DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"] as const`, `type DayName`, `toMinutes("HH:mm")` = `h * 60 + m`, and pure `validateWeeklySchedule(input: { days: { day: DayName; periods: { name: string; start: string; end: string }[] }[] })` returning `{ ok: true, value: NormalizedSchedule } | { ok: false, errors: FieldError[] }` implementing: each day at most once (repeated → error on later `days[i].day`); per day: `toMinutes(end) > toMinutes(start)` (else error on `.end`); sort by start keeping submitted indexes, overlap when `next.start < prev.end` (error on the later-starting period's `.start`; equal boundaries allowed); no duplicate names by `trim().toLowerCase()` (error on second occurrence's `.name`); output 7 days Monday-first, missing days `[]`, periods sorted, names trimmed. No I/O
- [X] T062 [P] [US3] Implement `backend/src/modules/schedule/schedule.model.ts`: model `WeeklySchedule` (collection `weeklyschedules`) with `_id: String` (always `"weekly"`), `days` array of embedded `DaySchedule` (`_id: false`; `day` enum "`monday` | `tuesday` | `wednesday` | `thursday` | `friday` | `saturday` | `sunday`"; `periods` array of embedded `ServicePeriod` (`_id: false`; `name` "Trimmed, 1–50 chars"; `start`/`end` strings matching `^([01]\d|2[0-3]):[0-5]\d$`)), `timestamps: true`; `registerModel(WeeklySchedule)`
- [X] T063 [P] [US3] Implement `backend/src/modules/schedule/schedule.schemas.ts`: `DayNameSchema` (`z.enum(DAYS)`), `TimeSchema` (`z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be a time in HH:mm format (00:00-23:59)")`), `ServicePeriodSchema` strict `{ name: z.string().trim().min(1).max(50), start: TimeSchema, end: TimeSchema }`, `DayScheduleSchema` strict `{ day, periods: ServicePeriodSchema[] }`, `WeeklyScheduleSchema` strict `{ days: DayScheduleSchema[] }` with the contract example (Monday empty, Tuesday Lunch 12:00–15:00 + Dinner 20:00–23:30); register `.openapi()` names
- [X] T064 [US3] Implement `backend/src/modules/schedule/schedule.service.ts`: `getSchedule()` — `findById("weekly").lean()`; if null return 7 empty days (no write); else return stored days in Monday-first order; `replaceSchedule(input)` — run `validateWeeklySchedule`; on `ok: false` throw `validationError(errors)` **before** touching storage; else `findOneAndUpdate({ _id: "weekly" }, { $set: { days: value.days } }, { upsert: true, new: true })` and return the normalized schedule
- [X] T065 [US3] Implement `backend/src/modules/schedule/schedule.controller.ts` (handlers `get`, `replace`) and `backend/src/modules/schedule/schedule.routes.ts`: `registerScheduleRoutes(ctx)` with `GET /schedule` (auth, tag `Schedule`, 200 `WeeklyScheduleSchema`, errors `[]`) and `PUT /schedule` (auth, body `WeeklyScheduleSchema` + example, 200 normalized `WeeklyScheduleSchema`, errors `["VALIDATION_ERROR"]`); descriptions state restaurant-local times, no midnight crossing, omitted days closed, whole-replacement semantics
- [X] T066 [US3] Wire `registerScheduleRoutes(ctx)` into `backend/src/app.ts`; ensure `WeeklySchedule` is registered for `initModels()`
- [X] T067 [US3] Run `npm test` and confirm T058–T059 PASS (GREEN) plus all earlier tests; `npm run typecheck && npm run lint` clean

**Checkpoint**: US1–US3 work independently.

---

## Phase 6: User Story 4 - Mark specific dates as closed (Priority: P3)

**Goal**: Staff add closed calendar dates (with optional reason), list upcoming ones (optionally
past too), and remove a closure by its date. "Today" is decided in `RESTAURANT_TIME_ZONE`.

**Independent Test**: Sign in, add 2026-12-25 "Christmas", list, add it again (409), remove it (204),
remove again (404).

### Tests for User Story 4 (write first, must FAIL) ⚠️

- [X] T068 [P] [US4] Write `backend/tests/unit/closed-dates.domain.test.ts`: `isValidCalendarDate` accepts `"2026-12-25"`, `"2028-02-29"`, `"2000-02-29"`; refuses `"2026-02-30"`, `"2026-02-29"`, `"1900-02-29"`, `"2026-13-01"`, `"2026-00-10"`, `"2026-04-31"`, `"2026-1-5"`, `"26-12-25"`, `"2026/12/25"`, `""`; `todayInTimeZone("Pacific/Kiritimati", new Date("2026-11-06T23:30:00Z"))` → `"2026-11-07"`; `todayInTimeZone("Pacific/Pago_Pago", new Date("2026-11-07T05:00:00Z"))` → `"2026-11-06"`; `todayInTimeZone("UTC", ...)` → UTC date
- [X] T069 [US4] Write `backend/tests/integration/closed-dates.test.ts` (authenticated; fixed clock `2026-11-06T12:00:00Z`, zone `UTC` unless stated) covering:
  - US4 #1: `POST { date: "2026-12-25", reason: "Christmas" }` → 201 `{ date: "2026-12-25", reason: "Christmas" }`, no `Location` header, no `id`/`_id` in body
  - Reason handling: absent, `null`, `""`, `"   "` → `reason: null`; `"  Private event "` → `"Private event"`; 201-char reason after trim → 400 field `reason`
  - US4 #2: add `2026-12-31`, `2026-11-20`, `2026-11-06` (today) → `GET /closed-dates` returns them ascending; a past closure (inserted directly into the DB) is excluded by default and included with `?includePast=true`; `?includePast=false` same as default
  - Query validation: `includePast=TRUE`, `=1`, `=yes`, empty value, repeated parameter, and unknown parameter `?foo=1` → `400` with field `query.includePast` / `query.foo`
  - US4 #3: re-adding `2026-12-25` → `409 CONFLICT`; concurrent double-add via `Promise.all` → one 201, one 409
  - US4 #4: `2026-02-30` → 400 field `date`; `2026-11-05` (yesterday) → 400 field `date`; `2026-1-5` → 400; today accepted; re-adding a **past** date that is already closed → 400 (not 409, check order)
  - Time-zone boundary: app with `timeZone: "Pacific/Kiritimati"` and clock `2026-11-06T23:30:00Z` (restaurant date 2026-11-07) → `2026-11-07` accepted, `2026-11-06` refused 400 although UTC says it is today; app with `timeZone: "Pacific/Pago_Pago"` and clock `2026-11-07T05:00:00Z` (restaurant date 2026-11-06) → `2026-11-06` accepted although UTC says it is yesterday; default list filtering uses the restaurant date
  - US4 #5: `DELETE /closed-dates/2026-12-25` → 204 empty; no longer listed; again → `404 NOT_FOUND`; `DELETE /closed-dates/2026%2D12%2D25` works as the decoded date; `DELETE /closed-dates/2026-02-30` and `/closed-dates/abc` → 400 field `params.date`; a past closure can be deleted
  - A date falling on a weekday closed in the weekly schedule is accepted
- [X] T070 [US4] Run `npm test -- tests/unit/closed-dates.domain.test.ts tests/integration/closed-dates.test.ts` and confirm FAIL — record RED

### Implementation for User Story 4

- [X] T071 [P] [US4] Implement `backend/src/modules/closed-dates/closed-dates.domain.ts`: `DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/`; pure `isValidCalendarDate(s)` (format + month 1–12 + day 1..daysInMonth with Gregorian leap rule: divisible by 4 and (not by 100 or by 400); no `Date` parsing); `todayInTimeZone(timeZone, now)` via `Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)` assembled as `YYYY-MM-DD`
- [X] T072 [P] [US4] Implement `backend/src/modules/closed-dates/closed-date.model.ts`: model `ClosedDate` (collection `closeddates`) with `date` (string `"YYYY-MM-DD"`, required, **unique index**), `reason` ("Optional; trimmed; ≤ 200 chars; empty → `null`", type String, default `null`), `timestamps: true`; `registerModel(ClosedDate)`
- [X] T073 [P] [US4] Implement `backend/src/modules/closed-dates/closed-dates.schemas.ts`: `CalendarDateSchema` = `z.string().refine(isValidCalendarDate, "Must be a real calendar date in YYYY-MM-DD format")`; `CreateClosedDateSchema` strict `{ date: CalendarDateSchema, reason: z.string().trim().max(200).nullable().optional().transform(r => r ? r : null) }` with example `{ "date": "2026-12-25", "reason": "Christmas" }`; `ListClosedDatesQuerySchema` strict `{ includePast: z.enum(["true","false"]).default("false") }` (a repeated parameter arrives as an array and fails the enum); `ClosedDateParamsSchema` `{ date: CalendarDateSchema }`; `ClosedDateSchema` `{ date, reason: string | null }`; register `.openapi()` names
- [X] T074 [US4] Implement `backend/src/modules/closed-dates/closed-dates.service.ts`: `createClosedDate({ date, reason }, { config, clock })` — if `date < todayInTimeZone(config.RESTAURANT_TIME_ZONE, clock.now())` throw `validationError([{ field: "date", reason: "Date must be today or later" }])` (stage 2, before any write); insert; catch `11000` → `conflict("This date is already closed")`; `listClosedDates({ includePast })` — filter `{ date: { $gte: today } }` unless `includePast === "true"`, sort `{ date: 1 }`, project `{ date, reason }`; `removeClosedDate(date)` — `deleteOne({ date })`, `deletedCount === 0` → `notFound("Closed date not found")`
- [X] T075 [US4] Implement `backend/src/modules/closed-dates/closed-dates.controller.ts` (handlers `create`, `list`, `remove`) and `backend/src/modules/closed-dates/closed-dates.routes.ts`: `registerClosedDateRoutes(ctx)` with `POST /closed-dates` (auth, tag `Closed dates`, body + example, 201 `ClosedDateSchema`, errors `["VALIDATION_ERROR","CONFLICT"]`), `GET /closed-dates` (query schema, 200 `ClosedDateSchema[]`, errors `["VALIDATION_ERROR"]`), `DELETE /closed-dates/:date` (params schema, 204, errors `["VALIDATION_ERROR","NOT_FOUND"]`); descriptions state that dates are restaurant-local and "today" is decided by the server
- [X] T076 [US4] Wire `registerClosedDateRoutes(ctx)` into `backend/src/app.ts`; ensure `ClosedDate` is registered for `initModels()`
- [X] T077 [US4] Run `npm test` and confirm T068–T069 PASS (GREEN) plus all earlier tests; `npm run typecheck && npm run lint` clean

**Checkpoint**: All four functional stories work independently.

---

## Phase 7: User Story 5 - Discoverable, consistent API (Priority: P3)

**Goal**: Every operation is in the generated OpenAPI document with complete descriptions,
examples and error responses; Swagger UI can sign in and call protected operations; every error
uses the standard shape. Depends on US1–US4 (it verifies their routes).

**Independent Test**: Open `/docs`, confirm every operation is listed, sign in, Authorize, and call a
protected operation from the UI.

### Tests for User Story 5 (write first, must FAIL where not yet satisfied) ⚠️

- [ ] T078 [P] [US5] Write `backend/tests/contract/auth-coverage.test.ts` (SC-002): fetch `GET /openapi.json`; for every operation with `security`, substitute path params with valid dummies (`{id}` → `"0123456789abcdef01234567"`, `{date}` → `"2026-12-25"`) and call it without a token, and for POST/PUT/PATCH also without a token with (a) a schema-invalid JSON body, (b) malformed JSON, (c) a body over 100 kB and (d) `Content-Type: text/plain` → every case `expectError(401, "AUTHENTICATION_REQUIRED")`; assert the set of operations **without** `security` is exactly `{ "GET /health", "POST /auth/login", "GET /openapi.json" }`; assert `GET /docs/` is 200 without a token; assert `components.securitySchemes.bearerAuth` equals `{ type: "http", scheme: "bearer", bearerFormat: "JWT" }`
- [ ] T079 [P] [US5] Write `backend/tests/contract/error-shape.test.ts` (SC-003): one request per case, each through `expectError`: validation error (`POST /tables { capacity: 0 }`, details non-empty with `field`), malformed JSON, non-JSON body (`text/plain`), oversized body (>100 kB), unknown field, missing proof, invalid credentials, unknown operation (`GET /nope`, no token), unknown table id, conflict (duplicate table), service unavailable (`buildTestApp({ isDatabaseUp: () => false })`, `GET /health`), and forced unexpected failure (`buildTestApp({ configureTestRoutes: ctx => ctx.router.get("/__boom", () => { throw new Error("secret driver message at /src/x.ts") }) })`) → `500 INTERNAL_ERROR`, message `"An unexpected error occurred"`, no `details`, and the serialized body contains neither `"secret"`, `"Error"` stack text nor `"/src/"`
- [ ] T080 [P] [US5] Write `backend/tests/contract/openapi-coverage.test.ts` (SC-004, FR-025): walk `app.router.stack` (Express 5) collecting `METHOD path` (convert `:param` → `{param}`; skip the `/docs` static mount); assert the set equals the document's operations (both directions) and totals **14** operations; for each operation assert: `summary` and `description` non-empty; exactly one tag from `Health`, `Auth`, `Tables`, `Schedule`, `Closed dates`, `Documentation`; a 2xx response with a description (and a JSON schema unless 204); a `500` response; a `401` response on every secured operation; every non-2xx response references `#/components/schemas/ErrorResponse`; every `requestBody` has `content["application/json"].example` (or `examples`); and the error statuses per operation exactly match the table in contracts/api.md (e.g. `DELETE /tables/{id}` → `{401, 404, 500}`, no 409; `POST /closed-dates` → `{400, 401, 409, 500}`); and at document level (satisfied only by T083, so this file is genuinely RED): `servers` equals `[{ url: "/" }]`, and `info.description` is non-empty and mentions both the sign-in → Authorize flow (`/auth/login`, `Authorize`) and the error shape (`error.code`)
- [ ] T081 [US5] Run `npm test -- tests/contract` and record RED. T080 MUST fail (document-level assertions above). T078 and T079 verify behavior already delivered by US1–US4 and may pass as written: for each of them, prove the test can fail with a **temporary mutation check** (plan.md "Complexity Tracking"): T078 — temporarily mount one secured route with `auth: false` and confirm the test fails; T079 — temporarily make the error middleware include `err.message` in `details` and confirm the test fails; record both failures, then revert the mutations (`git diff` clean for `src/`)

### Implementation for User Story 5

- [ ] T082 [US5] Documentation review in `backend/src/modules/*/**.routes.ts` and `backend/src/shared/openapi/document.ts`: for each of the 14 operations, compare with contracts/api.md operation by operation and complete `summary`, `description` (including FR-011 note on `DELETE /tables/{id}`, restaurant-local time notes, `includePast` semantics), tags, request examples, and error-response descriptions naming the possible `code` values; fix any status/code mismatch in either the code or contracts/api.md (contract wins unless it is the defect)
- [ ] T083 [US5] Verify `backend/src/shared/openapi/document.ts` Swagger UI options (`persistAuthorization: true`, `tryItOutEnabled: true`, `url: "/openapi.json"`) and that the document `info.description` explains the sign-in → Authorize flow and the error model; add `servers: [{ url: "/" }]`
- [ ] T084 [US5] Run `npm test` and confirm T078–T080 PASS (GREEN) plus all earlier tests

**Checkpoint**: All user stories are independently functional and the API contract is verified.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final quality gates across all stories.

- T085 — *Removed.* Its precedence cases are now written test-first inside the stories: unknown routes with bad bodies in T028; pipeline order in T029a; no token + bad body on every secured operation in T078; `POST /tables` body errors and duplicate-with-invalid-capacity in T050; `PUT /schedule` body errors in T059; past date already closed in T069. The ID is kept unused so other references stay stable.
- [ ] T086 [P] Write `backend/tests/integration/performance.test.ts` (SC-006 smoke): seed 100 tables, one schedule and 500 closed dates; for each management GET (`/tables`, `/schedule`, `/closed-dates?includePast=true`) and one representative write per resource, run 10 rounds of 10 concurrent requests (≥ 100 samples per operation); compute p95 per operation with the threshold read from one constant `P95_LIMIT_MS = 1000`. RED by mutation check (plan.md "Complexity Tracking"): first run with `P95_LIMIT_MS = 0` and confirm it fails for every operation (proves the measurement and assertion work), record RED; restore `1000` and confirm it passes (GREEN)
- [ ] T087 Complete `backend/README.md`: setup (`npm install`, `cp .env.example .env`), every script, configuration table (each env key, required/optional, default, rule), seeding with `npm run seed:staff` (idempotent, normalized email), testing (mongodb-memory-server downloads `mongod` on first run), docs URLs, and a **Known debt** section: no sign-in rate limiting/lockout; no server-side token revocation (sign-out = client discards token); no token refresh
- [ ] T088 [P] Reconcile `specs/001-restaurant-setup/contracts/api.md` with the generated `/openapi.json` (save a copy with `curl localhost:3000/openapi.json`) and fix any drift in the same change
- [ ] T089 Run quickstart.md validation scenarios 2–5 manually against a local MongoDB: fail-fast config (`RESTAURANT_TIME_ZONE=Mars/Olympus` and a short `JWT_SECRET` → non-zero exit listing the key, nothing listening), seed twice (second run is a no-op), `/health` up and 503 with MongoDB stopped, the full `/docs` walkthrough (SC-001, under 10 minutes), and the curl auth edge checks
- [ ] T090 Final gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all succeed in `backend/`; confirm no secrets are committed (`git grep -n "JWT_SECRET="` shows only `.env.example`) and all code, comments and docs are in English

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; **blocks all user stories**.
- **US1 (Phase 3)**: depends on Foundational. Replaces the fail-closed `requireAuth` placeholder.
- **US2, US3, US4 (Phases 4–6)**: depend on Foundational **and US1** (their integration tests
  sign in with `seedStaff` + `loginAs`, and protected routes need the real `requireAuth`). Once
  US1 is done they are independent of each other and can run in parallel; the only shared file
  is `backend/src/app.ts` (one `register…Routes(ctx)` line each — merge carefully).
- **US5 (Phase 7)**: depends on US1–US4 (verifies every route).
- **Polish (Phase 8)**: depends on US5.

### User Story Dependencies

```text
Setup → Foundational → US1 ─┬─▶ US2 ─┐
                            ├─▶ US3 ─┼─▶ US5 → Polish
                            └─▶ US4 ─┘
```

### Within Each User Story

- Tests written first → run and observed **RED** → implementation → **GREEN** → refactor.
- Models and pure domain functions before services; services before routes; routes before wiring
  into `app.ts`.
- A story is done only when all its tests pass (Constitution Principle II).

### Parallel Opportunities

- Setup: T003–T007 in parallel after T002.
- Foundational: T010–T013a in parallel; T015–T019 and T021 in parallel; T028, T029 and T029a in parallel.
- US1: T035, T036 and T038 in parallel (T037 after T036 helpers); T040–T043 in parallel.
- US2: T052–T053 in parallel.
- US3: T058 with T059 drafting; T061–T063 in parallel.
- US4: T068 with T069 drafting; T071–T073 in parallel.
- US2, US3 and US4 as whole phases in parallel after US1.
- US5: T078–T080 in parallel.
- Polish: T086 and T088 in parallel.

---

## Parallel Example: User Story 3

```bash
# Tests first (different files):
Task: "Write backend/tests/unit/schedule.domain.test.ts"
Task: "Write backend/tests/integration/schedule.test.ts"

# After RED, the independent building blocks:
Task: "Implement backend/src/modules/schedule/schedule.domain.ts"
Task: "Implement backend/src/modules/schedule/schedule.model.ts"
Task: "Implement backend/src/modules/schedule/schedule.schemas.ts"
```

## Parallel Example: Stories 2–4 after US1

```bash
Developer A: Phase 4 (US2 tables)        T050–T057
Developer B: Phase 5 (US3 schedule)      T058–T067
Developer C: Phase 6 (US4 closed dates)  T068–T077
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup.
2. Phase 2: Foundational (blocks everything).
3. Phase 3: US1 — sign-in, `/auth/me`, real `requireAuth`, seed script.
4. **STOP and VALIDATE**: seed a staff account, sign in via `/docs`, call `/auth/me`.

### Incremental Delivery

1. Setup + Foundational → health, docs, error model ready.
2. + US1 → authenticated access (MVP).
3. + US2 → tables (both P1 stories done).
4. + US3 → weekly schedule.
5. + US4 → closed dates.
6. + US5 → contract suites prove SC-002/003/004.
7. Polish → README, quickstart validation, final gates.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- Commit after each GREEN step (or logical group), in English.
- Never skip the RED step: it is a constitution gate, not a formality.
- `backend/src/app.ts` is edited by T032, T047, T056, T066, T076 — sequential edits, one line each.
