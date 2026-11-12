# Table reservation - customer interface

A small web app where a customer books a table (date, party size, time, name/email/phone) and cancels a reservation from the link in the confirmation email. English only, responsive from 360 px, keyboard and screen-reader friendly.

It is an independent npm project: it only talks to the backend through three public operations and never changes `backend/`.

## Prerequisites

- Node.js >= 22.12 and npm.
- The backend running (see `../backend`) for real use. Tests do not need it.

## Install

```sh
cd frontend
npm install
```

## Configure

Copy `.env.example` to `.env` and set the backend address:

```sh
VITE_API_BASE_URL=http://localhost:3000
```

It must be an `http:` or `https:` address with no credentials, path, query or fragment. If it is missing or invalid, the app shows "Service not available" and sends no request. The value is read when the app is built or started.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:5173 |
| `npm run build` | Type check, then production build into `dist/` |
| `npm run preview` | Serve the build (port 4173 by default) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (includes accessibility and "no storage / no logging" rules) |
| `npm test` | Vitest unit and component tests (API replaced by a fake client) |
| `npm run e2e` | Playwright tests in Chromium with the network mocked |
| `npm run api:types` | Regenerate `src/api/schema.d.ts` from the backend's `/openapi.json` |
| `npm run api:check` | Fail if the committed `schema.d.ts` differs from the backend's spec |

## Public operations used

- `POST /availability/times` - bookable times for a date and party size, grouped by service period.
- `POST /reservations` - create a reservation.
- `POST /reservations/cancel` - cancel with the code from the email (sent in the body only).

Wire types come only from the generated `src/api/schema.d.ts`. Run `npm run api:types` (backend running, address in `API_SPEC_URL`, default `http://localhost:3000/openapi.json`) whenever the backend contract changes, then commit the file. `npm run api:check` detects drift; run it before a release. A new enum value in the backend makes `npm run typecheck` fail until it has a customer message in `src/api/messages.ts`.

## Backend settings

In `backend/.env`:

- `CORS_ORIGINS` must include this site's address (`http://localhost:5173` for development).
- `CANCEL_LINK_BASE_URL=http://localhost:5173/cancel` for development. **Set it to `<site address>/cancel` before release**, so the emailed link opens the cancellation page. The code travels in the `#code=...` fragment.

## Playwright browser install

```sh
npx playwright install chromium
```

`npm run e2e` builds the app and starts two preview servers itself (4173 with a test address that the tests mock, 4174 with no address for the configuration screen). It runs on a 360 px phone viewport, a desktop viewport, and two time zones (Europe/Madrid, Pacific/Honolulu).

## Project structure

```text
src/
  api/        client (fetch), generated schema, message catalog, types
  config/     reads and validates VITE_API_BASE_URL
  features/   booking/, cancel/, unavailable/
  shared/     dates, router, accessibility helpers, shared UI
  styles/     tokens, base, components (plain CSS)
tests/        unit/ and component/ (Vitest + Testing Library), support/
e2e/          Playwright: layout, keyboard, a11y, unreachable, time zones
scripts/      api-types.mjs
```

## Dependency policy

Runtime dependencies are `react` and `react-dom` only (checked by `tests/unit/guards.test.ts`). Development dependencies are pinned to exact versions. Never install with `--force` or `--legacy-peer-deps`.

## Security and privacy rules

- The secret code returned when a reservation is created is never kept: the client drops it before anything reaches the UI.
- The cancellation code is read from the address fragment once, in `bootstrap()`, and removed from the address (`history.replaceState`) before the first render and before any request. It stays in memory only, is sent in a request body, and is cleared after a final outcome. Cancellation happens only after an explicit button press.
- No `localStorage`, `sessionStorage`, `indexedDB`, cookies or `console` output; no fonts or third-party scripts; requests use `credentials: "omit"`, `cache: "no-store"` and `referrerPolicy: "no-referrer"`.
- Customers never see status numbers, error codes, field paths, server messages or server addresses. All customer text lives in `src/api/messages.ts`.
- Dates are formatted only by `src/shared/dates.ts`, independent of the visitor's time zone.

## Usability test protocol (SC-001)

Goal: a first-time customer on a phone goes from opening the booking page to the confirmation in under 2 minutes with no instructions, in at least 9 of 10 runs.

1. At least 10 runs, each with a different participant who did not build the interface.
2. A 360 px wide phone (or a 360 px emulation), the app served with a fake server (the e2e mock or a stub) that returns times and accepts the booking.
3. Give only the goal ("book a table for 2 next Saturday"); no help.
4. Time each run from opening the page to the confirmation screen.
5. Record the results:

| Run | Participant (code) | Device | Time (s) | Finished | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |

SC-001 is met only when the table shows at least 9 of 10 runs under 120 s.
