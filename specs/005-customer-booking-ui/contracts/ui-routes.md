# Contract: Destinations, URLs and Screens

## Destinations (FR-022)

| Path | Screen | Notes |
|---|---|---|
| `/` | Booking page | Starts with empty date and party size (no request). Any unknown path is replaced by `/`. |
| `/cancel` | Cancellation page | The exact address used in the email link: `<site>/cancel#code=<code>` (backend `CANCEL_LINK_BASE_URL=http://localhost:5173/cancel`). |

Navigation is the History API with a `popstate` listener. Booking steps do not add history entries,
so Back from the confirmation does not resubmit and a reload starts a fresh booking.

## Cancellation URL rules (FR-016, FR-017)

1. Before React renders, `bootstrap()` reads `#code=...` with `URLSearchParams`, then calls
   `history.replaceState(null, "", location.pathname + location.search)`.
2. The code lives only in `CancelPage` state; it is never in the query, storage, logs or
   referrers (`<meta name="referrer" content="no-referrer">`).
3. Nothing is requested on load. Only the explicit button press sends one request.
4. After a final outcome the code and the manual field are cleared.

## Screens and states

Every API-dependent screen has loading, empty (where it applies), error and unreachable states; the
unreachable state differs from the server-error state and has a retry.

| Screen / region | States |
|---|---|
| Service unavailable (config) | single state; no technical detail; no retry (needs a rebuild) |
| Booking: date + party size | idle (prompt), invalid field problems |
| Booking: times | idle, loading, ready (grouped radios), empty (reason message), error (retry), unreachable (retry) |
| Booking: details form | editing, field problems, submitting (button "Booking...", disabled), refusal message, unknown outcome, general failure |
| Booking: confirmation | success summary + "Start a new booking" |
| Cancellation: ready with code | explicit "Cancel my reservation" button, submitting, temporary failure (retry) |
| Cancellation: no code | explanation, code field, disabled button while empty |
| Cancellation: outcome | cancelled, already cancelled, cannot cancel, not found; each with a link to the booking page (FR-021) |

## Accessibility contract (FR-024 to FR-026)

- One `h1` per screen state; landmarks `header`/`main`/`footer`.
- Visible `<label>` for every field; errors linked with `aria-describedby` and `aria-invalid`.
- A polite status live region (times loaded/refreshed, outcome) and an alert region for failures
  and the validation summary.
- Focus moves to the new `h1` or the error summary when the step changes.
- Time choices are radio inputs grouped in a `fieldset` per service period; selection is shown by a
  check mark and border weight, not color alone.
- Touch targets >= 44 px; visible focus ring; contrast >= 4.5:1; no horizontal scroll at 360 px;
  `prefers-reduced-motion` honored.

## Display formats (FR-029)

- Date: `Saturday 14 November 2026` (English, from the `YYYY-MM-DD` parts via `Intl` in UTC).
- Time: the `HH:mm` string exactly as returned (24-hour).
- Never converted to the visitor's time zone; the visitor's clock is used for no rule.
