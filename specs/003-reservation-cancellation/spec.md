# Feature Specification: Confirmation Email and Reservation Cancellation

**Feature Branch**: `003-guest-reservations` (existing branch; the spec directory is `003-reservation-cancellation`)

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Add the confirmation email and reservation cancellation to the backend of the table reservation system. Features 001 (staff access, tables, weekly service hours, closed dates) and 002 (availability lookup and guest reservations) are already implemented; this feature builds on them. The staff view of the day's reservations is a later feature and is out of scope. Confirmation email on reservation creation (never failing the reservation, failure recorded for the operator), cancellation confirmation email, guest cancellation with the secret code (public), staff cancellation (sign-in required), cancelled reservations no longer counting for availability, table assignment, duplicate check, table removal rule or affected-reservation reports, status gains a 'cancelled' value, secret code never returned again, inherited API quality rules."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Guest receives a confirmation email (Priority: P1)

When a guest reserves a table, they receive an email at the address they gave. It repeats the reservation details (date, time, party size; never the table name) and gives them a way to cancel without signing in. The secret cancellation code exists only in the creation response, so this email is the guest's lasting way to cancel.

**Why this priority**: Without the email, the guest has no durable proof of the reservation and no way to cancel it after the creation response is gone. Guest cancellation (Story 2) depends on the email carrying the cancellation means.

**Independent Test**: Can be fully tested by creating a reservation through the public operation with a test email sender, then checking that exactly one email was handed to the sender, addressed to the guest, with the correct details and a cancellation means, and without the table name. Then repeat with a sender that fails and check that the creation outcome is unchanged and the failure is recorded.

**Acceptance Scenarios**:

1. **Given** a successful reservation request, **When** the reservation is created, **Then** one confirmation email is sent to the guest's address containing the restaurant-local date, start time, party size and a way to cancel without signing in, and not containing the table name.
2. **Given** the email sender fails or is unavailable, **When** a reservation is created, **Then** the guest still receives the normal confirmation response, the reservation is stored and stays confirmed, and the failure is recorded for the operator.
3. **Given** the email sender is slow, **When** a reservation is created, **Then** the confirmation response is not delayed by the email attempt.
4. **Given** a reservation request that is refused (no availability, duplicate, invalid input), **When** it is refused, **Then** no email is sent.
5. **Given** a created reservation, **When** the email is sent, **Then** the cancellation code appears only in the means of cancelling inside the email, and is not stored in readable form anywhere.

---

### User Story 2 - Guest cancels with the secret code (Priority: P1)

A guest who holds the secret code from their confirmation email cancels the reservation without signing in. The table and the guest's time slot are freed immediately: the time becomes bookable by others and the same guest can book again. The guest receives a cancellation confirmation email.

**Why this priority**: Letting guests release tables they will not use is the main business value of this feature; it keeps tables from being blocked by reservations nobody will honour.

**Independent Test**: Can be fully tested by creating a reservation, cancelling it with its code, and confirming that the reservation shows status "cancelled", that availability for that time again lists the table, that the same email can reserve the same time again, and that a cancellation email was sent.

**Acceptance Scenarios**:

1. **Given** a confirmed reservation that has not started, **When** anyone presents its correct secret code, **Then** the reservation becomes "cancelled", the response says so, and a cancellation confirmation email is sent to the guest.
2. **Given** a just-cancelled reservation, **When** availability or the list of bookable times is requested for its slot, **Then** the freed table counts again as if the reservation had never existed.
3. **Given** a just-cancelled reservation, **When** the same guest email requests a reservation overlapping the cancelled one, **Then** it is not refused as a duplicate.
4. **Given** a reservation that is already cancelled, **When** its code is presented again, **Then** the answer clearly says it is already cancelled, nothing changes, and no second email is sent.
5. **Given** a reservation that has already started or ended, **When** its code is presented, **Then** the cancellation is refused with a clear "cannot be cancelled" answer and the reservation is unchanged.
6. **Given** a code that matches no reservation (wrong, malformed, or never issued), **When** it is presented, **Then** the answer is the same single generic "not found" response in every case, revealing nothing about whether any reservation exists.
7. **Given** the cancellation email fails to send, **When** a reservation is cancelled, **Then** the cancellation still succeeds, the guest still gets the normal response, and the failure is recorded for the operator.

---

### User Story 3 - Staff cancels an upcoming reservation (Priority: P2)

Signed-in staff can cancel any upcoming reservation, for example when the restaurant must close unexpectedly. The guest is notified by the cancellation email. This completes the workflow from feature 002, where configuration changes only report affected reservations without changing them: staff now act on that report.

**Why this priority**: It is essential for handling closures, but guests being able to cancel and be notified (Stories 1 and 2) already makes the system usable, and the restaurant can run without staff cancellation for a while.

**Independent Test**: Can be fully tested by creating reservations, adding a closed date as staff (receiving the list of affected reservations), cancelling each listed reservation as staff, and confirming each is "cancelled", frees its table, notifies its guest, and no longer appears in later affected-reservation reports.

**Acceptance Scenarios**:

1. **Given** a signed-in staff member and an upcoming confirmed reservation, **When** staff cancel it by its identifier, **Then** it becomes "cancelled", the table and slot are freed, and the guest receives the cancellation email.
2. **Given** no sign-in or an invalid sign-in, **When** the staff cancellation is attempted, **Then** it is refused with the standard authentication error and nothing changes.
3. **Given** a reservation that has already started or ended, or is already cancelled, **When** staff try to cancel it, **Then** the answer is the same clear outcome as for guests (cannot be cancelled / already cancelled) and nothing changes.
4. **Given** an identifier that matches no reservation, **When** staff try to cancel it, **Then** the answer is "not found".
5. **Given** staff just added a closed date that contradicts upcoming reservations, **When** they cancel those reservations, **Then** a later configuration change no longer lists them as affected.
6. **Given** the cancellation email fails, **When** staff cancel a reservation, **Then** the cancellation still succeeds and the failure is recorded for the operator.

---

### User Story 4 - Cancelled reservations leave every existing rule (Priority: P2)

A cancelled reservation stops counting everywhere feature 002 counted reservations, while staying stored with its status for history.

**Why this priority**: It is what makes cancellation actually free resources; each story above depends on it, and it must be verified rule by rule.

**Independent Test**: Can be fully tested by cancelling a reservation and checking, one rule at a time, that availability, table assignment, the duplicate check, the table-removal rule and the affected-reservation lists ignore it, while the stored record still exists with status "cancelled".

**Acceptance Scenarios**:

1. **Given** the only suitable table was held by a now-cancelled reservation, **When** a new reservation is requested for that time, **Then** it succeeds and the table is assigned to it.
2. **Given** a table whose only upcoming reservation was cancelled, **When** staff remove the table, **Then** the removal is allowed.
3. **Given** a cancelled reservation, **When** staff change the schedule, add a closed date or update a table, **Then** the cancelled reservation is not listed among the affected reservations.
4. **Given** a cancelled reservation, **When** it is looked at in storage, **Then** its details and the table it had remain, with status "cancelled" and the moment of cancellation.
5. **Given** a reservation cancelled by the guest or by staff, **When** the record is kept, **Then** it is possible to tell which of the two cancelled it.

---

### User Story 5 - Discoverable cancellation operations (Priority: P3)

A future customer interface or integrator can find the new operations in the interactive documentation, with public operations (guest cancellation) clearly distinguished from staff operations (staff cancellation), and with every outcome described.

**Why this priority**: It is a quality attribute of the other stories, but it lets the customer interface be built without guesswork.

**Independent Test**: Can be fully tested by opening the documentation, confirming both cancellation operations are listed, one marked public and one marked as requiring staff sign-in, with all responses described, and executing the public one without signing in.

**Acceptance Scenarios**:

1. **Given** the interactive documentation, **When** a reader looks at the cancellation operations, **Then** each has inputs, outputs, every error response and an example request, and the public one is clearly marked as not requiring sign-in while the staff one is marked as requiring it.
2. **Given** the documentation of the reservation status, **When** a reader looks at it, **Then** it lists both "confirmed" and "cancelled".

---

### Edge Cases

- Two cancel requests for the same reservation arrive at the same moment (double click, or guest and staff together): exactly one cancellation takes effect and sends one email; the other gets the "already cancelled" answer.
- A guest cancels while a new reservation for the same slot is being requested: the new request sees either the freed table or the still-held one, never a double assignment.
- The cancellation email fails but the reservation was already cancelled: the cancellation is never undone.
- A reservation cancelled at exactly its start instant counts as started and is not cancellable.
- A malformed code, an empty code, or a code of the wrong length: all return the same generic "not found" answer, with the same shape and status as an unknown code.
- A past reservation whose table was later removed: staff cancellation of it is refused as already ended, not as a missing table.
- A staff member cancels a reservation whose guest has since reserved again at the same time: the other reservation is untouched.
- The guest's email address is undeliverable: sending fails, the failure is recorded, the reservation outcome is unaffected.
- Cancelling a reservation whose confirmation email was never delivered works the same; it only needs the code.
- A staff cancellation after a guest cancellation of the same reservation gets "already cancelled" and sends no second email.

## Requirements *(mandatory)*

### Functional Requirements

**Confirmation email**

- **FR-001**: When a guest reservation is created, the system MUST send one email to the guest's address with: restaurant-local date, start and end time, party size, guest name, and a way to cancel without signing in. It MUST NOT contain the table name.
- **FR-002**: The email MUST be the only place after creation where the cancellation means (including the secret code) is available to the guest; the code MUST NOT be stored in readable form and MUST NOT be returned by any operation other than the creation response (existing rule from feature 002, preserved).
- **FR-003**: A failure to send the email (sender error, unreachable, rejected address) MUST NOT fail, undo or delay the reservation: the creation response is the same as without failure, the reservation stays confirmed, and the response does not wait for the email attempt to complete.
- **FR-004**: Every email failure MUST be recorded for the operator, identifying the kind of email (confirmation or cancellation), the reservation and a failure reason, and MUST NOT put the secret code or the full guest email address in that record.
- **FR-005**: No email is sent for a refused or failed reservation request.

**Guest cancellation (public)**

- **FR-006**: Anyone, without signing in, MUST be able to cancel a reservation by presenting its secret code. No other identification (name, email, phone, identifier) is accepted or needed.
- **FR-007**: Cancelling MUST change the reservation status from "confirmed" to "cancelled" and record the moment of cancellation and who cancelled (the guest or staff).
- **FR-008**: Cancelling MUST release the reservation's table and the guest's time slot immediately and completely, so the same time becomes bookable by others and the same guest email can book again, including an overlapping time. A cancellation that cannot release everything MUST NOT report success.
- **FR-009**: A reservation can be cancelled only before it starts: a reservation whose start time has been reached or passed (including one that has ended) MUST be refused with a clear "cannot be cancelled" outcome and remain unchanged. No minimum notice is required for cancelling.
- **FR-010**: Cancelling an already cancelled reservation MUST give a clear, harmless answer ("already cancelled" outcome, no change, no email) and MUST be safe to repeat any number of times.
- **FR-011**: A code that matches no reservation MUST produce one single generic "not found" answer, identical (status, code, message, shape) for unknown, malformed, empty or wrong-length codes, revealing nothing about whether a reservation exists. Whether the reservation is cancelled, started or ended is revealed only to a holder of its valid code.
- **FR-012**: The success response of a cancellation MUST contain the reservation identifier, status "cancelled", date, start and end time (restaurant-local), party size, and the moment of cancellation, and MUST NOT contain the secret code, its stored form or the table name.

**Staff cancellation (sign-in required)**

- **FR-013**: Signed-in staff MUST be able to cancel any upcoming reservation (not started, confirmed) by its identifier, with the same release (FR-008), the same refusals for started/ended (FR-009) and already cancelled (FR-010) reservations, and the same email (FR-014) as guest cancellation. An unknown identifier gives "not found". Staff cancellation requires the staff sign-in of feature 001 and is refused with the standard authentication errors otherwise, before any change.
- **FR-014**: When a reservation is cancelled by the guest or by staff, the system MUST send a cancellation confirmation email to the guest's address, with the same failure rule as FR-003 and FR-004: the cancellation is never undone or delayed by a failed or slow email.
- **FR-015**: Concurrent cancellations of the same reservation (any mix of guest and staff) MUST result in exactly one successful cancellation and exactly one cancellation email; the others get the "already cancelled" answer.
- **FR-016**: The staff operation MUST complete the feature 002 workflow: after staff cancel a reservation listed as affected by a configuration change, later configuration changes MUST NOT list it. Configuration changes themselves still never cancel reservations automatically.

**Interaction with existing rules**

- **FR-017**: A cancelled reservation MUST NOT count for: availability and the list of bookable times, table assignment, the duplicate-reservation check, the rule that blocks removing a table, or the list of affected reservations reported on configuration changes.
- **FR-018**: A cancelled reservation MUST remain stored with all its details, the table it had and its status "cancelled", for history. This feature never deletes reservations.
- **FR-019**: The reservation status MUST have exactly two values: "confirmed" and "cancelled". Every place that presents a reservation's status (creation response, affected-reservation lists, documentation) MUST show it accurately.
- **FR-020**: The secret code MUST remain stored only in non-reversible form and MUST never be returned again by any operation, including the cancellation operations.
- **FR-021**: Cancelling MUST NOT affect any other reservation, table, schedule or closed date.

**API quality (inherited)**

- **FR-022**: The new operations MUST follow the inherited API rules: the standard error structure, correct HTTP status per outcome, all input validated before any change, all offending fields reported at once, and unknown body fields refused. The outcomes "not found", "cannot be cancelled" and "already cancelled" MUST be distinguishable by machine-readable code.
- **FR-023**: The interactive documentation MUST describe both cancellation operations, their inputs, outputs and every error response, with an example for each request, and MUST mark the guest cancellation as public and the staff cancellation as requiring sign-in, so they are clearly distinguished.

### Key Entities

- **Reservation** (extended): gains status "cancelled" in addition to "confirmed", the moment it was cancelled and who cancelled it (guest or staff). A cancelled reservation keeps all its other data and its table.
- **Cancellation code**: the secret already defined in feature 002; its readable form is available only in the creation response and the confirmation email, and its stored form is non-reversible.
- **Time hold**: the table and guest-time-slot locks of feature 002 that prevent double booking and overlapping reservations by one guest; released when a reservation is cancelled.
- **Email notification**: a message to the guest of one of two kinds (reservation confirmation, cancellation confirmation); its failures are recorded for the operator but never change the reservation.
- **Email failure record**: an operator-facing record of a failed notification (kind, reservation, reason, time), without the secret code.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of successfully created reservations produce exactly one confirmation email with the correct date, time, party size and a way to cancel, and none contains the table name, verified by an automated check across at least 10 distinct reservations.
- **SC-002**: With the email sender forced to fail on every attempt, 100% of reservation creations and cancellations still succeed with the same responses as when it works, and 100% of failures are recorded, verified by an automated check.
- **SC-003**: A guest can cancel using only the information in the confirmation email, in a single request, and the freed time can be booked by another customer immediately afterwards, verified end to end in an automated check.
- **SC-004**: 100% of cancellation attempts with unknown, wrong, malformed or empty codes receive identical "not found" answers, verified by an automated check covering at least 5 kinds of bad codes.
- **SC-005**: With 20 simultaneous cancellation requests for the same reservation, repeated 50 times, exactly one succeeds and exactly one email is sent in every round.
- **SC-006**: After cancelling, 100% of the existing rules (availability, bookable times, assignment, duplicate check, table removal, affected-reservation lists) behave as if the reservation never existed, verified by one automated check per rule.
- **SC-007**: 100% of cancelled reservations remain stored with status "cancelled", and no operation ever returns the secret code or its stored form after creation, verified by an automated check over all operations.
- **SC-008**: 100% of staff cancellation attempts without valid sign-in are refused with no change, and 100% of cancellation attempts on started, ended or already cancelled reservations leave them unchanged, verified by an automated check.
- **SC-009**: Both cancellation operations appear in the documentation with the public/staff distinction, every response described and an example for each request.
- **SC-010**: 95% of cancellation responses arrive in under 1 second under the normal load defined in feature 002, including when the email sender is slow or failing.

## Assumptions

- Features 001 and 002 are in place; their rules (standard error structure, validation approach, staff sign-in, restaurant time zone, reservation duration, time holds, secret code in non-reversible form) are reused unchanged unless stated here.
- The cancellation cutoff, left "to be decided during clarification" in the request, is set here to the reservation's start time: cancellable strictly before it starts, never after. There is no minimum notice or cancellation fee. This matches "already ended or started cannot be cancelled".
- The way to cancel in the email is a link or equivalent carrying the secret code; where that link points (for example the future customer interface) is a configuration matter for planning. Until a customer interface exists, the code in the email is what the guest presents to the public cancellation operation.
- Emails are plain, in English, and sent through an interface that tests can replace; this specification chooses no real email provider. The restaurant name in the email comes from existing configuration if there is one, otherwise a neutral default.
- Email failures are "recorded for the operator" in the application's log output; a separate failure store, retries or an operator interface are out of scope. The record never contains the secret code and avoids the full guest email address.
- "Not delayed" means the reservation or cancellation response does not wait for the email attempt to finish; the email may complete after the response.
- Staff cancel by reservation identifier and learn identifiers from the affected-reservation lists of feature 002; a general staff listing of reservations is the later, out-of-scope feature.
- Out of scope: staff view of the day's reservations, modifying or moving a reservation, reminders, customer accounts, email verification, payments, waiting list, rate limiting, delivery tracking or retries of failed emails beyond recording the failure, and any user interface.
