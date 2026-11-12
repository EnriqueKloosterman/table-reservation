# Feature Specification: Customer Booking Interface

**Feature Branch**: `005-customer-booking-ui`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Build the customer-facing web interface for the table reservation system. The backend (features 001 to 004) is complete and documented through its OpenAPI contract. This feature is the customer side only: the staff panel is a later feature. It lives in frontend/ and uses the public operations of the backend only; no customer accounts." (full booking flow, cancellation flow and quality requirements as given by the user)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Book a table (Priority: P1)

A customer opens the site, chooses a date and a party size, and sees the times that can be booked that day, grouped by service period (for example Lunch and Dinner). They pick a time, enter their name, email and phone number, and confirm. They then see a confirmation with the date, start time, end time, party size and the guest name, together with a note that an email with the way to cancel is on its way.

**Why this priority**: Booking is the reason the interface exists. Without it, the backend is only usable by technical people. It alone is a viable MVP.

**Independent Test**: With a test double standing in for the restaurant's server returning bookable times and a successful reservation, a user can choose date and party size, pick a time, fill in the three fields and reach the confirmation screen showing the right values.

**Acceptance Scenarios**:

1. **Given** the customer is on the booking page, **When** they choose a date and a party size, **Then** the bookable times for that day appear grouped under the name of their service period, in chronological order, and only periods that have at least one time are shown.
2. **Given** times are shown, **When** the customer picks one, **Then** a details form with name, email and phone number appears, with the chosen date, time and party size visible, and the customer can change the time without retyping their details.
3. **Given** the form is filled with valid values, **When** the customer confirms, **Then** the reservation is made and a confirmation shows the date, start time, end time, party size and guest name, and states that an email with the way to cancel is on its way.
4. **Given** the customer submits invalid or missing values, **When** the server or the form rejects them, **Then** each field shows its own problem next to it, in plain words, and the values already typed are kept.
5. **Given** a confirmation is shown, **When** the customer wants to book again, **Then** they can start a new booking from the confirmation screen, with an empty form.
6. **Given** the reservation was made, **When** the confirmation is displayed, **Then** the secret code returned by the server is never shown on screen and is not kept anywhere after the confirmation (the customer gets it only by email).

---

### User Story 2 - Understand why nothing can be booked, and recover from refusals (Priority: P2)

When the chosen day has no bookable times, the customer sees the reason in plain words and can try another date or party size. When confirming fails for a business reason (the time was taken in the meantime, the same email already holds an overlapping reservation, the day became unavailable), the customer is told clearly what happened and what they can do next.

**Why this priority**: A booking page that fails silently or with technical wording loses customers. This turns every refusal into a next step, but it only matters once the happy path exists.

**Independent Test**: With the test double returning each documented reason for "no times" and each documented refusal on confirm, check that each produces its own distinct, plain message and the offered next step.

**Acceptance Scenarios**:

1. **Given** a day with no bookable times, **When** the answer says why, **Then** the customer sees a message specific to that reason: closed that day (a holiday or special closure, or the weekday the restaurant is normally closed), too soon to book, too far ahead to book, party too large, or fully booked. Each message is distinct and the customer can change the date or party size right there.
2. **Given** the customer confirms a time, **When** the server says it is no longer available, **Then** the customer is told that time was just taken, sees a refreshed list of times for the same date and party size, and the name, email and phone typed so far are still in the form.
3. **Given** the refreshed list still contains the same time (it was freed), **When** the customer looks at it, **Then** they can pick it again; if the refreshed list is empty, the reason for it is shown as in scenario 1.
4. **Given** the same email already holds an overlapping reservation, **When** the customer confirms, **Then** they are told clearly that this email already has a reservation around that time, and that they can choose another time or contact the restaurant; nothing is created.
5. **Given** any other documented refusal for the confirm step (for example the day is now closed or outside service hours), **Then** the customer sees a message specific to that case, never a generic "error".

---

### User Story 3 - Cancel a reservation from the email link (Priority: P2)

The customer opens the link in the confirmation email. The page reads the secret code from the link, removes it from the address bar, and asks the customer to confirm. Nothing is cancelled until the customer presses an explicit button. The page then shows a clear outcome: cancelled, already cancelled, cannot be cancelled because the reservation has started or ended, or not found.

**Why this priority**: Cancelling is the promise made in the confirmation. It is independent of booking in the interface (it only needs a link) and safe by design, but a reservation can be made without it.

**Independent Test**: Open the cancellation page with a code in the link using a test double for the server; verify the address bar no longer contains the code, that no cancellation request was sent until the button was pressed, and that each of the four outcomes is shown after pressing it.

**Acceptance Scenarios**:

1. **Given** the customer opens the link with a code, **When** the page loads, **Then** the code is no longer visible in the address bar, no cancellation has been requested, and the page offers a clearly labelled button to cancel the reservation.
2. **Given** the cancellation page with a code, **When** the customer presses the button, **Then** the reservation is cancelled and the page shows that it was cancelled, with the date, start time, end time and party size.
3. **Given** the reservation was already cancelled, **When** the customer presses the button, **Then** the page says it was already cancelled (and that nothing more is needed).
4. **Given** the reservation has started or ended, **When** the customer presses the button, **Then** the page says it can no longer be cancelled online because the reservation time has started or passed.
5. **Given** the code matches no reservation, **When** the customer presses the button, **Then** the page says the reservation was not found and suggests checking the link in the email or typing the code again.
6. **Given** the customer opens the cancellation page without a code in the link, **When** the page loads, **Then** it explains that the code is missing and offers a field to type or paste it by hand, followed by the same explicit confirmation button.
7. **Given** the page is reloaded after the code was removed from the address bar, **When** it loads again, **Then** it behaves as having no code and offers the manual field (the code is not kept anywhere).
8. **Given** the customer presses the button twice quickly, **When** the answers come back, **Then** only one request is made, and the page shows one final outcome.

---

### User Story 4 - Dependable on any device and for everyone (Priority: P3)

The whole interface works on a 360 px wide phone up to a desktop screen, can be operated entirely with the keyboard, announces errors and status changes to assistive technology, and handles slow or failing connections gracefully.

**Why this priority**: These qualities apply to every screen, so they are verified across stories rather than delivered alone; they are listed separately so they are tested explicitly.

**Independent Test**: Run each screen at 360 px and at desktop width, complete both flows with the keyboard only, and simulate loading, server failure and unreachable server on every screen that depends on the server.

**Acceptance Scenarios**:

1. **Given** a screen 360 px wide, **When** the customer completes a booking or a cancellation, **Then** nothing is cut off, no horizontal scrolling is needed, and every control can be used.
2. **Given** only a keyboard, **When** the customer books and cancels, **Then** every control is reachable and usable, the focus order follows the visual order, and focus is moved to the new content (the form, the confirmation, the outcome) when a step changes.
3. **Given** a screen reader, **When** a validation error or a status change (loading finished, times refreshed, outcome shown) happens, **Then** it is announced without the customer having to search for it, and every field has a visible label.
4. **Given** any screen that depends on the server, **When** a request is in progress, fails, or cannot reach the server, **Then** the customer sees respectively a loading indication, a plain explanation with a way to retry, or a message that the server cannot be reached, and never sees technical details (codes, stack traces, raw server messages, addresses).
5. **Given** a missing or invalid configuration of the server address, **When** the application starts, **Then** the customer sees a clear "service not available" screen instead of a broken page.

---

### Edge Cases

- **Double submission**: double click, pressing Enter twice, or retrying while the first request is in flight sends only one request; the confirm button is disabled and says it is working. After a failed response, the customer can submit again.
- **Lost answer after a possible success**: if the connection fails after the customer confirmed (so the outcome is unknown), the customer is told the result is unknown, that a confirmation email may already be on its way, and to check their inbox before trying again; a retry that finds the email already holds the reservation shows the "already reserved" message of Story 2, and no second reservation is created.
- **Server error on confirm (unexpected failure)**: the customer is told the reservation could not be completed and to check their email before trying again, not blamed for a validation error.
- **Dates**: past dates cannot be picked from the date control; a date typed by hand that is invalid or in the past shows a field error. Today is the restaurant's today as the server sees it, so "too soon" and "too far ahead" come from the server, not from guesses in the browser.
- **Party size**: only whole numbers from 1 to 50 are accepted; anything else is a field error before any request. Larger parties than the restaurant can seat get the "party too large" explanation from the server, with a suggestion to contact the restaurant.
- **Changing date or party size while times are loading or after choosing a time**: the earlier answer is discarded, the chosen time is cleared, a late answer for an earlier choice never overwrites the current one.
- **Phone and email edge values**: spaces around values are ignored; phone numbers accept digits, spaces, hyphens, parentheses and an optional leading plus, 7 to 20 characters; email must have a valid single address (no display name, no lists). The names of the fields in errors match what the customer sees.
- **Day-light-saving change days**: the end time shown is the one returned by the server, not computed.
- **Time zone of the visitor**: all dates and times are displayed exactly as the server returns them (restaurant-local), even when the visitor is in a different time zone; the interface never converts them.
- **Cancellation link opened twice**: the second time the code is no longer in the address bar of the same tab and the page offers the manual field; in a new tab opened from the email, the link works again and ends in "already cancelled" if applicable.
- **Cancellation code typed by hand**: leading and trailing spaces from copy-paste are ignored; an empty field cannot be submitted.
- **Page opened by a browser prefetch or link scanner**: nothing is cancelled because the cancellation only happens after an explicit button press.
- **Browser back/forward and reload during the booking flow**: reloading the booking page starts a fresh booking; going back from the confirmation does not resubmit.
- **Unknown or new reasons from the server**: if the server returns a reason or error the interface does not know, the customer sees a generic but plain message with a way to retry, never the raw value.

## Requirements *(mandatory)*

### Functional Requirements

**Booking: choosing a time**

- **FR-001**: The customer MUST be able to choose a date and a party size (whole number 1–50) and see the bookable times for that day.
- **FR-002**: Times MUST be grouped by service period, using the period names as returned by the server, in the order returned, and only periods with at least one time MUST appear.
- **FR-003**: Times MUST refresh automatically when the date or party size changes, and a late answer to an earlier choice MUST never replace the answer to the latest choice.
- **FR-004**: When no time is bookable, the interface MUST show a plain-words reason specific to each of the reasons the server can give for an empty day (closed on that date, closed that weekday, too soon, too far ahead, party too large, fully booked, and outside service hours when applicable), and MUST let the customer change the date or party size without leaving the page.
- **FR-005**: Choosing a time MUST be a deliberate selection that is visible (which time is selected) and changeable before confirming.

**Booking: details and confirmation**

- **FR-006**: The customer MUST be asked for name, email and phone number, each with a visible label, and MUST be able to review the chosen date, time and party size before confirming.
- **FR-007**: Each field MUST show its own validation problem next to it, in plain words, using the same limits as the server (name 1–100 characters after trimming; valid single email up to 254 characters; phone 7–20 characters made of digits, spaces, hyphens, parentheses and an optional leading plus, with at least 7 digits). Problems reported by the server for a field MUST be shown next to that field.
- **FR-008**: On success, the interface MUST show the date, start time, end time, party size and guest name as returned by the server, and MUST tell the customer an email with the way to cancel is on its way.
- **FR-009**: The secret cancellation code returned on success MUST NOT be displayed, stored, logged or put in the address, and MUST be discarded as soon as the confirmation is shown.
- **FR-010**: While a confirmation request is in progress, further submissions MUST be impossible; a double click, a repeated Enter or a retry in flight MUST send exactly one request.
- **FR-011**: If the server says the chosen time is no longer available, the interface MUST say so, MUST reload the times for the same date and party size, MUST clear only the selected time, and MUST keep the details already typed.
- **FR-012**: If the server says the same email already holds an overlapping reservation, the interface MUST say so clearly, and MUST NOT create anything or reveal any information about the existing reservation.
- **FR-013**: Every other documented refusal and error of the confirm step MUST have its own plain, specific message and next step; unexpected failures MUST show a general message with a way to retry.
- **FR-014**: When the outcome of a confirmation is unknown (connection lost after sending), the interface MUST say so and advise checking email before trying again, rather than claiming success or failure.
- **FR-015**: From the confirmation, the customer MUST be able to start a new booking; the previous guest details MUST NOT remain in the form.

**Cancellation**

- **FR-016**: The cancellation page MUST read the secret code from the fragment of the link, MUST remove it from the address bar immediately after reading, MUST keep it only in memory, and MUST NOT write it to storage, logs, analytics or the address query.
- **FR-017**: Opening the cancellation page MUST NOT cancel anything; cancelling MUST require an explicit press of a clearly labelled confirmation button, and MUST send at most one request per press while one is in progress.
- **FR-018**: The page MUST show a distinct, plain outcome for each of: cancelled (with date, start time, end time and party size), already cancelled, cannot be cancelled because the reservation has started or ended, and not found.
- **FR-019**: When the link has no code, the page MUST say so and MUST offer a field to type or paste the code, trimmed of surrounding spaces, with the same explicit confirmation button; the field MUST NOT be submittable when empty.
- **FR-020**: The code typed by hand MUST be treated like a code from the link: kept only in memory, never stored or logged, and cleared from the field after the outcome is final.
- **FR-021**: After any final outcome, the customer MUST have a way to go to the booking page.

**Navigation and structure**

- **FR-022**: The interface MUST offer two destinations to the customer: the booking page and the cancellation page. The cancellation page MUST be reachable by the exact address used in the email link.
- **FR-023**: The interface MUST use only the public operations of the server and MUST NOT require or offer any sign-in or customer account.

**Quality**

- **FR-024**: Every screen MUST be usable from a 360 px wide display up to a desktop display, without horizontal scrolling of the page.
- **FR-025**: Every control MUST be reachable and operable using only a keyboard; every form field MUST have an associated visible label; focus MUST move to the new content when a step changes (form shown, confirmation shown, outcome shown).
- **FR-026**: Validation errors and status changes (loading complete, times refreshed, outcome shown, request failed) MUST be announced to assistive technology; colour MUST NOT be the only way of conveying an error or a selection, and contrast MUST be sufficient for normal text.
- **FR-027**: Every screen that depends on the server MUST have explicit loading, empty (where applicable), error and server-unreachable states; the unreachable state MUST be distinguishable from the server-error state and MUST offer a retry.
- **FR-028**: The customer MUST NEVER be shown technical details: error codes, status numbers, stack traces, raw server messages, internal reasons, field paths, or server addresses.
- **FR-029**: Dates and times MUST be displayed exactly as the server returns them (restaurant-local), without conversion to the visitor's time zone, and in an unambiguous format (24-hour times).
- **FR-030**: If the server's address is missing or invalid in the configuration, the application MUST show a clear "service not available" screen instead of a broken page.
- **FR-031**: All text shown to the customer MUST be in English; the interface MUST NOT include a language switcher.

### Key Entities *(include if feature involves data)*

- **Booking request (in progress)**: the customer's choices and details while booking: date, party size, selected time, name, email, phone. Exists only on screen; discarded on completion.
- **Bookable times**: for a date and party size, an ordered list of service periods each with a name and a list of start times; or, when empty, the reason it is empty.
- **Reservation confirmation**: what the customer sees after a successful booking: date, start time, end time, party size, guest name. The secret code is never part of what is kept or shown.
- **Cancellation code**: a secret received by email; held in memory on the cancellation page only until the outcome is final.
- **Cancellation outcome**: one of cancelled (with date, start, end, party size), already cancelled, cannot be cancelled, not found, or a temporary failure (server error or unreachable).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time customer on a phone can go from the opening of the booking page to a confirmed reservation in under 2 minutes, with no instructions, in at least 9 out of 10 usability test runs.
- **SC-002**: After changing the date or party size, the new times (or the reason for none) are shown within 2 seconds in normal conditions.
- **SC-003**: Every one of the documented reasons for an empty day, and every documented refusal on confirm and on cancel, produces its own distinct message, verified by an automated test per reason, and no screen shows a code, a status number or a raw server message.
- **SC-004**: In 100 % of tests with double click, repeated Enter or repeated cancel presses, exactly one request is sent and at most one reservation is created or one cancellation requested.
- **SC-005**: In 100 % of tests, opening the cancellation page sends no cancellation request, and the secret code is absent from the address bar from the moment the page is displayed.
- **SC-006**: Both flows can be completed using only the keyboard, and show no horizontal scrolling at 360 px wide, as verified by an automated check on every screen and a manual check before release.
- **SC-007**: The interface passes an automated accessibility check with zero serious or critical violations on every screen and state (loading, empty, error, unreachable, success).
- **SC-008**: When a chosen time is taken in the meantime, 100 % of the details typed (name, email, phone) are still in the form after the times refresh.
- **SC-009**: With the server stopped, every screen shows the "cannot reach the server" message within 10 seconds, with a retry control, and no blank or broken page.
- **SC-010**: Every time displayed matches exactly the value returned by the server, also when the browser runs in a different time zone, as verified by a test in at least two time zones.

## Assumptions

- The interface is a separate web application in the repository's `frontend/` folder, as the project constitution requires; the backend is not changed in any way.
- Only the public operations of the backend are used: looking up bookable times, creating a reservation and cancelling with a code. No operation requiring sign-in is used.
- The reasons for empty days and the refusal codes that the backend documents (in its published API description) are the closed set the interface must handle; a reason the interface does not recognize gets a generic plain message.
- Restaurant name, opening hours and period names are not hard-coded: periods come from the server, and the interface shows no opening-hours page or restaurant presentation in this feature beyond a simple title.
- The language of the interface is English (consistent with the emails sent by the backend); other languages are out of scope.
- The date control only offers the restaurant's "today" onward based on the visitor's clock as a convenience; the server remains the authority for "too soon" and "too far ahead".
- The cancellation link is of the form `<site address>/<cancellation page path>#code=<code>`; the exact path is chosen in the plan and the backend's configured link base is set to match (configuration, not a code change).
- There is no way to retrieve a lost secret code, as the backend never returns it again; a customer who lost the email contacts the restaurant. The interface does not promise otherwise.
- The retry of a booking whose answer was lost is treated by the backend as a duplicate; the interface explains this in plain words, since the backend has no way to repeat a request safely.
- Users have a modern browser (current versions of the major ones, desktop and mobile) and an internet connection; offline use is out of scope.
- Out of scope: the staff panel, customer accounts, modifying or moving a reservation, payments, multiple languages, offline use, analytics, and any change to the backend.
