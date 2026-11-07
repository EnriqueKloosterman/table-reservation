# Research: Confirmation Email and Reservation Cancellation

**Feature**: 003-reservation-cancellation | **Date**: 2026-11-07 | **Plan**: [plan.md](./plan.md)

No `NEEDS CLARIFICATION` remained after the spec clarifications. Each decision below
records what was chosen, why, and what was rejected.

## R1. Nodemailer release and TypeScript types

**Decision**: add `nodemailer@^10.3` as the single runtime dependency. Do **not** add
`@types/nodemailer`.

**Verification (done before locking, in an isolated scratch project, not in `backend/`)**:
- `npm view nodemailer` → latest `10.3.1`, `engines.node >=20.0.0` (project: Node `>=22.12`,
  running 22.16). No dependencies of its own (`npm install` added 4 packages in total, 0
  vulnerabilities, no install error).
- The package is `"type": "module"` with an `exports` map (`import` → `dist/esm`, `require` →
  `dist/cjs`). `import nodemailer from "nodemailer"` resolves under `module: nodenext` and
  runs on Node 22.
- It **ships its own typings** (`dist/cjs/nodemailer.d.ts`). A `tsc --strict` (TypeScript
  6.0.3, `nodenext`, `@types/node@24`) check passed **without** `@types/nodemailer` and
  `createTransport` / `sendMail` were fully typed. `@types/nodemailer@8.0.2` exists but is a
  separate DefinitelyTyped major that would only duplicate (and could contradict) the bundled
  types, so it is not installed. This deviates from the plan input (which listed it as a dev
  dependency) because the premise ("verify before locking") showed it is unnecessary.
- Runtime smoke test: sending to a closed port rejects with `error.code === "ESOCKET"`,
  which is what the notifier logs as `reason` (R4).
- API detail that matters: `createTransport(url, defaults)` takes mail *defaults* as its
  second argument, so connection timeouts cannot be passed with a URL string. Use the object
  form `createTransport({ url: SMTP_URL, connectionTimeout, greetingTimeout, socketTimeout })`.

**Alternatives**: raw `node:net`/`node:tls` SMTP client (rejected: hand-written SMTP/STARTTLS/
auth/MIME is more code and more risk than one maintained package); an HTTP email API SDK
(rejected: a further external service, forbidden by constitution Principle V).

## R2. Why the status flips BEFORE the releases (double-booking argument)

The reservation's status and the two time holds (`TableDay`, `GuestDay` intervals) live in
three different documents; plain `mongod` has no multi-document transaction (constitution
and 002 R5). Two orders are possible:

| Order | Failure window | Consequence |
|---|---|---|
| **Release first, then flip status** | After the release, before the flip, the table is free for others but the reservation is still `confirmed`. A new reservation claims the same slot. | **Two confirmed reservations for one table and time: a double booking**, the core failure Principle III forbids. If the flip then fails, success cannot be reported and the damage is already done. |
| **Flip first (atomic claim), then release** | After the flip, before a release, the reservation is `cancelled` but still holds its intervals. | The slot stays hidden from others (a *missed* booking), never double-assigned. The state is repairable by an idempotent retry (R3). |

This is the same asymmetry 002 accepted for orphan holds ("an extra hold only hides a time; a
missing one could allow a double booking"). Principle III therefore requires flip-first.

The flip is itself the concurrency gate: one `findOneAndUpdate` filtered on
`status: "confirmed"` and `startAt > now` is a single-document atomic write, so among any
number of simultaneous callers exactly one receives the document (FR-015); only that winner
releases and emails.

**Alternatives**: MongoDB multi-document transactions (the documented alternative; rejected
because they need a replica set, an infrastructure requirement 001/002 deliberately avoided,
and the flip-first order already gives correctness with a repairable failure mode); a
background sweeper that releases holds of cancelled reservations (rejected: a new moving
part, YAGNI; the repair-on-retry path in R3 and the README debt entry are enough).

## R3. Release failure handling and repair

- Releases are `releaseInterval(model, key, reservationId)`: a `$pull` by `reservationId`.
  It is idempotent (pulling an absent element matches nothing) and cannot remove another
  reservation's interval, which satisfies FR-021.
- Each of the two releases is attempted, and on a database error retried **once**. Both are
  attempted even if the first fails after retry (so a failure of one does not leave the other
  held for no reason). If either still fails: log `console.error` (reservation id and error
  name only), answer `INTERNAL_ERROR`, send **no** email, and keep `status: "cancelled"`.
  Success is never reported while a hold may remain (FR-008).
- A later request carrying the same code (or the staff id) finds the reservation
  `cancelled`, runs the same idempotent releases (the **repair release**), and then answers
  `ALREADY_CANCELLED` (409) if they succeed, or `INTERNAL_ERROR` if they fail again. The repair
  changes no state and sends no email, so the guest's cancellation email is never lost twice
  nor duplicated. Consequence documented as known debt: the guest whose first attempt got a
  500 and who retries sees `ALREADY_CANCELLED`, which is truthful (the reservation *is*
  cancelled) and by then the holds are healed.
- The repair needs `tableId`, `date`, `guestEmail` from the stored reservation, read with
  `lean()` (`secretCodeHash` is `select: false` and not needed).

## R4. Notifier: never fail, delay or leak

- `notifyConfirmation` / `notifyCancellation` are synchronous functions returning `void`.
  They create the attempt promise, register it in a `Set<Promise>`, and return immediately.
  Callers never `await` them, so the response cannot be delayed (FR-003).
- The attempt is `Promise.race([sender.send(message), timeout])` inside an `async` function
  with a `try/catch` that swallows everything, so a rejection can never be unhandled. The
  `send` call itself is wrapped (a sender that throws synchronously is caught as well). The
  timeout timer is cleared in `finally` (and `unref`'d) so it neither leaks nor keeps the
  process alive. A sender that never resolves is abandoned after `EMAIL_TIMEOUT_MS`; the
  attempt is logged as failed with `reason: "EmailTimeout"` (the name of the timeout error).
- Failure log: exactly one `console.error(JSON.stringify({ event: "email_failed", kind,
  reservationId, reason, at }))` where `reason = error.code ?? error.name` and `at` is the ISO-8601 UTC time of the failure. `error.message` is
  never read for logging because SMTP errors often embed the recipient address; the code,
  the full address and the secret code are never logged. `reason` is truncated to a short
  length and non-strings fall back to `"Unknown"`.
- `NoopEmailSender` (no `SMTP_URL`) logs `console.log(JSON.stringify({ event:
  "email_skipped", kind, reservationId, at }))` and resolves. Because the sender interface only
  receives `{ to, subject, text }`, `kind` and `reservationId` are passed to the sender as an
  optional second argument `meta` (`send(message, meta)`) used by the noop sender for its log
  line and ignored by SMTP/fake senders other than for recording. This keeps the interface
  one method while meeting the "kind and reservationId only" log rule.
- `idle()` resolves when the pending set is empty (loops until empty, since an attempt can
  register while waiting). Production code never calls it; tests do, which makes the
  "exactly one email after the dust settles" assertions deterministic without sleeps.
- An undeliverable address with a *working* SMTP server is out of reach of any sender-side
  check; it surfaces as an asynchronous bounce, which is out of scope (spec Assumptions).

## R5. Email content and security

- Plain text, English, fixed subjects (`Your reservation at <RESTAURANT_NAME> is confirmed`,
  `Your reservation at <RESTAURANT_NAME> was cancelled`). The only variable is the configured
  `RESTAURANT_NAME` (operator-controlled, validated without CR/LF); guest data (name, email,
  phone, code) is **never** in a subject.
- The guest name appears only in the body with every `\r` and `\n` removed (replaced by a
  single space), so a crafted name cannot inject lines into the body. Header injection is
  already impossible because subject and `to` are never built from the name; `to` is the
  validated email from 002 and Nodemailer refuses CR/LF in headers.
- Date and times come from the reservation's stored restaurant-local text fields
  (`date`, `startTime`, `endTime`), which were produced with `RESTAURANT_TIME_ZONE` at
  creation, so no UTC-to-local conversion is needed at send time and DST cannot shift them.
  The renderer test uses a reservation near a DST change to prove the stored local text is
  printed unchanged while `startAt` (UTC) differs from the naive reading.
- The table name is never passed to the renderers (their input type has no such field), so
  leaking it is impossible by construction; a unit test still asserts absence.
- The cancellation link is `${CANCEL_LINK_BASE_URL}#code=<code>`. A **URL fragment** is never
  sent in an HTTP request, so the code does not reach any server log, proxy or `Referer`
  header (browsers strip fragments there). The future frontend reads it with
  `location.hash` and POSTs it in the body. The code is also printed as plain text so the
  guest can use it without the link. The code is base64url (`[A-Za-z0-9_-]`), so it needs no
  escaping in a fragment.
- The cancellation email carries no code and is worded by `cancelledBy`.

## R6. Guest lookup by code: uniqueness, timing and the generic answer

- `secretCodeHash` gets a **unique** index (built by `initModels`, so startup fails if it
  cannot be built, e.g. pre-existing duplicate hashes, which cannot occur for 256-bit random
  codes). Lookup is `findOne({ secretCodeHash })` on that index; `select: false` on the field
  does not prevent filtering on it.
- `hashSecretCode(code)` receives the string exactly as sent (no trim, no case change, no
  length cap beyond the 100 kB body limit). Any non-matching string, including empty,
  short, long or malformed, hashes to a value that matches nothing and yields the same
  `NOT_FOUND "Reservation not found"`. There is no structural pre-check that could answer
  earlier or differently (FR-011), so shape and status are identical by construction.
- The body schema is `strictObject({ code: z.string() })`: a missing or non-string `code` or
  an unknown field is a `VALIDATION_ERROR` (400) per FR-022; that reveals nothing about any
  reservation.
- Timing: the lookup is an indexed equality on a SHA-256 of the input, so the response time
  does not depend on how many leading characters of a real code are correct (the hash
  destroys prefix structure). No constant-time comparison code is needed.
- Staff: `Types.ObjectId.isValid`-style strict parsing (24 hex chars); malformed or unknown ids
  both give `NOT_FOUND`. Staff has already authenticated, so distinguishing nothing extra is
  simply consistent.
- No rate limiting (spec out of scope); documented as known debt. A 256-bit code cannot be
  guessed, so the exposure is load only.

## R7. Atomic claim details

- `Reservation.findOneAndUpdate({ _id, status: "confirmed", startAt: { $gt: now } },
  { $set: { status: "cancelled", cancelledAt: now, cancelledBy } }, { new: true })` with
  `now = clock.now()` read once per request. `startAt > now` strictly: at the exact start
  instant the reservation counts as started (spec edge case).
- If it returns `null`, one re-read (`findById`, `lean`) decides the answer:
  `cancelled` → repair release then `ALREADY_CANCELLED`; `confirmed` with `startAt <= now` →
  `CANNOT_CANCEL`; missing → `NOT_FOUND`. A reservation that is cancelled concurrently
  between the claim and the re-read correctly shows as `cancelled`.
- Ended reservations (past `endAt`) are `confirmed` with `startAt <= now`, so they are
  `CANNOT_CANCEL`, including those whose table was later removed (spec edge case): the
  table is never read in the cancel path except through the id stored in the reservation.
- Old reservations created before this feature have `status: "confirmed"` and no
  `cancelledAt` / `cancelledBy`. Defaults (`null`) apply on read; no data migration needed.
  The unique `secretCodeHash` index builds cleanly on them.

## R8. Cancel vs reserve race

Cancellation flips status, then pulls the intervals; the reserve flow only reads intervals.
A concurrent reserve that evaluates availability before the pull sees the slot held and gets
`NO_AVAILABILITY` / `duplicate_reservation`; one that evaluates after the pull sees it free
and claims atomically (002 R5). There is no instant where an interval is absent while a
`confirmed` reservation exists for it, hence no double assignment. Verified by a race test
with the `afterClaim`/ops hooks of 002.

## R9. Existing rules need no query change (SC-006)

Availability, bookable times, table assignment, the duplicate check and the table removal
rule all read `TableDay`/`GuestDay` intervals, which the cancel releases; they therefore
ignore cancelled reservations **without changing their queries**. This is explicit in the
plan and each rule still gets its own test. The only code that reads the `Reservation`
collection for those rules is `affected.ts` (the three affected-reservation queries), which
gets `status: "confirmed"` added to every query. The aggregate in `affectedBySchedule` adds
it to its `$match` stage.

## R10. Configuration

| Key | Rule |
|---|---|
| `SMTP_URL` | optional; when present must parse as a URL with protocol `smtp:` or `smtps:`. An empty string is treated as unset (an empty `SMTP_URL=` line in `.env` is common). |
| `EMAIL_FROM` | required **iff** `SMTP_URL` is set (Zod `superRefine`; error reported on `EMAIL_FROM`); when set, a valid mailbox (`a@b.c` or `Name <a@b.c>`), no CR/LF. Ignored when `SMTP_URL` is absent. |
| `EMAIL_TIMEOUT_MS` | whole number via the existing `wholeNumber` helper, 100..120000, default 10000. |
| `RESTAURANT_NAME` | string, trimmed, 1..100 chars, no CR/LF, default `"the restaurant"`. |
| `CANCEL_LINK_BASE_URL` | valid `http(s)` URL, default `http://localhost:5173/cancel`; must not already contain a fragment (the renderer appends `#code=`). |

`SMTP_URL` may contain credentials; it is never logged. The Noop sender is selected at
startup when it is absent: the application starts and works.

## R11. Test double and test-app wiring

`FakeEmailSender` (in `tests/helpers/`) implements `EmailSender` with modes `ok` (records
`{ message, meta }`), `fail` (rejects with an error whose `message` contains a fake address
and whose `code` is `"EENVELOPE"`, so tests can prove the message is not logged), `slow`
(resolves after a configurable delay), and `never` (never settles). `buildTestApp` gets an
`emailSender` option (default: a recording fake in `ok` mode) and returns the app **plus**
access to the notifier through a small `buildTestContext`-style addition, so tests can call
`idle()`. To keep the existing `buildTestApp(options): Express` signature (used by every 001/002
test), the notifier is exposed through an optional `onNotifier` callback in the options
rather than changing the return type.

## R12. Dependency justification (Principle V)

See the table in [plan.md](./plan.md#dependency-justification-principle-v). Nothing else is
added: timeouts use `Promise.race` and `setTimeout`, JSON logging uses `console`, hashing
reuses `node:crypto`.
