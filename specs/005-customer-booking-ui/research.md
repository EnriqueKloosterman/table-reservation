# Research: Customer Booking Interface

All Technical Context items are resolved; there are no open NEEDS CLARIFICATION entries.

## R1. Toolchain versions and compatibility (verified 2026-11-12)

Checked with `npm view` and a full `npm install --dry-run` in a scratch project on the installed
Node 22.16.0 (npm 11.11.0), without `--force` or `--legacy-peer-deps`.

**Decision**: pin exact versions.

| Package | Pin | Note |
|---|---|---|
| react / react-dom | 19.3.1 | peer of RTL 16.3.3 and `@types/react@19.3.0` satisfied |
| vite | 8.3.8 | engines `^20.19 \|\| >=22.12` |
| @vitejs/plugin-react | 6.3.0 | requires Vite 8 |
| typescript | **5.9.3** | see below |
| eslint, @eslint/js | **9.39.5** | see below |
| typescript-eslint | 8.72.2 | supports ESLint 8-10 and TS < 6.1 |
| eslint-plugin-react-hooks | 7.1.1 | |
| eslint-plugin-jsx-a11y | 6.10.2 | |
| globals | 17.14.0 | |
| vitest | 5.1.0 | engines `^22.12`; peer Vite 8 OK |
| jsdom | **27.4.0** | see below |
| @testing-library/react / dom / user-event / jest-dom | 16.3.3 / 10.4.2 / 14.6.10 / 7.0.1 | |
| openapi-typescript | 7.13.0 | |
| @playwright/test, @axe-core/playwright | 1.65.0, 4.14.0 | axe needs Node >= 22.12 |
| @types/react, @types/react-dom, @types/node | 19.3.0, 19.3.0, 22.20.5 | |

**Conflicts found and how they were resolved (no forcing):**

- **TypeScript 7.0.2 / 6.0.3 vs openapi-typescript 7.13.0**: its peer is `typescript@^5.x`; a first
  install with TS 6.0.3 failed with `ERESOLVE`. Resolution: TypeScript 5.9.3 (latest 5.x). The
  backend uses TS 6, but the frontend is an independent project; revisit when openapi-typescript
  widens its peer range.
- **ESLint 10 vs eslint-plugin-jsx-a11y 6.10.2**: peer range stops at ESLint 9. Resolution: ESLint
  9.39.5 with `@eslint/js` 9.39.5 (flat config works the same). The backend uses ESLint 10; again
  independent.
- **jsdom 28/29/31**: 31.0.0 requires Node `^22.22.2`, 29 `^22.13`; the installed Node is 22.16.0.
  27.4.0 requires `^22.12` and is verified. happy-dom was the alternative; jsdom was kept because
  it is the reference environment for Testing Library and `history`/`location` behavior used by the
  cancellation tests.
- Dry run of the final set: 382 packages, no peer conflicts.

**Playwright browsers** are not an npm dependency: `npx playwright install chromium` downloads a
browser once on a developer machine. Documented in the README; only Chromium is used (time zones
and viewport are emulated per context, which is enough for SC-006/SC-010).

**Alternatives considered**: ESLint 10 with `--legacy-peer-deps` or an `overrides` block (rejected:
the user's rule is to stop on conflicts, not bypass them); Vite 7 (no benefit, plugin-react 6 needs
8); Biome instead of ESLint (rejected: the requested jsx-a11y and react-hooks rules are the point).

## R2. No router library

**Decision**: a ~20-line `shared/router.ts`: `usePathname()` via `useSyncExternalStore` on
`popstate` plus a custom `navigate(path)` that calls `history.pushState` and dispatches a
notification. Two destinations only (`/` and `/cancel`); any other path renders the booking page
after `replaceState("/")`.

**Rationale**: two routes do not justify a dependency (Principle V). The `/cancel#code=...` link
arrives as a full page load from email, so no client-side routing is involved in the secret path.

**Alternatives**: react-router (rejected: size, API surface and its own data layer for two routes).

## R3. No data-fetching or forms library

**Decision**: `useBookableTimes(date, partySize)` owns a request id in a ref and an
`AbortController`; effects abort the previous request and ignore any result whose id is not the
latest. Submit hooks use a ref lock. Three fields are validated by plain functions.

**Rationale**: the app has three calls and no caching needs (the backend answers
`Cache-Control: no-store` and answers are snapshots). A library would add a cache that must be
defeated.

**Alternatives**: TanStack Query (rejected: caching is unwanted, bigger than the whole app),
react-hook-form (rejected: three fields; its uncontrolled model complicates "keep typed values").

## R4. Generated API types and drift check

**Decision**: `scripts/api-types.mjs` uses the `openapi-typescript` Node API (`openapiTS` +
`astToString`) so the same script works on Windows/macOS/Linux without shell env syntax.
`npm run api:types` writes `src/api/schema.d.ts`; `npm run api:check` generates to memory/temp and
exits non-zero if the output differs from the committed file or if the backend is unreachable.
`API_SPEC_URL` defaults to `http://localhost:3000/openapi.json`.

The client uses the generated `paths` and `components` types; the three operations are typed from
`paths["/availability/times"]["get"]`, `paths["/reservations"]["post"]` and
`paths["/reservations/cancel"]["post"]`.

**Findings from the backend contract (read from `backend/src/**`):**

- `AvailabilityReason` and `ConflictReason` are published as named components; the error `code`
  enum is inline in `ErrorResponse.error.code` and includes staff-only codes
  (`AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`) and `SERVICE_UNAVAILABLE`. The catalog must be
  exhaustive over the whole enum, so staff-only codes map to the generic message.
- `ConflictReason` also holds `table_has_upcoming_reservations`, a staff-side case. It is mapped to
  the generic message (never reachable from `POST /reservations`).
- Refusals the UI handles per operation: times: `VALIDATION_ERROR`; create: `VALIDATION_ERROR`,
  `CONFLICT` (`duplicate_reservation`), `NO_AVAILABILITY` (7 reasons); cancel: `VALIDATION_ERROR`,
  `NOT_FOUND`, `ALREADY_CANCELLED`, `CANNOT_CANCEL`.
- The "empty day" reasons arrive in a 200 body (`reason` when `periods` is empty); the refusal
  reasons arrive in a 409 `details.reason`. Both use the same `AvailabilityReason` enum and share
  one set of messages.

**Alternatives**: hand-written types (forbidden by Principle I); a generated runtime client such
as `openapi-fetch` (rejected: a runtime dependency to avoid about 60 lines; our result union and
`secretCode` stripping are custom anyway).

## R5. API client behavior

**Decision**: `createApiClient({ baseUrl, fetch = globalThis.fetch, timeoutMs = 8000 })`.

- Requests: `GET` with query built by `URLSearchParams`; `POST` with `Content-Type:
  application/json`; `credentials: "omit"`; `cache: "no-store"`; `referrerPolicy: "no-referrer"`.
- One `AbortController` per request combining the 8 s timeout and the caller's `signal`; a
  caller abort resolves to a distinct internal `aborted` that the hook ignores (not shown to the
  user); a timeout is `unreachable`.
- Classification: `fetch` throws (network, CORS, DNS, timeout) -> `unreachable`; status >= 500 ->
  `serverError`; body not valid JSON or not matching the expected shape -> `serverError`; 4xx
  with a recognised `error.code` -> `refusal`; 4xx with an unrecognised shape -> `serverError`
  (the catalog never receives garbage); 2xx parsed with a narrow runtime check before mapping.
- No automatic retry: retries live behind explicit buttons, which keeps the 10 s bound (SC-009)
  and avoids double submissions.

**Allow-list mapping**: `createReservation` builds `Confirmation { date, startTime, endTime,
partySize, guestName }` from named fields only. The response object is never spread, never stored
and never logged, so `secretCode`, `table`, `id`, email and phone cannot be carried over by
mistake. A unit test asserts that the serialised result contains neither `secretCode`, the code's
value, nor `table`.

## R6. Messages

**Decision**: `src/api/messages.ts` exports typed `Record`s keyed by the generated enums:
`AVAILABILITY_MESSAGES: Record<AvailabilityReason, Message>`, `CONFLICT_MESSAGES:
Record<ConflictReason, Message>`, `ERROR_CODE_MESSAGES: Record<ErrorCode, Message>`, plus
`messageFor*` functions that fall back to `GENERIC_MESSAGE` when the runtime value is not a key
(a new backend value in an older build). Each `Message` has `title`, `body` and an optional `next`
(the offered next step). The full text is in [contracts/messages.md](./contracts/messages.md).

**Rationale**: a new enum value in `/openapi.json` followed by `api:types` turns into a TypeScript
error until the catalog is updated; the runtime fallback covers a deployed mismatch.

## R7. Dates and times

**Decision**: `formatDate("2026-11-14")` parses with a strict `^\d{4}-\d{2}-\d{2}$` check,
validates the calendar day, builds `new Date(Date.UTC(y, m - 1, d))` and formats with
`Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric",
timeZone: "UTC" })` (for example "Saturday 14 November 2026"). `formatTime` returns the validated
`HH:mm` string unchanged. A value that does not match is shown as-is-neutral ("date not
available") and never throws. `new Date(string)`, `toISOString` and the visitor's clock are banned
in `src/` by a unit test that scans the source.

**Verification**: a unit test loops `process.env.TZ` over zones covering UTC-12 to UTC+14
(for example Etc/GMT+12, Pacific/Honolulu, America/Los_Angeles, UTC, Europe/Madrid,
Asia/Kolkata, Pacific/Kiritimati) and asserts the same output; Playwright repeats the check with
two `timezoneId` values (SC-010). The `Date` is created only as an argument carrier to `Intl` in
UTC.

## R8. Cancellation page and the secret

**Decision**: the fragment is consumed once, **before React renders**, in `src/bootstrap.ts`:
`takeCodeFromFragment()` reads `location.hash` with `new URLSearchParams(hash.slice(1)).get("code")`,
then immediately calls `history.replaceState(null, "", location.pathname + location.search)`, and
returns the code (or `null`). `bootstrap()` calls it only when the pathname is `/cancel` and passes
the result to `<App initialCancelCode={...}>`, where `CancelPage` keeps it in component state only.
Doing it outside React avoids StrictMode's double-invoked initialisers (a second read of an
already-stripped hash would return nothing and lose the code). `<meta name="referrer"
content="no-referrer">` in `index.html` and `referrerPolicy: "no-referrer"` on requests stop it
leaking. No `fetch` happens on load or prefetch. Tests call `bootstrap()` (jsdom `location`) to prove
the fragment is gone before any request, and render `<App>` in StrictMode to prove the code survives.
A reload loads the page without a fragment, so it behaves as having no code.

On a final outcome (cancelled, already cancelled, cannot cancel, not found) the code is set to
`""` in state and the manual field is cleared. A temporary failure (server error or
unreachable) keeps it so a retry works; cancelling twice is answered as already cancelled by the
backend, so a retry is safe.

**Alternatives**: `sessionStorage` handoff (forbidden by constitution); a query string (forbidden).

## R9. Accessibility patterns

- Landmarks: `header`, `main`, `footer`; exactly one `h1` per screen state (a heading ref).
- A persistent visually hidden `role="status"` (polite) live region for status changes (times
  loaded or refreshed, outcome shown) and `role="alert"` for request failures and the validation
  summary; messages are written after the region is mounted so they are announced.
- Focus: `useFocusOnChange(ref, key)` moves focus to the new `h1`/error summary (with
  `tabIndex={-1}`) when the step changes: details form shown, confirmation, outcome, failure.
- Selection: times are `<input type="radio">` inside a `fieldset`/`legend` per service period, one
  radio group so arrow keys work; the selected one is shown with a check mark and a thicker border,
  not color alone.
- Errors: per-field text linked with `aria-describedby`, `aria-invalid`, and an icon/prefix
  ("Error:") so color is never the only signal.
- Targets: `min-height: 44px; min-width: 44px` tokens; focus ring token `outline: 3px solid`
  with offset; `@media (prefers-reduced-motion: reduce)` removes the spinner animation and
  transitions.
- Contrast: tokens chosen at >= 4.5:1 for text and >= 3:1 for borders/focus; axe checks them.

## R10. Test strategy details

- **RED recording**: each story's tasks start with writing its tests and running them with the
  result captured in the task notes before any implementation.
- **FakeApiClient**: an in-memory implementation of `ApiClient` with scripted responses and
  `deferred()` promises for ordering races (late answer) and for counting requests.
- **Time zones in Vitest**: set `process.env.TZ` before constructing dates (Node re-reads it);
  restored in `afterEach`.
- **Playwright**: `webServer` runs `npm run build` then `vite preview --port 4173 --strictPort` with
  `VITE_API_BASE_URL=http://127.0.0.1:3999`; `page.route("http://127.0.0.1:3999/**")` provides the
  mock, `route.abort("connectionrefused")` the unreachable case, and a delayed `route.fulfill` the
  slow case. Run with 360x740 and 1280x800 viewports; two `timezoneId` projects for SC-010.
  `/cancel` works on `vite preview` because Vite's preview server falls back to `index.html` for SPA
  paths (verified in the e2e smoke test).
- **Guards**: lint rules plus `tests/unit/guards.test.ts` that reads `src/**` and fails on
  `console.`, `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `new Date(` with a
  non-numeric argument, `toISOString`, and `Date.now` outside an allow-list (none expected).

## R11. Configuration and CORS

`VITE_API_BASE_URL` is parsed with `new URL`; it must be `http:` or `https:`, have no username,
password, query or fragment, and a pathname of `/` or empty; a trailing slash is normalised away. It
is read once in `config/env.ts` (`readConfig(raw)` is a pure function so the missing-config screen is
testable without rebuilding). Backend side, documented in the README only: `CORS_ORIGINS` must
include the frontend origin (default `http://localhost:5173`) and `CANCEL_LINK_BASE_URL` must be
`http://localhost:5173/cancel`; both are the existing backend defaults. The backend allows the
`Content-Type` header and `POST`, so the JSON preflight succeeds.
