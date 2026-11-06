# Feature Specification: Staff Access and Restaurant Setup

**Feature Branch**: `001-restaurant-setup`

**Created**: 2026-11-06

**Status**: Draft

**Input**: User description: "Build the foundation of the backend for a table reservation system for a single restaurant. This feature covers staff access and the configuration of the restaurant (tables, service hours, closed dates). Taking reservations comes in later features and is out of scope here."

## Clarifications

### Session 2026-11-06

- Q: When staff remove a table, should it be permanently deleted or kept as an inactive record? → A: Soft delete: the table is marked removed, hidden from list and single reads ("not found"), and its name becomes available for reuse.
- Q: Should a closed date be removed by its calendar date or by a generated identifier? → A: By calendar date; the date is the closure's natural identifier and closures are returned with date and reason only.
- Q: Must service period names be unique within a day? → A: Yes, unique within a day, compared case-insensitively after trimming; duplicates refuse the whole update with a "validation" error.
- Q: Should sign-in email matching ignore letter case and surrounding spaces? → A: Yes; emails are trimmed and lowercased when stored and when signing in, and uniqueness is checked on that normalized form.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Staff sign-in and protected access (Priority: P1)

A staff member signs in with their credentials and receives proof of authentication that they present on every management request. Anyone who is not signed in, whose credentials are wrong, or whose authentication has expired is refused access to every management operation with a clear, consistent error.

**Why this priority**: Every other capability in this feature is a staff-only management operation. Without authentication, nothing else can be safely exposed.

**Independent Test**: Can be fully tested by signing in with a provisioned staff account, calling a protected operation with and without the resulting proof of authentication, and confirming that only the authenticated call succeeds.

**Acceptance Scenarios**:

1. **Given** a provisioned staff account, **When** the staff member signs in with the correct email and password, **Then** the system confirms the sign-in and returns proof of authentication with its expiry.
2. **Given** a provisioned staff account, **When** someone signs in with a wrong password or an unknown email, **Then** the system refuses the sign-in with an "invalid credentials" error that does not reveal which of the two was wrong.
3. **Given** no proof of authentication, **When** any management operation is called, **Then** the system refuses it with an "authentication required" error.
4. **Given** an expired, tampered or malformed proof of authentication, **When** any management operation is called, **Then** the system refuses it with an "authentication required" error.
5. **Given** a staff account provisioned as "ana@resto.com", **When** someone signs in with " Ana@Resto.com " and the correct password, **Then** the sign-in succeeds.
6. **Given** a signed-in staff member, **When** they request their own profile, **Then** the system returns their name and email but never their password.

---

### User Story 2 - Manage tables (Priority: P1)

A signed-in staff member maintains the list of tables in the restaurant: they add a table with a name (or number) and a seating capacity, see all tables, change a table's name or capacity, and remove a table that is no longer in use.

**Why this priority**: Tables are the resource that later reservation features assign to guests; availability cannot be computed without them.

**Independent Test**: Can be fully tested by signing in, creating several tables, listing them, editing one, removing one, and confirming that the list reflects each change.

**Acceptance Scenarios**:

1. **Given** a signed-in staff member, **When** they create a table named "T1" with capacity 4, **Then** the system stores it and returns the created table with its identifier.
2. **Given** existing tables, **When** the staff member lists tables, **Then** the system returns all tables with their name and capacity, ordered by name.
3. **Given** a table named "T1" exists, **When** the staff member creates or renames another table to "T1" (ignoring letter case and surrounding spaces), **Then** the system refuses with a "conflict" error.
4. **Given** an existing table, **When** the staff member updates its capacity to 6, **Then** subsequent reads show capacity 6.
5. **Given** a table creation or update with a missing name, a capacity of 0, a negative capacity, a non-whole capacity or a capacity above the maximum, **When** it is submitted, **Then** the system refuses with a "validation" error identifying the invalid field(s).
6. **Given** an existing table, **When** the staff member removes it, **Then** it no longer appears in the list, reading it returns a "not found" error, and its name can be used for a new table.
7. **Given** a table identifier that does not exist or belongs to a removed table, **When** the staff member reads, updates or removes it, **Then** the system responds with a "not found" error.

---

### User Story 3 - Define weekly service hours (Priority: P2)

A signed-in staff member defines, for each day of the week, whether the restaurant is open and which service periods it offers that day (for example "Lunch 12:00–15:00" and "Dinner 20:00–23:30"). They can view the current weekly schedule at any time and replace it with an updated one.

**Why this priority**: Service hours define when reservations can be taken in later features. Tables come first because they are needed in any case, but the schedule is required before availability can exist.

**Independent Test**: Can be fully tested by signing in, viewing the default schedule (all days closed), submitting a schedule with lunch and dinner on some days and no periods on others, and confirming that the returned schedule matches.

**Acceptance Scenarios**:

1. **Given** no schedule has ever been set, **When** a staff member views the weekly schedule, **Then** the system returns all seven days with no service periods (closed).
2. **Given** a signed-in staff member, **When** they submit a schedule where Tuesday–Sunday have "Lunch 12:00–15:00" and "Dinner 20:00–23:30" and Monday has no periods, **Then** the system stores it and subsequent views show Monday closed and the other days open with those periods.
3. **Given** a submitted period whose end time is not after its start time, **When** it is submitted, **Then** the system refuses the whole update with a "validation" error identifying the day and period.
4. **Given** two periods on the same day that overlap (for example 12:00–15:00 and 14:00–17:00), **When** they are submitted, **Then** the system refuses the whole update with a "validation" error.
5. **Given** a time that is not a valid time of day (for example "25:00" or "12:7"), or an unknown day of the week, **When** it is submitted, **Then** the system refuses with a "validation" error.
6. **Given** two periods on the same day named "Lunch" and " lunch " (even if they do not overlap), **When** they are submitted, **Then** the system refuses the whole update with a "validation" error identifying the day and the duplicated name.
7. **Given** a refused update, **When** the schedule is viewed, **Then** the previously stored schedule is unchanged.

---

### User Story 4 - Mark specific dates as closed (Priority: P3)

A signed-in staff member marks specific calendar dates on which the restaurant is closed regardless of the weekly schedule (holidays, private events, special closures), optionally with a reason. They can see the list of upcoming closed dates and remove a closure that was added by mistake or cancelled.

**Why this priority**: Exceptions to the weekly schedule matter, but the restaurant can operate on its weekly schedule alone until they are needed.

**Independent Test**: Can be fully tested by signing in, adding a closed date with a reason, listing closed dates, attempting to add the same date again, and removing it.

**Acceptance Scenarios**:

1. **Given** a signed-in staff member, **When** they mark 2026-12-25 as closed with reason "Christmas", **Then** the system stores it and returns the closure.
2. **Given** existing closed dates, **When** the staff member lists them, **Then** the system returns closures from today onwards in chronological order; earlier closures can be included on request.
3. **Given** 2026-12-25 is already marked as closed, **When** the staff member marks it again, **Then** the system refuses with a "conflict" error.
4. **Given** a date in the past or an invalid date (for example 2026-02-30), **When** it is submitted, **Then** the system refuses with a "validation" error.
5. **Given** an existing closure for 2026-12-25, **When** the staff member removes the closure for that date, **Then** it no longer appears in the list; removing a closure for a date that is not marked closed returns a "not found" error.

---

### User Story 5 - Discoverable, consistent API (Priority: P3)

A developer integrating with the backend (for example the future staff interface) opens the interactive documentation, sees every available operation with its inputs, outputs and possible errors, signs in from the documentation and tries the protected operations there. Every error they encounter has the same structure.

**Why this priority**: It is a quality attribute of all other stories rather than standalone business value, but it is what makes the later frontend and reservation features buildable without guesswork.

**Independent Test**: Can be fully tested by opening the documentation, confirming every operation of this feature is listed, and executing a sign-in followed by a protected call from within it.

**Acceptance Scenarios**:

1. **Given** the backend is running, **When** a developer opens the documentation address, **Then** they see every operation of this feature with request and response descriptions, including error responses.
2. **Given** the documentation, **When** the developer signs in and supplies the resulting proof of authentication, **Then** they can execute protected operations directly from the documentation.
3. **Given** any refused request (validation, authentication, not found, conflict, unexpected failure), **When** the response is inspected, **Then** it contains an error with a stable machine-readable code, a human-readable message, and optional details (for validation errors, the list of offending fields and reasons).

---

### Edge Cases

- A request body that is not well-formed or has unexpected extra fields is refused with a "validation" error, never an unexpected-failure error.
- Table names that differ only in letter case or surrounding spaces are treated as duplicates; surrounding spaces are trimmed before storing.
- Removing a table has no reservation check yet; once reservations exist (feature 002), removing a table with future reservations MUST be refused with a "conflict" error. This rule is documented now and enforced later.
- A day of the week submitted with an empty list of periods is a closed day; a schedule that omits a day treats that day as closed.
- Service periods do not cross midnight in this feature; a period must start and end on the same day (latest end 23:59).
- Adjacent periods (for example 12:00–15:00 and 15:00–18:00) are allowed; only overlapping periods are refused.
- A closed date that falls on a day already closed in the weekly schedule is still accepted (it remains valid if the weekly schedule later changes).
- "Today" and "past" for closed dates are evaluated in the restaurant's time zone, not the server's.
- Unexpected internal failures return an "internal error" response in the standard error structure without exposing internal details.
- Calling an operation that does not exist returns a "not found" error in the standard error structure.

## Requirements *(mandatory)*

### Functional Requirements

**Staff access**

- **FR-001**: System MUST allow a staff member to sign in with email and password and, on success, return proof of authentication and its expiry time. Email matching MUST ignore letter case and surrounding spaces.
- **FR-002**: System MUST refuse sign-in with incorrect credentials using a single generic "invalid credentials" error that does not reveal whether the email exists.
- **FR-003**: System MUST require valid, unexpired proof of authentication for every management operation (tables, service hours, closed dates, staff profile); only sign-in, the documentation and a basic health check are public.
- **FR-004**: Proof of authentication MUST expire after a configurable period (default 8 hours); expired proof MUST be refused.
- **FR-005**: System MUST store staff passwords only in a non-reversible form and MUST never return them in any response.
- **FR-006**: System MUST allow an operator to provision the initial staff account(s) outside the API (for example during setup) without any public registration operation.
- **FR-007**: System MUST allow a signed-in staff member to view their own profile (name, email).

**Tables**

- **FR-008**: Staff MUST be able to create a table with a name (text, 1–50 characters after trimming) and a seating capacity (whole number from 1 to 50).
- **FR-009**: Table names MUST be unique among non-removed tables, compared case-insensitively after trimming; a removed table's name MAY be reused.
- **FR-010**: Staff MUST be able to list all tables, read a single table, update a table's name and/or capacity, and remove a table. Removal MUST be a soft delete: the table record is retained and marked removed, and removed tables MUST be excluded from list, read, update and remove operations (treated as "not found"). Restoring a removed table is out of scope.
- **FR-011**: The rule "a table with future reservations cannot be removed" MUST be documented as part of the removal operation; in this feature removal is always allowed because reservations do not exist yet.

**Service hours**

- **FR-012**: System MUST maintain one weekly schedule covering all seven days of the week, where each day has zero or more named service periods, each with a start time and end time (hours and minutes).
- **FR-013**: A day with no service periods MUST be treated as closed; before any schedule is set, all days are closed.
- **FR-014**: Staff MUST be able to view the weekly schedule and replace it as a whole in one update.
- **FR-015**: System MUST refuse a schedule update in its entirety if any period has an end time not after its start time, if periods on the same day overlap, if a time is invalid, if a period name is empty or longer than 50 characters (after trimming), if two periods on the same day share a name (compared case-insensitively after trimming), or if a day is unknown or repeated.
- **FR-016**: Service periods within a day MUST be returned in chronological order.
- **FR-017**: Service hours MUST be interpreted in the restaurant's configured time zone.

**Closed dates**

- **FR-018**: Staff MUST be able to mark a calendar date as closed, with an optional reason of up to 200 characters.
- **FR-019**: System MUST refuse marking a date that is already closed (conflict), a date in the past, or an invalid calendar date (validation).
- **FR-020**: Staff MUST be able to list closed dates (from today onwards by default, in chronological order, with an option to include past dates) and remove a closed date by specifying the calendar date itself; the date is the closure's unique identifier and no separate identifier is exposed.

**API quality**

- **FR-021**: Every refused request MUST return an error in one consistent structure containing a stable machine-readable code, a human-readable message, and optional details.
- **FR-022**: The outcome categories MUST be distinguishable to the caller: validation error, authentication required, invalid credentials, not found, conflict, and internal error.
- **FR-023**: Validation errors MUST identify each offending field and the reason it was refused.
- **FR-024**: All input MUST be validated before any change is made; a refused request MUST leave stored data unchanged.
- **FR-025**: System MUST publish interactive documentation describing every operation, its inputs, its outputs and its error responses, allowing protected operations to be tried after signing in.

### Key Entities

- **Staff Member**: A person who operates the restaurant's management features. Attributes: name, email (stored trimmed and lowercased; unique in that form; used to sign in), protected password. All staff members have the same permissions.
- **Table**: A physical table that can later be assigned to reservations. Attributes: name or number (unique among non-removed tables), seating capacity, removal marker (when the table was removed; empty while active). Removed tables are kept so later reservation history can still refer to them.
- **Weekly Schedule**: The restaurant's recurring opening pattern. One per restaurant; contains, for each day of the week, a list of Service Periods.
- **Service Period**: A named time window on a given day of the week during which the restaurant serves guests (for example Lunch, Dinner). Attributes: name (unique within its day, case-insensitive after trimming), start time, end time.
- **Closed Date**: A specific calendar date on which the restaurant is closed regardless of the weekly schedule. Attributes: date (unique; identifies the closure), optional reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A staff member can configure a new restaurant from scratch (sign in, create 10 tables, set a weekly schedule with lunch and dinner, add 3 closed dates) in under 10 minutes using only the interactive documentation.
- **SC-002**: 100% of management operations refuse requests without valid authentication, verified by an automated check covering every protected operation.
- **SC-003**: 100% of refused requests across all operations use the same error structure, and every validation error names the offending field(s).
- **SC-004**: 100% of the operations in this feature appear in the interactive documentation with their success and error responses described.
- **SC-005**: Every accepted change (table, schedule, closed date) is visible on the very next read; every refused change leaves the previously stored data unchanged.
- **SC-006**: Staff receive a response to any management operation in under 1 second under normal load.

## Assumptions

- The system serves exactly one restaurant; there is no restaurant entity to create or select.
- There is a single staff role; all staff members have the same permissions. Staff account management (inviting, deactivating, changing passwords) is out of scope; accounts are provisioned by an operator during setup.
- Sign-in uses email and password. Sign-out is achieved by the client discarding its proof of authentication; server-side revocation is out of scope.
- Protection against repeated sign-in attempts (rate limiting, lockout) is out of scope for this feature.
- The restaurant's time zone is a setup-time configuration value, not editable through the API in this feature.
- Table capacity is the maximum number of guests a table seats; minimum-party rules, table combining and table areas/zones are out of scope.
- Closures cover whole days only; partial-day closures and special opening hours on specific dates are out of scope.
- Changing the schedule, tables or closed dates has no effect on existing reservations because none exist yet; how such changes interact with reservations is decided in feature 002.
- Out of scope: customer accounts, reservations, availability, emails, payments, multiple restaurants and any user interface.
