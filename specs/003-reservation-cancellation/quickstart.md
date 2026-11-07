# Quickstart: Validating Confirmation Email and Cancellation

**Feature**: 003-reservation-cancellation. Details: [contracts/api.md](./contracts/api.md),
[data-model.md](./data-model.md).

## Prerequisites

- Node >= 22.12, MongoDB reachable through `MONGODB_URI`, features 001 and 002 working
  (`backend/.env` with `JWT_SECRET`, `RESTAURANT_TIME_ZONE`, a staff user from `npm run seed:staff`).
- `cd backend && npm install` (adds `nodemailer`).
- Optional, to see real emails: [Mailpit](https://mailpit.axllent.org/) (`docker run -p 1025:1025
  -p 8025:8025 axllent/mailpit`), then in `.env`:

```text
SMTP_URL=smtp://localhost:1025
EMAIL_FROM=Reservations <reservations@example.test>
RESTAURANT_NAME=La Mesa
CANCEL_LINK_BASE_URL=http://localhost:5173/cancel
```

Without `SMTP_URL` the app works and each email is skipped with a log line
`{"event":"email_skipped",…}`.

## Automated validation

```bash
cd backend
npm run typecheck && npm run lint && npm test
```

All email behavior is tested with `FakeEmailSender`; no SMTP server is needed. Expect RED
first for each story's new tests (recorded in `tasks.md`), then GREEN.

## Manual scenarios (server running with Mailpit)

1. **Confirmation email (US1)**: `POST /reservations` → 201. Mailpit shows one email to the
   guest with date, time, party size, the link `…/cancel#code=<code>` and the code, and no
   table name. Stop Mailpit and repeat: still 201, one `email_failed` log line with no code,
   no address.
2. **Guest cancels (US2)**: `curl -X POST :3000/reservations/cancel -H 'Content-Type:
   application/json' -d '{"code":"<code>"}'` → 200 `status: cancelled`; the cancellation
   email ("You cancelled…") arrives; the same slot is bookable again and the same email can
   reserve again. Repeat the request → 409 `ALREADY_CANCELLED`, no second email.
3. **Bad codes**: `{"code":""}`, `{"code":"abc"}`, a 200-char string → identical 404
   `Reservation not found`. `{}` or `{"code":1}` → 400.
4. **Started reservation**: with the clock past `startAt` → 409 `CANNOT_CANCEL`, unchanged.
5. **Staff cancels (US3)**: `POST /closed-dates` (response lists affected reservations) then
   `POST /reservations/{id}/cancel` with the bearer token → 200; email "The restaurant
   cancelled…"; without token → 401; a later configuration change no longer lists it.
6. **Docs (US5)**: open `/docs`: both operations listed, the guest one marked "Public — no
   sign-in required.", 19 operations in total, status enum shows both values.

## Done when

All story suites pass, the contract suites report 19 operations and 7 public ones, and the
manual scenarios above behave as described.
