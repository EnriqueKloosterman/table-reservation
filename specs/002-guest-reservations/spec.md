# Feature Specification: Availability Lookup and Guest Reservations

**Feature Branch**: `002-guest-reservations`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Add availability lookup and guest reservations to the backend of the table reservation system. Feature 001 (staff access, tables, weekly service hours, closed dates) is already implemented; this feature builds on it. Cancellation and emails come in later features and are out of scope here."

## Clarifications

### Session 2026-11-07

- Q: Must the whole reservation (start plus duration) fit inside the service period, or only its start time? → A: The whole reservation; it must start at or after the period start and end at or before the period end (dinner 20:00–23:30 with 120 minutes → last bookable start 21:30).
- Q: When a staff change contradicts an upcoming reservation (closed date added on its day, schedule change leaving it outside service hours, table capacity reduced below its party size), what happens? → A: The change is applied, the reservations stay untouched, and the response lists the affected upcoming reservations.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check whether a party can be seated (Priority: P1)

A customer, without signing in, asks whether the restaurant can seat a party of a given size on a given date and time (restaurant-local). They get a clear yes or no; when the answer is no, they also get the reason category (for example closed date, outside service hours, party too large, no table free at that time).

**Why this priority**: It is the smallest slice that turns the configuration from feature 001 into customer value, and the same availability rules are the foundation of reserving.

**Independent Test**: Can be fully tested by configuring tables, a weekly schedule and a closed date as staff, then asking the public availability question for dates and times inside and outside service hours, on the closed date, and for party sizes above the largest table, confirming each answer and reason.

**Acceptance Scenarios**:

1. **Given** tables of capacity 2, 4 and 6 and a Saturday dinner period 20:00–23:30, **When** a customer asks for a party of 4 on an upcoming Saturday at 20:30, **Then** the answer is "available".
2. **Given** the same configuration, **When** a customer asks for a party of 8, **Then** the answer is "not available" with reason "party too large".
3. **Given** an upcoming date marked as closed, **When** a customer asks for any time on that date, **Then** the answer is "not available" with reason "closed date".
4. **Given** a weekday with no service periods, **When** a customer asks for any time on that day, **Then** the answer is "not available" with reason "closed day".
5. **Given** a day with lunch 12:00–15:00 and dinner 20:00–23:30, **When** a customer asks for 17:00, **Then** the answer is "not available" with reason "outside service hours".
6. **Given** dinner 20:00–23:30 and the default 120-minute duration, **When** a customer asks for 21:30, **Then** the answer is "available"; for 21:45 it is "not available" with reason "outside service hours" because the reservation would end after the period.
7. **Given** every table that can seat the party already holds a reservation overlapping the requested time, **When** a customer asks for that time, **Then** the answer is "not available" with reason "no table free".
8. **Given** a date and time in the past, or too soon or too far ahead according to the booking window, **When** a customer asks, **Then** the answer is "not available" with the matching reason ("too soon" or "too far ahead").
9. **Given** a malformed date, an invalid time of day, or a party size that is not a whole number between 1 and 50, **When** a customer asks, **Then** the request is refused with a "validation" error identifying the field(s).

---

### User Story 2 - Reserve a table as a guest (Priority: P1)

A customer, without signing in or creating an account, reserves by providing date, time, party size, name, email and phone number. The system assigns the most suitable free table and immediately returns a confirmation with the reservation details and a secret code (to be used for cancellation in a later feature). If nothing is available, the customer is told so with the same reason categories as the availability check.

**Why this priority**: Taking reservations is the core purpose of the system; availability alone does not let the restaurant fill tables.

**Independent Test**: Can be fully tested by configuring the restaurant as staff, creating a reservation through the public operation, confirming the response contains the details, the assigned table and a secret code, and confirming that the assigned table is no longer offered for overlapping times.

**Acceptance Scenarios**:

1. **Given** free tables of capacity 2, 4 and 6, **When** a customer reserves for a party of 3 at an available time, **Then** the reservation is created, the table of capacity 4 is assigned, and the response contains the reservation identifier, date, start and end time (restaurant-local), party size, guest name, email, phone, assigned table name, and a secret code.
2. **Given** two free tables of capacity 4 named "T2" and "T10", **When** a customer reserves for a party of 4, **Then** "T2" is assigned (smallest suitable capacity first, then name in natural order).
3. **Given** a reservation holds the only table that can seat 6 from 20:00 to 22:00, **When** another customer reserves for 6 at 21:00, **Then** the request is refused with a "no availability" error and reason "no table free"; a reservation for 6 starting at 22:00 succeeds.
4. **Given** exactly one suitable free table and 20 simultaneous reservation requests for overlapping times, **When** they are processed, **Then** exactly one succeeds and the other 19 are refused with a "no availability" error and reason "no table free".
5. **Given** a request where the date is closed, the time is outside service hours, or the party is too large, **When** it is submitted, **Then** the request is refused with a "no availability" error carrying the matching reason, and no reservation is stored.
6. **Given** a missing or invalid name, email or phone number, **When** the request is submitted, **Then** it is refused with a "validation" error identifying each offending field, and no reservation is stored.
7. **Given** a created reservation, **When** the secret code is inspected, **Then** it is long and random enough not to be guessable, it appears only in this response, and it is never returned again by any later operation.

---

### User Story 3 - List bookable times for a date (Priority: P2)

A customer, without signing in, picks a date and party size and gets the list of start times at which a reservation is currently possible, grouped by service period, so they can choose one instead of guessing.

**Why this priority**: It greatly improves the booking experience, but the yes/no check and the reservation itself already make the system usable.

**Independent Test**: Can be fully tested by configuring a day with lunch and dinner, reserving some tables, and confirming that the listed times exclude exactly the times with no suitable free table and nothing outside the service periods or booking window.

**Acceptance Scenarios**:

1. **Given** a day with lunch 12:00–15:00 and free tables, **When** a customer lists times for a party of 2, **Then** the system returns the times at a fixed interval (default every 15 minutes) starting at the period start up to the last start that still ends by the period end (13:00 with the default 120 minutes), each one bookable, grouped under "Lunch".
2. **Given** the only table for 6 is reserved 20:00–22:00, **When** a customer lists times for a party of 6, **Then** no time whose reservation would overlap 20:00–22:00 is listed.
3. **Given** a closed date, a day with no service periods, or a party larger than every table, **When** a customer lists times, **Then** the list is empty and the reason is given ("closed date", "closed day" or "party too large").
4. **Given** today's date, **When** a customer lists times, **Then** only times that respect the minimum notice are listed.
5. **Given** any listed time, **When** the customer checks availability or reserves at that time with the same party size (and nothing changed in between), **Then** the answer is "available" and the reservation succeeds.

---

### User Story 4 - Configuration changes respect existing reservations (Priority: P2)

Staff keep managing tables, the weekly schedule and closed dates as in feature 001. Removing a table that still has upcoming reservations is refused, so no guest loses their table silently. Existing reservations are never changed automatically by configuration changes.

**Why this priority**: It protects reservations that customers already hold; without it, a staff action could leave a reservation pointing at nothing.

**Independent Test**: Can be fully tested by creating a reservation, attempting as staff to remove its table (refused), and removing a table with no upcoming reservations (allowed, past reservations still show their table).

**Acceptance Scenarios**:

1. **Given** a table with a reservation that has not ended yet, **When** staff remove the table, **Then** the system refuses with a "conflict" error and the table remains active.
2. **Given** a table whose reservations have all ended, **When** staff remove it, **Then** the removal succeeds as a soft delete, and those past reservations keep referring to that table.
3. **Given** a removed table, **When** customers check availability or reserve, **Then** that table is never considered.
4. **Given** existing reservations, **When** staff change the weekly schedule, add a closed date or edit a table, **Then** the change is applied and existing reservations are not modified, moved or cancelled automatically.
5. **Given** an upcoming reservation on 2026-12-24 for 6 guests at table "T5" (capacity 6), **When** staff mark 2026-12-24 as closed, change the schedule so that reservation falls outside service hours, or reduce "T5" to capacity 4, **Then** the change succeeds and its response lists that reservation as affected; a change that contradicts no upcoming reservation returns an empty list.
6. **Given** a closed date was added on the day of an upcoming reservation, **When** customers check availability for that date, **Then** the answer is "closed date", while the existing reservation remains confirmed and keeps its table.

---

### User Story 5 - Discoverable public operations (Priority: P3)

A developer opens the interactive documentation, sees the new availability and reservation operations clearly marked as not requiring sign-in, with their inputs, outputs, reason categories and error responses, and can try them directly.

**Why this priority**: It is a quality attribute of the other stories, but it is what lets the future customer interface be built without guesswork.

**Independent Test**: Can be fully tested by opening the documentation, confirming each new operation is listed and marked public, and executing an availability check and a reservation from within it without signing in.

**Acceptance Scenarios**:

1. **Given** the backend is running, **When** a developer opens the documentation, **Then** every new operation is listed with summary, description, request example, success response and every error response, and is marked as not requiring sign-in.
2. **Given** the documentation, **When** a developer executes an availability check and a reservation without signing in, **Then** both succeed.
3. **Given** any refused request of this feature, **When** the response is inspected, **Then** it uses the standard error structure from feature 001.

---

### Edge Cases

- Two reservations on the same table overlap when their time ranges intersect; a reservation ending at 22:00 and another starting at 22:00 on the same table do not overlap.
- Party size is a whole number from 1 to 50; values outside are a "validation" error, while a valid size larger than every non-removed table (including when there are no tables at all) is "party too large".
- When several reasons apply, the reported one follows this order: too soon (including past), too far ahead, closed date, closed day, outside service hours, party too large, no table free.
- Dates and times are restaurant-local. On a daylight-saving change day, a local time that does not exist (skipped hour) is "not available" with reason "outside service hours"; a local time that occurs twice is interpreted as its first occurrence.
- "Now", "today", the minimum notice and the booking horizon are evaluated in the restaurant's time zone.
- A requested time does not have to be one of the listed times; any time of day (hours and minutes) is accepted for the check and the reservation as long as all rules are met.
- The same email or phone may hold several reservations, including at the same time; no duplicate detection is performed.
- Guest email is trimmed and lowercased; guest name and phone are trimmed before storing.
- Unknown fields in the request body and unknown query parameters are refused with a "validation" error, as in feature 001.
- If the storage fails after availability was confirmed but before the reservation is stored, no partial reservation remains and the customer gets an "internal error".
- Availability answers are a snapshot: a time reported as available may be taken by someone else before the customer reserves; the reservation then fails with "no table free".

## Requirements *(mandatory)*

### Functional Requirements

**Availability rules**

- **FR-001**: The system MUST decide availability for a restaurant-local date, start time and party size using only: the weekly service hours, the closed dates, the non-removed tables and their current capacity, and the existing reservations.
- **FR-002**: A reservation occupies its table for a fixed duration (setup-time configuration, default 120 minutes) starting at the requested time. The whole reservation MUST fall inside one service period of that day: it starts at or after the period start and ends at or before the period end; otherwise the reason is "outside service hours".
- **FR-003**: The restaurant MUST be unavailable on closed dates and on days of the week with no service periods.
- **FR-004**: A reservation MUST start at least the minimum notice after the current time (setup-time configuration, default 60 minutes) and no later than the booking horizon (setup-time configuration, default 60 days from today, inclusive).
- **FR-005**: A party is seatable at a time when at least one non-removed table has capacity greater than or equal to the party size and holds no reservation overlapping the requested time range.
- **FR-006**: When the answer is "not available", the system MUST give exactly one reason from this fixed set: too soon, too far ahead, closed date, closed day, outside service hours, party too large, no table free, chosen by the order defined in Edge Cases.

**Availability lookup (public)**

- **FR-007**: Anyone, without signing in, MUST be able to check availability for a date (`YYYY-MM-DD`), a time (`HH:mm`) and a party size, receiving a yes/no answer and, when no, the reason. Echoing the requested date, time and party size in the answer is required; the table that would be assigned is NOT revealed.
- **FR-008**: Anyone, without signing in, MUST be able to list bookable start times for a date and party size. Times are generated at a fixed interval (setup-time configuration, default 15 minutes) from the start of each service period, grouped by service period name in chronological order; only times that pass every availability rule are listed. When the whole day is unavailable, the list is empty and the day-level reason is given.

**Guest reservations (public)**

- **FR-009**: Anyone, without signing in or holding an account, MUST be able to reserve by providing date, time, party size, name (1–100 characters after trimming), email (valid address format, up to 254 characters) and phone number (7–20 characters made of digits, spaces, hyphens, parentheses and an optional leading "+", with at least 7 digits).
- **FR-010**: The system MUST automatically assign the most suitable free table: the smallest capacity that seats the party; among equal capacities, the first by name in natural, case-insensitive order. The customer cannot choose or see a choice of tables.
- **FR-011**: A table MUST never be assigned to two overlapping reservations. This MUST hold under simultaneous requests: when several requests compete for the last suitable table, exactly one succeeds and the others are refused with "no availability" / "no table free". The guarantee MUST hold even if the application checks are bypassed by concurrent timing, not only in the normal sequential flow.
- **FR-012**: On success the system MUST return a confirmation containing: reservation identifier, status "confirmed", date, start and end time (restaurant-local), party size, guest name, email and phone, assigned table name, creation time, and a secret code.
- **FR-013**: The secret code MUST be randomly generated, unguessable (at least 128 bits of randomness), returned only in the creation response, stored only in a non-reversible form, and never returned by any other operation.
- **FR-014**: When no reservation is possible, the system MUST refuse with a "no availability" error whose details carry the reason category from FR-006, and MUST store nothing.
- **FR-015**: No email or other notification is sent in this feature.
- **FR-016**: Reservations are stored with their start and end as instants and are always presented as restaurant-local date and time.

**Interaction with existing configuration**

- **FR-017**: Removing a table that has at least one reservation that has not yet ended MUST be refused with a "conflict" error and leave the table unchanged.
- **FR-018**: Removing a table with no such reservations MUST keep working as the soft delete defined in feature 001; reservations already made MUST keep referring to that table and still show its name.
- **FR-019**: Removed tables MUST never be considered for availability or assignment.
- **FR-020**: Reservations MUST NOT be modified, moved or cancelled automatically when staff edit the weekly schedule, add a closed date or change a table.
- **FR-021**: Availability for new requests MUST always reflect the current configuration, regardless of existing reservations made under earlier configuration.
- **FR-022**: Adding a closed date, replacing the weekly schedule and updating a table MUST be applied even when they contradict upcoming reservations (reservations that have not yet ended). The response of each of these operations MUST additionally list the affected upcoming reservations: those on the newly closed date; those no longer fully inside a service period of their day under the new schedule; those on the updated table whose party size exceeds its new capacity. Each listed reservation shows its identifier, date, start and end time (restaurant-local), party size, guest name and table name. The list is empty when nothing is affected. Renaming a table never affects reservations.

**API quality (inherited)**

- **FR-023**: All new operations MUST follow feature 001's API rules: the standard error structure, validation of all input before any change, all offending fields reported at once per stage, unknown body fields and query parameters refused, and the same refusal order (unknown operation → validation → not found → conflict / no availability).
- **FR-024**: The interactive documentation MUST describe every new operation, its inputs, outputs, reason categories and error responses, with an example for each request body, and MUST mark each public operation as not requiring sign-in. The documented removal operation for tables MUST describe the new "conflict" outcome, and the closed-date creation, schedule replacement and table update operations MUST document the added list of affected reservations (an additive change to their responses).
- **FR-025**: The outcome categories of feature 001 are extended with "no availability", distinguishable from "conflict" by its machine-readable code; its details always contain the reason category.

### Key Entities

- **Reservation**: A guest's booking of one table for a time range. Attributes: identifier, status (always "confirmed" in this feature), start and end instant, party size, guest name, guest email, guest phone, assigned table (kept even after the table is removed), protected secret code, creation time.
- **Guest**: Not a stored account; the contact details (name, email, phone) recorded on each reservation.
- **Affected reservation report**: The list attached to a staff configuration change naming the upcoming reservations that the change contradicts; informational only, nothing is changed.
- **Availability answer**: The result of a lookup: available yes/no, the echoed request, and the reason category when not available.
- **Bookable time**: A start time on a given date, grouped under its service period, at which the party can currently be seated.
- **Booking rules (setup-time configuration)**: reservation duration, time interval for listed times, minimum notice, booking horizon. Not editable through the API in this feature.
- Inherited from feature 001: **Table**, **Weekly Schedule**, **Service Period**, **Closed Date**.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A customer can go from choosing a date and party size to a confirmed reservation in at most 3 requests (list times, optionally check, reserve).
- **SC-002**: Zero double bookings: in an automated check with 20 simultaneous reservation requests competing for one remaining suitable table, repeated 50 times, exactly one request succeeds every time and no table ever holds two overlapping reservations.
- **SC-003**: 100% of "not available" answers and refused reservations carry exactly one reason from the fixed set, verified by an automated check with at least one case per reason.
- **SC-004**: For any date, every listed time is accepted by both the availability check and the reservation operation, and no time that passes all rules is missing from the list, verified by an automated check across one full week including a closed date.
- **SC-005**: 100% of the new operations appear in the documentation, marked as not requiring sign-in, with every success and error response described and an example for each request body.
- **SC-006**: 95% of availability, time-list and reservation responses arrive in under 1 second under normal load, defined as up to 10 concurrent requests against 100 tables, one weekly schedule, 500 closed dates and 10,000 reservations.
- **SC-007**: 100% of table removals with an upcoming reservation are refused, and 100% of removals without one succeed, verified by an automated check.
- **SC-008**: 100% of staff changes that contradict an upcoming reservation succeed and list exactly the affected reservations, and 100% of those that contradict none return an empty list, verified by an automated check covering closed dates, schedule replacement and capacity reduction.

## Assumptions

- Single restaurant, as in feature 001; the restaurant's time zone and the booking rules (duration, time interval, minimum notice, booking horizon) are setup-time configuration values, not editable or exposed through the API.
- The duration already includes table turnover; there is no extra buffer between consecutive reservations on a table.
- Service periods do not cross midnight (feature 001), so a reservation never spans two dates.
- Table capacity is the maximum number of guests; there is no minimum party size per table, so a party of 2 may be seated at a table for 6 if nothing smaller is free. Combining tables is out of scope.
- Customers identify themselves only by the contact details on the reservation; there are no customer accounts, email verification or duplicate detection.
- Every reservation is "confirmed" on creation; other statuses (for example cancelled) arrive with cancellation in a later feature.
- Request rate limiting and abuse protection on public operations are out of scope.
- Out of scope: confirmation or any other email, cancellation by link or by staff, the staff view of the day's reservations, modifying a reservation, customer accounts, email verification, payments or deposits, waiting list, combining tables, partial-day closures, reminders, sign-in or request rate limiting, and any user interface.
