# API Contract Requirements Checklist: Availability Lookup and Guest Reservations

**Purpose**: Validate the quality (completeness, clarity, consistency, measurability) of the HTTP API requirements in `spec.md` and `contracts/api.md`.
**Created**: 2026-11-07
**Feature**: [spec.md](../spec.md) · [contracts/api.md](../contracts/api.md)

**Note**: This custom checklist was generated from the feature context and then reviewed item by item against `spec.md` and `contracts/api.md` at the explicit request of the user. No code was involved.
**Review Ownership**: This checklist is a reviewer-owned requirements-quality review artifact. Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.
**Review legend**: `[x]` items end with `✔ covered` (already met) or `✎ fixed` (spec or contract edited to meet it, with what changed). The review was done by the assistant on the user's request; the user should confirm it.

## Operation Inventory & Access

- [x] CHK001 Are all new operations listed with method, path and whether they require sign-in? [Completeness, Contract §New operations] ✔ covered (3 public operations with 🔓 marker; 17 total, 6 public in §Documentation requirements).
- [x] CHK002 Is the way a public operation is marked in the documentation defined measurably (no `security` entry, description prefix)? [Clarity, Contract intro, Spec §FR-024] ✔ covered.
- [x] CHK003 Are the public-operation set and operation count stated consistently between contract, spec (FR-024, SC-005) and plan? [Consistency] ✔ covered (counts live in the contract and plan; the spec requires "every new operation").
- [x] CHK004 Are the changed 001 operations (closed dates, schedule, table update, table removal) enumerated with their new behavior? [Completeness, Spec §FR-017, §FR-022, Contract §Changed 001 operations] ✔ covered.

## Request Rules

- [x] CHK005 Are the query parameters of both lookups named, typed and marked required? [Completeness, Contract §GET /availability, §GET /availability/times] ✔ covered.
- [x] CHK006 Are strict-input rules defined for unknown and repeated query parameters, including the error field naming? [Clarity, Contract §Query strings, Spec §Edge Cases] ✔ covered.
- [x] CHK007 Are the body rules of `POST /reservations` written in the contract itself (not only by reference), including the type of `partySize` and the `time` format? [Clarity, Contract §POST /reservations] ✎ fixed: added a "Body rules" table (date, 24-hour `HH:mm`, integer `partySize`, name, email, phone) to the contract; previously it only linked to the data model.
- [x] CHK008 Is the difference between `partySize` as a query string and as a body integer specified? [Clarity, Contract §Query strings, §POST /reservations] ✔ covered (decimal string vs JSON integer; now both in the contract).
- [x] CHK009 Is "valid email address format" defined precisely enough to be tested (display names, lists, length)? [Ambiguity, Spec §FR-009] ✎ fixed: contract rules table states one address, no display name or list, valid syntax, ≤ 254 after trim.
- [x] CHK010 Is the unit for name, email and phone length limits defined (characters vs code units) for non-ASCII input such as "García"? [Ambiguity, Spec §FR-009] ✎ fixed: contract states lengths are string length (UTF-16 code units).
- [x] CHK011 Are normalization rules (trim, lowercase email) defined and is it stated which form the response returns? [Clarity, Spec §Edge Cases, §FR-012] ✎ fixed: FR-012 and the contract now say the response echoes guest values as stored (trimmed; email lowercased).
- [x] CHK012 Are content type, body size and JSON syntax errors covered for the new operations? [Coverage, Contract intro and §Check order] ✔ covered by inheritance from the 001 rules, with their place in the check order (step 3).

## Response Definitions

- [x] CHK013 Is the availability response shape complete, including echoed inputs and "`reason` present iff `available` is false"? [Completeness, Spec §FR-007, Contract §GET /availability] ✔ covered.
- [x] CHK014 Is the bookable-times response shape complete: grouping, ordering, period names, omission of empty periods, and `reason` iff `periods` is empty? [Completeness, Spec §FR-008, Contract §GET /availability/times] ✔ covered.
- [x] CHK015 Does the reservation confirmation contain every field required by FR-012, with types and formats (instants vs local values)? [Consistency, Spec §FR-012, Contract §POST /reservations, §Time] ✔ covered.
- [x] CHK016 Are success status codes and headers specified for each operation (200, 201, absence of `Location`, 204)? [Completeness, Contract] ✔ covered.
- [x] CHK017 Is the caching behavior of the lookups specified, given that answers are snapshots? [Gap, Spec §Edge Cases] ✎ fixed: FR-007 and a new Contract §Caching require non-cacheable responses (`Cache-Control: no-store`).
- [x] CHK018 Is the machine-readable form of every reason and error category defined, and mapped from the prose terms used in the spec? [Traceability, Spec §FR-006, §FR-025] ✎ fixed: FR-025 and Contract §New error code now map "validation / not found / conflict / no availability / internal error" to the codes and the reasons to the snake_case strings.

## Error Responses

- [x] CHK019 Does every operation list all of its error statuses and codes? [Completeness, Contract per-operation error lists] ✔ covered (lookups: 400/500; reserve: 400/409 ×2/500; removal: 401/404/409/500; inherited 404/401 rules).
- [x] CHK020 Are `NO_AVAILABILITY` and `CONFLICT` distinguishable by code, with the `details` shape of each defined? [Clarity, Spec §FR-025, Contract §New error code] ✔ covered.
- [x] CHK021 Is the set of conflict reasons closed and enumerated? [Clarity, Contract §New error code] ✎ fixed: contract now states the two conflict reasons are a closed set.
- [x] CHK022 Is the HTTP status for "not available" defined consistently: 200 for lookups, 409 for the reservation? [Consistency, Contract §Check order, Data Model §Validation rules] ✔ covered.
- [x] CHK023 Is the refusal order the same in spec and contract (route → auth → validation → not found → conflict → availability)? [Consistency, Spec §FR-023, Contract §Check order] ✔ covered (the contract adds authentication, which the spec inherits from 001).
- [x] CHK024 Is the reason chosen when several apply defined once and used identically by both lookups and the reservation? [Consistency, Spec §Edge Cases, §FR-006, §FR-008] ✔ covered.
- [x] CHK025 Are the error cases of failure and race paths (duplicate, lost race, storage failure, unknown outcome, rollback) documented in the contract with their statuses? [Coverage, Contract §POST /reservations] ✔ covered (after the concurrency fixes).

## Changed 001 Operations

- [x] CHK026 Is the new `affectedReservations` field defined as always present, with item shape and filter ("not ended")? [Completeness, Spec §FR-022, Contract §Changed 001 operations] ✔ covered.
- [x] CHK027 Is the ordering of `affectedReservations` fully determined, including ties? [Ambiguity, Contract §Changed 001 operations] ✎ fixed: ordered by start instant, ties by `id` ascending (FR-022 and contract).
- [x] CHK028 Is it stated whether the list can be paginated or truncated? [Gap, Spec §FR-022] ✎ fixed: complete and not paginated (FR-022 and contract).
- [x] CHK029 Is it defined when the list is empty for a table update without `capacity`, and for renames? [Edge Case, Contract §Changed 001 operations] ✔ covered.
- [x] CHK030 Is the change to existing response shapes documented as additive, with the consequence for 001 clients? [Consistency, Spec §FR-024, Contract §Changed 001 operations, Plan §Complexity Tracking] ✔ covered.
- [x] CHK031 Is the new `DELETE /tables/{id}` outcome (409 with reason, table state afterwards, boundary of "upcoming", 500 on failed restore) fully specified? [Completeness, Spec §FR-017, §FR-029, Contract §DELETE] ✔ covered.

## Security & Privacy

- [x] CHK032 Are the secret-code rules (once only, unguessable, non-reversible storage) specified measurably, including that it is not logged? [Measurability, Spec §FR-013] ✎ fixed: FR-013 and the contract now say it is never written to logs or error responses (the other rules were already covered).
- [x] CHK033 Is it specified that the lookups never reveal the table and the duplicate refusal never reveals details of the existing reservation? [Completeness, Spec §FR-007, §FR-026, Contract §POST /reservations] ✔ covered.
- [x] CHK034 Is the absence of rate limiting on public operations stated as out of scope? [Assumption, Spec §Assumptions] ✔ covered.

## Documentation Requirements

- [x] CHK035 Are the OpenAPI requirements measurable: summary, description with reason order, request example, success schema and every error response per operation? [Measurability, Spec §FR-024, §SC-005, Contract §Documentation requirements] ✔ covered.
- [x] CHK036 Is an example required for the query operations as well as the body operation? [Coverage, Contract §Documentation requirements] ✔ covered (parameter examples).
- [x] CHK037 Is the documentation of the changed 001 operations required (new 409, new response field)? [Coverage, Spec §FR-024, Contract §Documentation requirements] ✔ covered.
- [x] CHK038 Do the examples in the contract agree with the stated rules (periods, times, ordering, reasons)? [Consistency, Contract §New operations] ✔ covered.

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- Leave items unchecked when they still require clarification, correction, or reviewer evaluation
- `/speckit-implement` reads checklist checkbox state as a gate and must not modify markers
- `checklists/requirements.md` has a separate built-in lifecycle maintained by `/speckit-specify` and `/speckit-clarify`
- Items resolved by editing the documents (✎): CHK007, CHK009, CHK010, CHK011, CHK017, CHK018, CHK021, CHK027, CHK028, CHK032
- Plan and research were not changed by this pass; the new `Cache-Control: no-store` requirement (FR-007) will need a line in the plan's contract/route notes when `/speckit-tasks` runs
