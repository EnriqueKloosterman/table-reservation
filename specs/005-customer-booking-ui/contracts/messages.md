# Contract: Message Catalog

All customer-facing text lives in `src/api/messages.ts` (English, FR-031). Wording below is the
intended copy; the exact strings may be polished during implementation but each row MUST stay a
distinct message and MUST NOT expose codes, status numbers, field paths, server messages or
addresses (FR-028). "Next" is the offered next step.

## Empty day / refused time (`AvailabilityReason`)

Used both for an empty `GET /availability/times` answer and for a `NO_AVAILABILITY` refusal.

| Reason | Message | Next |
|---|---|---|
| `closed_date` | The restaurant is closed on that date (holiday or special closure). | Choose another date. |
| `closed_day` | The restaurant is normally closed on that day of the week. | Choose another date. |
| `too_soon` | That date is too soon to book online. | Choose a later date or contact the restaurant. |
| `too_far_ahead` | That date is too far ahead to book yet. | Choose an earlier date. |
| `party_too_large` | We can't seat a party of that size online. | Try a smaller party or contact the restaurant. |
| `no_table_free` | There are no tables left for that day and party size. | Try another date or party size. |
| `outside_service_hours` | The restaurant doesn't take bookings at that time. | Choose another date or time. |

After a `NO_AVAILABILITY` on confirm, the lead-in differs for `no_table_free`: "That time was just
taken." followed by the refreshed list; for the other reasons the table above is used.

## Conflicts (`ConflictReason`)

| Reason | Message | Next |
|---|---|---|
| `duplicate_reservation` | This email already has a reservation around that time. Nothing was booked. | Choose another time, or contact the restaurant. If you didn't see a confirmation, check your inbox first. |
| `table_has_upcoming_reservations` (staff-only) | Generic message | Try again. |

## Error codes (`ErrorCode`, exhaustive over the generated enum)

| Code | Where it can occur | Message | Next |
|---|---|---|---|
| `VALIDATION_ERROR` | times/create | Field-level problems next to each field; unknown field -> "Please check the details and try again." | Fix the fields. |
| `NOT_FOUND` | cancel | We couldn't find that reservation. | Check the link in your email or type the code again. |
| `ALREADY_CANCELLED` | cancel | This reservation was already cancelled. | Nothing more is needed. |
| `CANNOT_CANCEL` | cancel | This reservation has started or ended and can no longer be cancelled online. | Contact the restaurant if you need help. |
| `CONFLICT` | create | By `ConflictReason` above. | |
| `NO_AVAILABILITY` | create | By `AvailabilityReason` above. | |
| `SERVICE_UNAVAILABLE` | any | Same as server error below. | |
| `INTERNAL_ERROR` | any | Same as server error below. | |
| `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS` | never (staff-only) | Generic message. | Try again later. |

## Client-side conditions

| Condition | Message | Next |
|---|---|---|
| Server error on times | We couldn't load the available times. | Try again. |
| Server error on create | Your reservation couldn't be completed. | Check your email before trying again. |
| Unreachable (times) | We can't reach the server right now. | Check your connection and try again. (Retry button) |
| Unreachable (create) | We don't know whether your reservation was made. A confirmation email may already be on its way. | Check your email before trying again. |
| Server error / unreachable (cancel) | We couldn't complete the cancellation just now. | Try again; pressing it twice is safe. |
| Missing/invalid config | This service isn't available right now. | Please try again later. (No technical detail.) |
| Generic fallback (unknown code/reason) | Something went wrong. | Please try again. |
| Idle times prompt | Choose a date and a party size to see the available times. | |
| Confirmation | Your table is booked. We've emailed you how to cancel. (plus date, start, end, party, guest name) | Start a new booking. |
| Cancelled | Your reservation is cancelled. (plus date, start, end, party) | Make a new booking. |

## Field problems (client validation)

| Field | Problems |
|---|---|
| Date | Enter a valid date. |
| Party size | Enter a whole number from 1 to 50. |
| Name | Enter your name (up to 100 characters). |
| Email | Enter a valid email address (up to 254 characters). |
| Phone | Enter a phone number with at least 7 digits and at most 20 characters (spaces, hyphens, parentheses and a leading + are allowed). |
| Cancellation code | Enter the cancellation code from your email. |

Field problems are prefixed visually and in text with "Error:" so color is never the only signal.

## Tests

- `messages.test.ts`: every key of each generated enum has a message; the fallback returns the
  generic message for unknown values; no message contains digits-only status codes, `/`-paths, `{`,
  or the strings of any code.
- Compile-time: removing a key or adding an enum value in `schema.d.ts` fails `tsc`.
