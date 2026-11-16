# Quickstart: Validating the Customer Booking Interface

Run guide for feature 005. The exact commands exist once the tasks are implemented; the
expected outcomes below are the acceptance checks.

## Prerequisites

- Node >= 22.12 (verified on 22.16.0), npm.
- For the manual flow only: MongoDB, the backend, and MailDev (or any SMTP catcher). Automated
  tests need none of them.

## 1. Install and configure

```bash
cd frontend
npm ci
cp .env.example .env        # VITE_API_BASE_URL=http://localhost:3000
npx playwright install chromium   # one-time browser download for e2e
```

## 2. Automated checks (no backend needed)

```bash
npm run typecheck
npm run lint                # includes no-console and no-storage rules
npm test                    # Vitest + Testing Library with a fake ApiClient
npm run e2e                 # Playwright against vite preview, network mocked
```

Expected: all green. Each user story's tests were first run RED (recorded in `tasks.md`) before the
implementation.

| Check | Where | Proves |
|---|---|---|
| Dates identical for UTC-12..UTC+14 | `tests/unit/dates.test.ts` | FR-029 |
| `secretCode` absent from result, DOM, storage, console | `tests/unit/client.test.ts`, `tests/component/booking.test.tsx` | FR-009 |
| Catalog exhaustive; unknown value -> generic | `tests/unit/messages.test.ts` | FR-004, FR-013, SC-003 |
| Late answer never replaces latest | `tests/unit/times-guard.test.ts` | FR-003 |
| Exactly one request on double click / double Enter | `tests/component/*` | FR-010, SC-004 |
| Fragment removed, no request until button | `tests/component/cancel.test.tsx` | FR-016, FR-017, SC-005 |
| Missing/invalid config screen | `tests/component/config.test.tsx` | FR-030 |
| 360 px and desktop without horizontal overflow | `e2e/layout.spec.ts` | FR-024, SC-006 |
| Keyboard-only booking and cancellation | `e2e/keyboard.spec.ts` | FR-025, SC-006 |
| axe: zero serious/critical on every screen/state | `e2e/a11y.spec.ts` | FR-026, SC-007 |
| Unreachable within 10 s with retry | `e2e/unreachable.spec.ts` | FR-027, SC-009 |
| Same times under two browser time zones | `e2e/timezones.spec.ts` | SC-010 |

## 3. Contract drift check (needs the backend running)

```bash
# in backend/: npm run dev
cd frontend
npm run api:check           # fails if src/api/schema.d.ts is stale or the backend is unreachable
npm run api:types           # regenerates it after a backend contract change
```

## 4. Manual end-to-end (backend + MailDev + frontend)

Backend `.env` must include the (default) values:

```text
CORS_ORIGINS=http://localhost:5173
CANCEL_LINK_BASE_URL=http://localhost:5173/cancel
SMTP_URL=smtp://localhost:1025
EMAIL_FROM=La Mesa <noreply@example.com>
```

1. Start MongoDB, `npm run dev` in `backend/`, MailDev (web UI `http://localhost:1080`), then
   `npm run dev` in `frontend/` (`http://localhost:5173`). Make sure the restaurant has a schedule
   and tables (feature 001).
2. Open `/`. The date and party size are empty and a prompt asks for both; no request was made.
3. Pick a future date and a party size: times appear grouped by period. Pick a date the restaurant
   is closed: a specific reason appears.
4. Pick a time, fill name/email/phone, confirm: the confirmation shows date, start, end, party size
   and name, and says an email is on its way. No secret code is visible.
5. In MailDev, open the email and follow the cancel link: the address bar shows `/cancel` without
   the code; nothing was cancelled yet. Press the button: "cancelled" with the details.
6. Reload the cancel page: it asks for the code by hand. Open the email link again in a new tab and
   press the button: "already cancelled".
7. Stop the backend and press retry on any screen: within 10 seconds the "can't reach the server"
   message appears with a retry control.
8. Remove `VITE_API_BASE_URL` from `.env`, restart `npm run dev`: the "service not available"
   screen appears.
9. Mobile check: resize to 360 px; confirm nothing scrolls horizontally and every control is usable;
   complete the booking with the keyboard only.
