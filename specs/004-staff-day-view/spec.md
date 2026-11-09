# Feature Specification: Staff Day View of Reservations

**Feature Branch**: `004-staff-day-view`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Add the staff view of the day's reservations to the backend of the table reservation system. Features 001 (staff access, tables, weekly service hours, closed dates), 002 (availability lookup and guest reservations) and 003 (confirmation email and cancellation) are already implemented; this feature builds on them. It is read-only: it adds no way to modify or move a reservation. Day view for a restaurant-local date in chronological order with full reservation details, a status filter (confirmed by default, optionally including or showing only cancelled), a daily summary (reservations, guests, tables used, confirmed only), a single-reservation read by identifier, staff-only access with the secret code never returned, and the inherited API quality rules."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Staff see the day's reservations (Priority: P1)

A signed-in staff member asks for the reservations of one restaurant-local date and gets them in chronological order, each with the guest's contact details, the party size and the assigned table's name, plus a small summary of the day (number of reservations, total guests, number of tables used). By default only confirmed reservations are listed.

**Why this priority**: This is the core value: staff can finally see who is coming, when, and where they sit, which is the daily working need of running the restaurant.

**Independent Test**: Create several confirmed reservations on one date (different times, party sizes, tables) and on other dates, sign in as staff, request that date, and check that exactly that day's reservations appear in start-time order with all fields and a summary matching the list.

**Acceptance Scenarios**:

1. **Given** confirmed reservations on a date, **When** staff request that date, **Then** all of them are returned ordered by start time, each with identifier, status, date, start and end time (restaurant-local), party size, guest name, guest email, guest phone, table name and creation time.
2. **Given** the same list, **When** it is returned, **Then** the summary states the number of reservations, the sum of their party sizes and the number of distinct tables with at least one reservation.
3. **Given** reservations on other dates, **When** staff request one date, **Then** none of the other dates' reservations appear.
4. **Given** a date with no reservations, **When** staff request it, **Then** the answer is successful, with an empty list and a summary of zeros.
5. **Given** a past date or a date far in the future, **When** staff request it, **Then** it is answered like any other date (no refusal for being past or distant).
6. **Given** two reservations with the same start time, **When** the day is listed, **Then** their relative order is stable and repeatable between requests.

---

### User Story 2 - Staff include or isolate cancelled reservations (Priority: P2)

Staff can choose to also see cancelled reservations of the day, or to see only the cancelled ones. For a cancelled reservation they see when it was cancelled and by whom (guest or staff).

**Why this priority**: Useful for understanding no-shows, closures and last-minute changes, but the day is already operable with confirmed reservations alone.

**Independent Test**: Create reservations, cancel one as a guest and one as staff, then request the same date three ways (default, including cancelled, only cancelled) and check the contents and the cancellation details.

**Acceptance Scenarios**:

1. **Given** a day with confirmed and cancelled reservations, **When** staff request it without a status choice, **Then** only confirmed reservations are listed.
2. **Given** the same day, **When** staff ask to include cancelled reservations, **Then** both kinds are listed together in chronological order.
3. **Given** the same day, **When** staff ask for only cancelled reservations, **Then** only cancelled ones are listed.
4. **Given** any of the three choices, **When** the summary is returned, **Then** it counts confirmed reservations only, so it is identical in all three cases.
5. **Given** a cancelled reservation, **When** it is listed, **Then** it shows the moment of cancellation and who cancelled it (guest or staff); a confirmed reservation shows neither.
6. **Given** a reservation whose table was removed after the reservation ended, **When** it is listed or read, **Then** it still shows the name the table had when it was assigned.

---

### User Story 3 - Staff inspect one reservation by identifier (Priority: P2)

Staff read a single reservation by its identifier, with the same details as in the day view, so that identifiers found in the affected-reservation reports of feature 002 or in the day view can be inspected before being cancelled with the staff cancellation of feature 003.

**Why this priority**: It closes the closure-handling workflow (report, inspect, cancel) but depends on no other story to be useful.

**Independent Test**: Take an identifier from an affected-reservation report, read it as staff, check the details, then cancel it with the feature 003 operation and read it again to see status "cancelled" with the cancellation details.

**Acceptance Scenarios**:

1. **Given** an existing reservation of any status and date, **When** staff read it by identifier, **Then** all the details of the day view are returned for it.
2. **Given** a cancelled reservation, **When** staff read it, **Then** the cancellation moment and who cancelled it are included.
3. **Given** an identifier that matches no reservation (including a malformed one), **When** staff read it, **Then** the standard "not found" answer is returned.

---

### User Story 4 - Guest data stays private and secrets stay secret (Priority: P1)

Guest contact details are visible only to signed-in staff. Without a valid staff sign-in, neither operation reveals anything, and in no case is the secret cancellation code, or its stored form, returned.

**Why this priority**: The operations expose personal data; the access rule is a precondition for releasing them.

**Independent Test**: Call both operations with no sign-in, a malformed token and an expired token, and check each is refused with the standard authentication error and no data. Then inspect every successful response for any trace of the code or its stored form.

**Acceptance Scenarios**:

1. **Given** no credentials, a malformed credential or an expired one, **When** either operation is called, **Then** the standard authentication error is returned and nothing is read.
2. **Given** a valid sign-in, **When** any reservation is returned, **Then** the response contains no secret code and no stored form of it.
3. **Given** a request with invalid input and no sign-in, **When** it is made, **Then** the authentication error wins (sign-in is checked before input).

---

### User Story 5 - Discoverable, consistent operations (Priority: P3)

The two operations appear in the interactive documentation with their inputs, a request example, and every response, marked as requiring staff sign-in. They follow the same error structure and strictness as the rest of the system.

**Why this priority**: Documentation and consistency make the operations usable by the future interface team, but do not change behaviour.

**Independent Test**: Open the documentation and check that both operations list all their responses with examples; send invalid requests and check that every problem is reported at once.

**Acceptance Scenarios**:

1. **Given** the documentation, **When** a reader looks up either operation, **Then** it is marked as requiring sign-in and shows a request example and every possible response.
2. **Given** a day request with a missing or invalid date and an invalid status choice, **When** it is sent, **Then** one validation error lists both offending fields.
3. **Given** a request carrying a query parameter the operation does not define, **When** it is sent, **Then** it is refused with a validation error naming the parameter.

---

### Edge Cases

- A date that is not a real calendar date (for example 30 February), has the wrong format, or is missing: validation error naming the date field.
- A reservation appears under the restaurant-local date it was made for, never the UTC date, including for evening reservations that fall on the next UTC day.
- A day on which the restaurant is closed, or outside service hours: answered normally (empty, or listing any existing reservations, such as ones cancelled by staff after a closure was added).
- A day that has only cancelled reservations: the default view is empty with zero summary; the cancelled ones appear only when asked.
- Several reservations on the same table on the same day count as one table in the summary.
- A day with a very large number of reservations: all are returned in one answer; there is no paging.
- A reservation cancelled between two requests changes lists and summary accordingly; each answer is a consistent snapshot of the moment it is made.
- Reading a reservation whose table has been removed: still returns the table name recorded at assignment.
- Repeating any request any number of times changes nothing in the system.

## Requirements *(mandatory)*

### Functional Requirements

**Day view**

- **FR-001**: Signed-in staff MUST be able to request the reservations of one restaurant-local date, through `GET /reservations` with the required `date` query parameter (`YYYY-MM-DD`, a real calendar date), and receive them ordered by start time ascending, ties broken in a stable, repeatable way.
- **FR-002**: Each reservation in the list MUST show: identifier, status ("confirmed" or "cancelled"), date, start time and end time (restaurant-local), party size, guest name, guest email, guest phone, the assigned table's name, creation time (ISO-8601 UTC), and, only when cancelled, the cancellation moment (ISO-8601 UTC) and who cancelled it ("guest" or "staff").
- **FR-003**: The status choice MUST be an optional `status` query parameter with exactly three accepted values: `confirmed` (the default when omitted), `all` (confirmed and cancelled) and `cancelled` (cancelled only).
- **FR-004**: A reservation MUST always show the table name it was assigned, even if that table was removed afterwards; removing a table MUST NOT change what previously assigned reservations display.
- **FR-005**: The answer MUST include a summary for the day with: number of reservations, total guests (sum of party sizes) and number of distinct tables with at least one reservation. The summary MUST count confirmed reservations only, regardless of the status choice, and MUST be consistent with the list returned when the choice is `confirmed`.
- **FR-006**: Any valid date MUST be accepted, past or future, with no limit; a date with no matching reservations MUST give a successful answer with an empty list and a summary of zeros.
- **FR-007**: The date of a reservation MUST be understood in the restaurant's time zone, consistent with features 001 to 003.

**Single reservation**

- **FR-008**: Signed-in staff MUST be able to read one reservation by identifier, through `GET /reservations/{id}`, receiving the same details as FR-002, for any status and any date. An unknown or malformed identifier gives the standard "not found" answer, as in feature 003.
- **FR-009**: Identifiers listed by the affected-reservation reports of feature 002 and by the day view MUST be accepted by this operation and by the staff cancellation of feature 003.

**Privacy and security**

- **FR-010**: Both operations MUST require the staff sign-in of feature 001 and never be public. Missing, malformed or expired credentials MUST be refused with the standard authentication error before anything is read and before any other validation.
- **FR-011**: The secret cancellation code and its stored form MUST NOT appear in any response of these operations.
- **FR-012**: Responses of these operations contain personal data and MUST NOT be cached by clients or intermediaries.

**Read-only**

- **FR-013**: Both operations MUST change nothing: no reservation, table, schedule, closed date, hold or email is created, altered or removed by calling them. This feature adds no way to modify or move a reservation.

**API quality (inherited)**

- **FR-014**: The operations MUST follow the inherited API rules: the standard error structure, correct HTTP status per outcome (400 invalid input, 401 missing or invalid sign-in, 404 not found, 500 internal failure), validation before any read, all offending fields reported at once, and unknown query parameters refused. Checks run in this order: route match, sign-in, validation, not found.
- **FR-015**: The interactive documentation MUST describe both operations, marked as requiring sign-in, with their inputs, the status choices, a request example and every response (success and each error).

### Key Entities

- **Reservation** (existing, now readable by staff): identifier, status, date, start and end time, party size, guest name, email and phone, assigned table (name kept as assigned), creation time, and, when cancelled, the cancellation moment and canceller. The secret code is never part of what is shown.
- **Day summary**: derived figures for one date: number of confirmed reservations, total guests, number of distinct tables used. Not stored.
- **Table name at assignment**: the name a reservation displays for its table, preserved independently of later table removal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a day with a known set of reservations, 100% of listed reservations are the right ones, in start-time order, with every required field correct, verified by an automated check over at least 10 reservations on one date plus others on neighbouring dates, including evening times that fall on the next UTC day.
- **SC-002**: The summary equals the figures computed independently from the confirmed reservations in 100% of checks, and is identical under all three status choices.
- **SC-003**: 100% of requests without valid sign-in (none, malformed, expired) are refused with the standard authentication error for both operations, verified by an automated check.
- **SC-004**: No response of either operation contains the secret code or its stored form, verified by an automated check across all statuses.
- **SC-005**: After removing a table from a past reservation, 100% of reads still show the originally assigned table name.
- **SC-006**: Empty days, past dates and far-future dates give successful empty answers with zero summary in 100% of checks.
- **SC-007**: A staff member can go from an affected-reservation report to the inspected and then cancelled reservation using only returned identifiers, verified end to end in an automated check.
- **SC-008**: An automated check comparing the full stored state before and after many calls of both operations finds zero differences.
- **SC-009**: Both operations appear in the documentation as requiring sign-in with a request example and every response described.
- **SC-010**: 95% of responses arrive in under 1 second under the normal load defined in feature 002 SC-006 (up to 10 concurrent requests against 100 tables, one weekly schedule, 500 closed dates and 10,000 reservations), for a day with up to 200 reservations.

## Assumptions

- Features 001 to 003 are in place; their rules (standard error structure, staff sign-in, restaurant time zone, reservation duration, statuses, table naming) are reused unchanged unless stated here.
- A reservation's table name is kept with the reservation at assignment time (or an equivalent that survives table removal); if existing stored reservations lack it, planning will decide how to provide it, since the requirement is only the visible behaviour.
- The default status choice is "confirmed only" and the summary is confirmed-only, as requested; the summary ignores the status choice by design.
- Ordering ties (same start time) are broken by a fixed secondary rule, such as table name then identifier; the exact rule is a planning detail, only stability is required.
- One day has a bounded size (a restaurant with at most a few hundred tables), so returning the whole day in one answer is acceptable; paging is out of scope.
- Staff are trusted with guest contact details; no per-staff roles or audit trail exist, as in earlier features.
- Out of scope: modifying or moving a reservation, reminders, searching by guest or by date range, exporting, pagination beyond the single day, customer accounts, rate limiting, and any user interface.
