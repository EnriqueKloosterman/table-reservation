# Implementation Plan: Customer Booking Interface

**Branch**: `005-customer-booking-ui` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-customer-booking-ui/spec.md`

## Summary

A frontend-only feature: a Vite + React + TypeScript (strict) single-page app in `frontend/` with
two destinations, the booking page (`/`) and the cancellation page (`/cancel#code=...`). It uses
exactly three public backend operations (`GET /availability/times`, `POST /reservations`,
`POST /reservations/cancel`) through an `ApiClient` interface over native `fetch`, with types
generated from the backend's `/openapi.json` and a check that fails when they drift. All
customer-facing text comes from one exhaustive message catalog typed on the generated enums.
Runtime dependencies are `react` and `react-dom` only (no router, no data/forms library, no CSS
framework). The backend is not modified.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict, `noUncheckedIndexedAccess`) on Node >= 22.12
(verified on the installed Node 22.16.0); React 19.3.1; Vite 8.3.8

**Primary Dependencies**: `react`, `react-dom` (runtime). Everything else is dev-only; see the
[dependency justification](#dependency-justification) table.

**Storage**: None. No `localStorage`, `sessionStorage`, IndexedDB or cookies; all state is in
memory (enforced by a lint rule and a test).

**Testing**: Vitest 5.1 + Testing Library + user-event + jest-dom on jsdom 27 (behavior);
Playwright + axe-core against `vite preview` with `page.route` mocking the network (layout,
keyboard, accessibility, unreachable server, time zones). No test needs the backend.

**Target Platform**: Current evergreen desktop and mobile browsers, 360 px wide and up.

**Project Type**: Web application, frontend half of the monorepo (`frontend/`, independent npm
project).

**Performance Goals**: New times (or the reason for none) shown within 2 s in normal conditions
(SC-002); unreachable server reported within 10 s (SC-009) via an 8 s request timeout and no
automatic retries.

**Constraints**: Only network call is to the backend; no web fonts, no third-party scripts, no
analytics; no horizontal scroll at 360 px; contrast >= 4.5:1; touch targets >= 44 px; respects
`prefers-reduced-motion`; secrets (`secretCode`, cancellation code) never rendered, stored, logged
or left in the URL.

**Scale/Scope**: 2 destinations, about 12 screens/states, 3 API operations, roughly 40 source
files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle / section | Verdict | How the plan complies |
|---|---|---|
| I. Monorepo, contract-first | PASS | `frontend/` at the root beside `backend/`; no import across them; `src/api/schema.d.ts` is generated from `/openapi.json`; `api:check` fails when out of date or backend unreachable. No root `package.json`, no workspaces. |
| II. Test-first | PASS | Vitest + Testing Library written first and seen RED per story (recorded in tasks); API layer replaced by a fake `ApiClient`; tests assert visible behavior. |
| III. Reservation integrity | N/A | Backend only. The UI shows restaurant-local values as returned and never computes dates or times. |
| IV. HTTP semantics | PASS | One catalog (`src/api/messages.ts`) exhaustive over generated enums (availability reasons, conflict reasons, error codes) so a new backend value fails compilation; runtime fallback to a generic message; no raw code, status, field path or server message reaches the screen. |
| V. Simplicity / minimal deps | PASS | 2 runtime deps; no router, data-fetching, forms, CSS or component library; each dev dependency justified below. Playwright is the one heavier dev tool, justified by SC-006/007/010. |
| Frontend: configuration | PASS | `VITE_API_BASE_URL` validated at startup; invalid shows "service not available" screen (FR-030); no secrets in the frontend. |
| Frontend: secrets in browser | PASS | Fragment read once, `history.replaceState`, memory only, no-referrer meta, no storage/log (guarded). |
| Frontend: accessibility / responsive / states | PASS | Landmarks, labels, live regions, focus management, axe in CI; 360 px checks; loading/empty/error/unreachable on every API screen. |
| Frontend: dates and times | PASS | Formatting from `YYYY-MM-DD` parts through `Intl` with `timeZone: "UTC"`; never `new Date(string)`; tested at every offset UTC-12..UTC+14 and in two browser time zones. |
| Frontend: language | PASS | English only, no switcher (FR-031). |

No violations; Complexity Tracking is empty. See [Spec alignment](#spec-alignment).

## Dependency justification

Constitution Principle V: every frontend dependency is justified. Versions were verified with
`npm view` and a full `npm install --dry-run` against Node 22.16.0 with no `--force` (see
[research.md](./research.md) R1).

| Package | Version | Kind | What it does / why the platform is not enough |
|---|---|---|---|
| `react`, `react-dom` | 19.3.1 | runtime | UI rendering. Required by the constitution (React). |
| `vite` | 8.3.8 | dev | Dev server, build, `vite preview` (target of Playwright). Required by the constitution. |
| `@vitejs/plugin-react` | 6.3.0 | dev | JSX transform / fast refresh for Vite 8. |
| `typescript` | 5.9.3 | dev | Strict typing. Pinned to 5.x because `openapi-typescript@7` peers `^5.x` (TS 6 would need `--force`). |
| `eslint`, `@eslint/js` | 9.39.5 | dev | Linting. Pinned to 9 because `eslint-plugin-jsx-a11y@6.10.2` peers up to ESLint 9. |
| `typescript-eslint` | 8.72.2 | dev | TS-aware lint rules. |
| `eslint-plugin-react-hooks` | 7.1.1 | dev | Catches hook misuse (stale effects are the main risk in the sequence guard). |
| `eslint-plugin-jsx-a11y` | 6.10.2 | dev | Static a11y checks (labels, roles) at lint time; complements axe. |
| `globals` | 17.14.0 | dev | Browser/node globals for the ESLint flat config. |
| `vitest` | 5.1.0 | dev | Test runner (constitution). Shares Vite config. |
| `jsdom` | 27.4.0 | dev | DOM for component tests. Newer 28/29/31 need a higher Node patch level (31 needs >= 22.22.2), so 27 is the newest verified on the installed Node. |
| `@testing-library/react`, `@testing-library/dom` | 16.3.3, 10.4.2 | dev | Render and query by role/label (user-visible behavior). `dom` is a required peer. |
| `@testing-library/user-event` | 14.6.10 | dev | Realistic typing, clicks, double Enter. |
| `@testing-library/jest-dom` | 7.0.1 | dev | Readable DOM matchers. |
| `openapi-typescript` | 7.13.0 | dev | Generates `schema.d.ts` from `/openapi.json` (constitution Principle I: types never hand-written). Hand-writing or a runtime codegen client is rejected. |
| `@playwright/test` | 1.65.0 | dev | Real-browser checks that jsdom cannot do: 360 px overflow (SC-006), contrast (SC-007), time zones via `timezoneId` (SC-010), keyboard flow, `vite preview`. |
| `@axe-core/playwright` | 4.14.0 | dev | Automated a11y audit, zero serious/critical (SC-007). Needs Node >= 22.12 (already required). |
| `@types/react`, `@types/react-dom` | 19.3.0 | dev | Types for React. |
| `@types/node` | 22.20.5 | dev | Types for config/scripts; matches the minimum Node major. |

Deliberately **not** added: a router (about 20 lines of History API instead), a data-fetching
library (one small hook with `AbortController`), a forms or validation library (three fields with
hand validators), a CSS framework or component library, a date library (`Intl` is enough), Prettier,
and any font or script from a CDN.

## Spec alignment

- **Date control `min`**: resolved. The spec (Edge Cases "Dates" and Assumptions) now states that the
  visitor's clock is used for no rule, the date control has no `min`/`max`, and only the date format is
  validated; the server's `too_soon` / `too_far_ahead` answers are the single authority and have their
  own messages. A past date typed or picked therefore gets the plain "too soon" message. No divergence
  remains between spec and plan.
- Everything else is as specified. The cancellation path is `/cancel` (the backend default
  `CANCEL_LINK_BASE_URL=http://localhost:5173/cancel`), so no backend configuration change is needed.

## Project Structure

### Documentation (this feature)

```text
specs/005-customer-booking-ui/
├── plan.md              # This file
├── research.md          # Phase 0: decisions, pinned versions, alternatives
├── data-model.md        # Phase 1: UI-side types and state machines
├── quickstart.md        # Phase 1: run and validate end to end
├── contracts/
│   ├── api-usage.md     # The three operations used and the outcome mapping
│   ├── messages.md      # Message catalog: every reason/code -> plain text and next step
│   └── ui-routes.md     # Destinations, URL/fragment rules, screens and states
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
frontend/
├── package.json              # own lockfile; engines.node ">=22.12"; no workspaces
├── package-lock.json
├── index.html                # <meta name="referrer" content="no-referrer">
├── vite.config.ts
├── vitest.config.ts          # jsdom, setup file, TZ handling
├── playwright.config.ts      # webServer: build + vite preview; Chromium only
├── tsconfig.json             # strict, noUncheckedIndexedAccess
├── eslint.config.js          # ts-eslint, react-hooks, jsx-a11y, no-console, storage ban
├── .env.example              # VITE_API_BASE_URL=http://localhost:3000
├── README.md
├── scripts/
│   └── api-types.mjs         # `api:types` and `api:check` (openapi-typescript Node API)
├── src/
│   ├── main.tsx              # calls bootstrap()
│   ├── bootstrap.ts          # config check, takeCodeFromFragment(), render
│   ├── App.tsx               # config gate, ApiClient provider, tiny router
│   ├── styles/               # tokens.css (custom properties), base.css, components.css
│   ├── config/env.ts         # validate VITE_API_BASE_URL -> { ok, apiBaseUrl } | { ok:false }
│   ├── api/
│   │   ├── schema.d.ts       # GENERATED, committed
│   │   ├── types.ts          # UI-facing result types (no secretCode, no table)
│   │   ├── client.ts         # createApiClient(baseUrl, fetchImpl, timeoutMs)
│   │   ├── context.tsx       # ApiClient React context + provider + hook
│   │   └── messages.ts       # the ONE message catalog (exhaustive)
│   ├── features/
│   │   ├── booking/          # BookingPage, DateAndParty, TimeChoices, DetailsForm,
│   │   │                     # Confirmation, useBookableTimes, useReservation, validators
│   │   ├── cancel/           # CancelPage, useCancellation, outcome views
│   │   └── unavailable/      # ServiceUnavailable screen (FR-030)
│   └── shared/
│       ├── dates.ts          # formatDate / formatTime from the string parts
│       ├── router.ts         # usePathname, navigate (History API + popstate)
│       ├── a11y/             # LiveRegion, useFocusOnChange
│       ├── ui/               # Button, Field, StatusMessage, Spinner, PageShell
│       └── request-state.ts  # loading | empty | error | unreachable | ready
├── tests/
│   ├── support/              # FakeApiClient, renderApp, deferred(), tz helpers
│   ├── unit/                 # dates, validators, messages, sequence guard, client, guards
│   └── component/            # booking, refusals, cancel, config screen
└── e2e/                      # Playwright: layout, keyboard, axe, unreachable, time zones
```

**Structure Decision**: Option 2 (web application) of the template, with the backend untouched. The
frontend is a separate npm project so the repo layout does not change and no root manifest is
needed. Feature folders mirror the spec's stories; `shared/` holds only what both pages use.

## Key Design Decisions (summary; reasoning in research.md)

1. **ApiClient behind an interface**, injected through context; the fake implements the same
   interface, so no test needs a server or a stubbed `fetch` outside the client's own unit tests.
2. **Result union** `success | refusal | serverError | unreachable`. Network, CORS and timeout
   failures are `unreachable`; 5xx/503 and unparsable bodies are `serverError`; typed 4xx are
   `refusal` with a typed code and details.
3. **`secretCode` stripped inside the client** by constructing the UI `Confirmation` object field by
   field (an allow-list, not a delete), so the key cannot leak by accident.
4. **Times hook with a sequence guard** (a monotonically increasing request id in a ref) plus
   `AbortController`; only the latest request may set state.
5. **Submit lock in a ref**, set before the first `await`, released in `finally`; button disabled with
   a "working" label.
6. **Cancellation fragment**: consumed once in `src/bootstrap.ts` before React renders (read, then
   `history.replaceState` immediately), passed to `CancelPage` as initial state and kept in memory only;
   nothing is sent until the button is pressed.
7. **Dates** formatted from string parts through `Intl.DateTimeFormat("en-GB", { timeZone: "UTC" })`
   on `Date.UTC(y, m-1, d)`; times are shown as returned (`HH:mm`).
8. **Guards**: ESLint `no-console`, `no-restricted-globals`/`no-restricted-properties` for
   `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, plus a unit test scanning `src/`
   so the rule cannot be disabled quietly.

## Complexity Tracking

No constitution violations. Nothing to justify.
