# Implementation Plan: Staff Access and Restaurant Setup

**Branch**: `001-restaurant-setup` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-restaurant-setup/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Backend foundation for a single-restaurant table reservation system: staff sign-in with JWT,
CRUD for tables with soft delete, a weekly schedule of service periods replaced as a whole,
closed calendar dates, and a consistent error model with interactive OpenAPI documentation.
The stack is Express 5 + Mongoose + Zod in strict TypeScript. One `defineRoute()` helper
registers each operation in the OpenAPI registry and mounts it with authentication and Zod
validation, so validation and docs share a single source. Uniqueness (staff email, active
table name, closed date) is enforced by MongoDB unique indexes, one of them partial, and
duplicate-key errors map to `CONFLICT`. Restaurant-local values (`HH:mm`, `YYYY-MM-DD`) are
stored as text and interpreted in `RESTAURANT_TIME_ZONE` using `Intl`. Development is
test-first with Vitest, Supertest and mongodb-memory-server.

## Technical Context

**Language/Version**: TypeScript ~6.0.3 (strict, ESM, `nodenext`) on Node.js 24 LTS (min 22.12). TS 7 is not used because typescript-eslint does not support it yet ([research R1](./research.md#r1-runtime-and-language-versions)).

**Primary Dependencies**: express ^5.3, mongoose ^9.12, zod ^4.6, @asteasolutions/zod-to-openapi ^9.1 (peer `zod ^4.0.0`, verified), swagger-ui-express ^5.0, jose ^6.2, cors ^2.8. Justification table below.

**Storage**: MongoDB via Mongoose. Collections: `staffmembers`, `tables`, `weeklyschedules` (single doc `_id: "weekly"`), `closeddates`.

**Testing**: Vitest ^5.1 + Supertest ^7.3 + mongodb-memory-server ^11.3, with unit (pure domain), integration (per user story) and contract (cross-cutting SC-002/003/004) suites.

**Target Platform**: Linux/Windows/macOS server, Node 24 LTS. HTTP JSON API, no UI.

**Project Type**: Web service (backend of a monorepo; `frontend/` arrives in a later feature).

**Performance Goals**: Every management operation responds in under 1 s under normal load (SC-006). Trivial for this data volume (tens of tables, one schedule doc, a few hundred closed dates).

**Constraints**: Fail-fast configuration; no secrets in the repo; a refused request leaves data unchanged (FR-024); concurrency-safe uniqueness through indexes; restaurant-local values never converted to UTC; minimal dependencies.

**Scale/Scope**: One restaurant, a handful of staff accounts, 15 HTTP operations (13 API + `/openapi.json` + `/docs`), 5 user stories.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Requirement | How this plan complies | Status |
|---|---|---|---|
| I. Monorepo, contract-first | `backend/` + `frontend/` at root, shared `specs/`; OpenAPI generated from Zod, served at `/docs` | All code under `backend/`; `frontend/` can be added later without moving anything. `defineRoute()` registers Zod schemas with zod-to-openapi; `/openapi.json` + `/docs`. | ✅ |
| II. Test-first (NON-NEGOTIABLE) | Vitest + Supertest, failing first; mongodb-memory-server; external effects mocked | Each story's tasks start with failing tests (unit → integration), run and seen red before implementation; foundational pipeline and error middleware get their own failing tests first. `globalSetup` starts mongodb-memory-server. No external side effects in this feature (no email). Verification-only contract/performance tests use a mutation check to be seen failing (documented deviation, see Complexity Tracking). | ✅ (1 justified deviation) |
| III. Integrity at DB level; time rules | DB-level invariants; instants UTC; local values as text in IANA zone | Unique indexes (one partial) + `11000 → CONFLICT`, no read-then-write. Schedule replaced with one atomic upsert. `HH:mm` and `YYYY-MM-DD` stored as text; "today" via `Intl` in `RESTAURANT_TIME_ZONE`; timestamps/`removedAt`/`expiresAt` UTC. The reservation-overlap invariant does not apply yet (no reservations). | ✅ |
| IV. HTTP semantics, error shape, Zod first | Correct status codes; `{ error: { code, message, details? } }`; Zod before domain | 201/200/204/400/401/404/409/500/503 per [contract](./contracts/api.md). One error middleware + 404 fallback. Validation step runs before every handler; `.strict()` schemas. | ✅ |
| V. Simplicity, minimal deps | Justify each dependency; MongoDB only external runtime dep; YAGNI | Justification table below; `node:crypto` scrypt, `Intl`, `--env-file` replace bcrypt/date-libs/dotenv. No restaurant entity, roles, or rate limiting (out of scope, documented as debt). | ✅ |
| Stack & constraints | TS/Node/Express, Zod env, Mongoose, JWT on staff endpoints only, CORS via env, no secrets | All present; `.env.example` with placeholders; `CORS_ORIGINS`. Every endpoint in this feature is staff-only except health/login/docs. | ✅ |
| Workflow | Spec Kit flow; English everywhere | spec → plan (this) → tasks → implement; all artifacts and code in English. | ✅ |

**Gate result (pre-research)**: PASS, no violations.
**Gate result (post-design re-check)**: PASS. The design adds one error code,
`SERVICE_UNAVAILABLE` (503), used only by `/health` when the DB is down. This *applies*
Principle IV (correct status + standard shape) rather than deviating from it; see
[research R9](./research.md#r9-error-model-and-mapping).
**Gate result (post-analysis re-check)**: PASS with one justified Principle II deviation
(verification-only suites proven red by mutation), recorded in Complexity Tracking.

### Dependency justification (Principle V)

| Package | Used for | Why the standard library is not enough |
|---|---|---|
| `express` | HTTP routing, middleware, JSON body parsing | Mandated stack; `node:http` has no routing or middleware chain. Express 5 forwards async errors natively. |
| `mongoose` | Schemas, indexes, queries on MongoDB | Mandated stack; the raw driver would need hand-rolled schema and index management. |
| `zod` | Request + env validation, single schema source | Mandated stack; no schema validation in the standard library. |
| `@asteasolutions/zod-to-openapi` | Generate OpenAPI from Zod | Principle I requires generated docs; hand-writing would drift. v9 supports Zod 4. |
| `swagger-ui-express` | Interactive docs at `/docs` | FR-025; writing a docs UI is out of scope. |
| `jose` | HS256 JWT sign/verify | Security-sensitive; zero-dependency, typed; supports an injected clock for expiry tests. |
| `cors` | CORS for configured origins | Correct preflight handling is error-prone to write by hand; tiny. |
| *dev* `typescript`, `tsx` | Compile/typecheck; run TS (dev, seed) | Constitution language; tsx gives one runner for dev server and scripts. |
| *dev* `vitest`, `supertest`, `mongodb-memory-server` | Tests | Mandated by Principle II. |
| *dev* `eslint`, `typescript-eslint`, `@types/*` | Lint, types | ESLint cannot parse TS alone; packages without bundled types need `@types`. |

Rejected on purpose: `dotenv`, `bcrypt`/`argon2`, `jsonwebtoken`, any date library, `helmet`,
`express-rate-limit`. Details in [research R15](./research.md#r15-dependency-justification-principle-v).

## Project Structure

### Documentation (this feature)

```text
specs/001-restaurant-setup/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R15
├── data-model.md        # Phase 1: entities, indexes, pure functions
├── quickstart.md        # Phase 1: run & validation guide
├── contracts/
│   └── api.md           # Phase 1: HTTP contract (runtime source: generated /openapi.json)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
backend/
├── package.json             # "type": "module"; scripts: dev, build, start, test, typecheck, lint, seed:staff
├── tsconfig.json            # strict, nodenext, outDir dist
├── eslint.config.js         # flat config + typescript-eslint
├── vitest.config.ts         # globalSetup, test env
├── .env.example             # placeholders only
├── README.md                # run instructions + known debt (no rate limiting, no revocation)
├── src/
│   ├── app.ts               # createApp({ config, clock }): Express app, no listen
│   ├── server.ts            # loadConfig → connect → Model.init() → listen; graceful shutdown
│   ├── config/
│   │   └── env.ts           # Zod env schema, loadConfig(), parseDuration()
│   ├── db/
│   │   └── connection.ts    # connect/disconnect, isDatabaseUp(), initModels()
│   ├── shared/
│   │   ├── errors/          # AppError, codes→status table, error middleware, notFound middleware
│   │   ├── middleware/      # requireAuth (bearer → jose → res.locals.staff)
│   │   ├── openapi/         # zod.ts (extendZodWithOpenApi), registry.ts, route.ts (defineRoute), document.ts, common schemas (ErrorResponse)
│   │   ├── validation/      # normalize.ts, zodIssuesToDetails(), validate step
│   │   └── clock.ts         # Clock interface + systemClock
│   └── modules/
│       ├── health/          # health.routes.ts
│       ├── auth/            # auth.routes.ts, auth.schemas.ts, auth.service.ts, staff.model.ts, password.ts, token.ts, provision-staff.ts
│       ├── tables/          # tables.routes.ts, tables.schemas.ts, tables.service.ts, table.model.ts
│       ├── schedule/        # schedule.routes.ts, schedule.schemas.ts, schedule.service.ts, schedule.model.ts, schedule.domain.ts
│       └── closed-dates/    # closed-dates.routes.ts, .schemas.ts, .service.ts, closed-date.model.ts, closed-dates.domain.ts
├── scripts/
│   └── seed-staff.ts        # thin CLI over modules/auth/provision-staff.ts (tested); idempotent; normalizes email
└── tests/
    ├── setup/               # global-setup.ts (MongoMemoryServer), db.ts (per-file DB, clear between tests)
    ├── helpers/             # buildTestApp, seedStaff, loginAs, expectError
    ├── unit/                # normalize, env, zod-issues, password, schedule.domain, closed-dates.domain
    ├── integration/         # health, cors, validation-pipeline, auth + provision-staff (US1), tables (US2), schedule (US3), closed-dates (US4), performance
    └── contract/            # auth-coverage (SC-002), error-shape (SC-003), openapi-coverage (SC-004)
```

**Structure Decision**: Web-service layout inside the monorepo's `backend/`, organized by
feature module (routes, schemas, service, model, and domain where there is pure logic), with
cross-cutting code in `src/shared/`. `src/app.ts` exports a factory with injectable `config`
and `clock`, so tests build isolated apps (different time zones, pinned "now") without a
network listener. `frontend/` is not created in this feature.

## Key Design Decisions

Full rationale in [research.md](./research.md).

1. **One route definition → validation + docs** (R8). `defineRoute({ method, path, auth,
   request, responses, errors, handler })` registers in the `OpenAPIRegistry` and mounts the
   Express handler as `requireAuth` (if `auth`) → `jsonBody()` (only if the route has a body
   schema: Content-Type check + `express.json({ limit: "100kb" })`) → Zod validation →
   handler. Parsed input goes to `res.locals.input`. There is **no global body parser**: a
   malformed, oversized or non-JSON body is only read after the route has matched and the
   caller is authenticated, so the refusal order route match (404) → authentication (401) →
   validation (400) holds for body errors too.
2. **Errors** (R9). `AppError` + code→status table; middleware maps `ZodError`, malformed JSON
   (`entity.parse.failed`), oversized body, stray Mongo `11000`, and unknown errors (logged
   server-side; the client gets a generic `INTERNAL_ERROR`). `details: [{ field, reason }]`.
   Final 404 middleware.
3. **Auth** (R3, R4, R10). jose HS256, claims `sub` + `exp`. scrypt with a per-user salt and
   `timingSafeEqual`; an unknown email still runs a dummy verify. A token for a deleted staff
   member is refused. Staff provisioning (FR-006) lives in `modules/auth/provision-staff.ts`
   (`parseProvisionEnv` + `provisionStaff`, create-and-catch-`11000` for idempotency) and is
   covered by integration tests; `scripts/seed-staff.ts` is only a CLI wrapper (connect,
   call, print, exit code), so no untested logic exists (Principle II).
4. **Tables** (R7, R12). `nameKey` + partial unique index; insert or update, and catch
   `11000`. Self-rename is safe. Soft delete via a conditional `findOneAndUpdate`. List uses a
   numeric-aware collation.
5. **Schedule** (R11). The array request detects repeated days; the pure
   `validateWeeklySchedule` checks cross-item rules on minutes; a single `findOneAndUpdate`
   upsert runs only after validation; GET on a missing document returns 7 empty days.
6. **Closed dates** (R6, R13). Pure `isValidCalendarDate` + `todayInTimeZone` (Intl,
   `en-CA`); text comparison for past/future; `includePast` as an enum string; delete by date.
7. **Config** (R5). Zod schema; `--env-file-if-exists`; exit 1 listing every invalid key.

## Testing Strategy

- **Order per story**: write unit tests for that story's pure functions, then integration
  tests for every acceptance scenario, then run them and confirm they fail (Red); implement
  (Green); refactor.
- **Foundational code is test-first too**: `zodIssuesToDetails` has its own unit test, and the
  request pipeline (`jsonBody`, validation step, `defineRoute` order) plus the error
  middleware (malformed/oversized/non-JSON body, unknown fields, `11000` safety net,
  sanitized `INTERNAL_ERROR`) are covered by a `validation-pipeline` integration test that
  mounts test-only routes through `createApp({ configureTestRoutes })`. Both are seen failing
  before Phase 2 implementation.
- **Refusal order is tested where it is built**: there is no separate after-the-fact
  check-order suite; each precedence case lives in the story or contract test that first
  exercises it.
- **Verification-only tests** (SC-002 auth coverage, SC-003 error shape, SC-006 performance)
  check behavior that earlier stories already delivered, so they may pass as soon as they are
  written. Each is proven able to fail with a temporary mutation check before it counts as
  GREEN (see Complexity Tracking). The SC-004 coverage test includes document-level
  assertions that only the US5 documentation work satisfies, so it is genuinely red first.
- **Required special cases**:
  - Concurrent `POST /tables` ×2 with the same name (`Promise.all`): exactly one 201, one 409,
    one document.
  - Refused `PUT /schedule` (overlap) after a valid one: the following `GET` equals the earlier
    schedule.
  - Soft-delete `T1`, then create `T1`: 201; `GET` of the old id returns 404.
  - Closed-date "today" boundary with a non-UTC zone: the pinned clock puts the restaurant's
    date one day ahead of (and, in another test, one day behind) the UTC date. Restaurant-today
    is accepted and restaurant-yesterday is refused, even when UTC says otherwise.
  - Expired token: sign with a clock in the past, or verify with a clock after `exp` → 401.
  - Tampered token (flip a signature char), `alg: none` token, and a token signed with another
    secret → 401.
  - Body errors respect the refusal order: malformed JSON / oversized / `text/plain` body on an
    unknown route → 404; on a protected route without a token → 401; with a valid token → 400.
  - Provisioning: second run with the same (differently cased) email is a no-op; two concurrent
    runs create exactly one account; every invalid env key is reported at once.
- **Contract suites**: see [research R14](./research.md#r14-testing-harness). `expectError()`
  validates the error body schema in every negative test.

## Phase Ordering (input for `/speckit-tasks`)

1. **Setup**: `backend/` package, tsconfig, eslint, vitest config, `.env.example`, README
   skeleton.
2. **Foundational (blocks all stories)**: `config/env.ts` (+ unit tests), `db/connection.ts`,
   `shared/clock.ts`, error model + middleware + 404, validation helpers (`normalize`, Zod
   issues → details), OpenAPI scaffolding (`zod.ts`, registry, `defineRoute`, document,
   `/openapi.json`, `/docs`, `bearerAuth` scheme), `app.ts` factory, `server.ts`, health
   module, test harness (global setup, per-file DB, helpers). Tests first: `normalize`, `env`,
   `zod-issues` (unit), then `health`, `cors`, `validation-pipeline` (integration).
3. **US1 Auth (P1)**: password + token + `requireAuth`, staff model, login, `/auth/me`,
   provisioning module (test-first) + seed CLI wrapper.
4. **US2 Tables (P1)**: model + partial index, service, routes, concurrency and reuse tests.
5. **US3 Schedule (P2)**: domain validator (unit-heavy), model, service upsert, routes.
6. **US4 Closed dates (P3)**: domain (calendar + today), model, service, routes, time-zone
   boundary tests.
7. **US5 API quality (P3)**: contract tests SC-002/003/004 and a documentation review
   (summaries, examples, all error responses), README completion with the known-debt section.

## Complexity Tracking

| Deviation | Principle | Why it is needed | Simpler alternative rejected because | Mitigation |
|---|---|---|---|---|
| The verification-only tests `tests/contract/auth-coverage.test.ts` (SC-002), `tests/contract/error-shape.test.ts` (SC-003) and `tests/integration/performance.test.ts` (SC-006) may pass as soon as they are written, because the behavior they check was already built test-first in US1–US4. | II. Test-First: "observed failing before the implementation is written" | These suites check cross-cutting properties over the finished set of operations (every secured route, every error case, latency across all resources), so they can only be written once those operations exist. | Writing them earlier would mean listing operations that do not exist yet; leaving them out would drop SC-002/003/006 verification. Adding an implementation step just to make them fail first would be artificial. | Each suite must be **seen failing** through a recorded, temporary mutation before it counts as GREEN: a secured route mounted with `auth: false` (SC-002); the error middleware leaking `err.message` in `details` (SC-003); `P95_LIMIT_MS = 0` (SC-006). The mutation is then reverted (`git diff` clean for `src/`). Every other test in the feature follows Red → Green strictly, including the foundational pipeline. |
