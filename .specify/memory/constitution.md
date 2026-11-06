<!--
Sync Impact Report
- Version change: (unversioned template) → 1.0.0
- Modified principles: all template placeholders replaced (initial ratification)
  - [PRINCIPLE_1_NAME] → I. Monorepo with a Contract-First API
  - [PRINCIPLE_2_NAME] → II. Test-First (NON-NEGOTIABLE)
  - [PRINCIPLE_3_NAME] → III. Reservation Integrity at the Database Level
  - [PRINCIPLE_4_NAME] → IV. Consistent, Correct HTTP Semantics
  - [PRINCIPLE_5_NAME] → V. Simplicity and Minimal Dependencies
- Added sections: Technology Stack & Backend Constraints; Development Workflow & Quality Gates
- Removed sections: none
- Templates: not modified (dependent templates read the constitution at runtime)
- Follow-up TODOs: none
-->

# table-reservation Constitution

A table reservation system for a restaurant.

## Core Principles

### I. Monorepo with a Contract-First API

- The repository MUST be a monorepo with `backend/` and `frontend/` at the root, and a
  single `specs/` directory at the root shared by both.
- Development starts with the backend only. The `frontend/` (Vite + React) arrives in a
  later feature and MUST be addable without restructuring the repository.
- The OpenAPI document is the contract between backend and frontend. It MUST be generated
  from the Zod schemas (single source of truth) and served at `/docs`. Any change to a
  request or response shape MUST be reflected in the OpenAPI document.

**Rationale**: A stable layout and a machine-generated contract let the frontend be built
later against a known API without drift between validation and documentation.

### II. Test-First (NON-NEGOTIABLE)

- Tests MUST be written with Vitest and Supertest before the implementation, and MUST be
  observed failing before the implementation is written (Red → Green → Refactor).
- Tests requiring persistence MUST use mongodb-memory-server; no test may depend on an
  externally running database or service.
- External side effects (e.g. email) MUST be replaced by test doubles through their
  interfaces.
- No user story is considered done until all of its tests pass.

**Rationale**: Failing-first tests prove that each test actually exercises the behavior it
claims to verify, and self-contained tests keep the suite reproducible on any machine.

### III. Reservation Integrity at the Database Level

- A table MUST never be assigned to two overlapping reservations. This invariant MUST be
  enforced at the database level (e.g. indexes, atomic conditional writes, or
  transactions), not only in application code, so it holds under concurrent requests.
- All dates and times MUST be stored in UTC and presented in the restaurant's configured
  time zone.
- Sending email MUST go through an interface so it can be mocked. An email failure MUST
  never cancel, roll back, or fail the creation of a reservation.

**Rationale**: Double bookings are the core failure mode of the domain; application-only
checks are vulnerable to race conditions. UTC storage avoids DST and offset ambiguity.

### IV. Consistent, Correct HTTP Semantics

- Every endpoint MUST return the correct HTTP status code for its outcome (e.g. 201 on
  creation, 400 on validation failure, 401/403 on auth failure, 404 when not found,
  409 on conflicts such as overlapping reservations).
- Every error response MUST use exactly this body shape:
  `{ "error": { "code": string, "message": string, "details"?: unknown } }`.
- All request input MUST be validated with Zod before reaching domain logic.

**Rationale**: A single, predictable error shape and accurate status codes make the API
easy to consume and to test, and keep the frontend's error handling uniform.

### V. Simplicity and Minimal Dependencies

- Dependencies MUST be kept to a minimum. Prefer the standard library and the tools already
  in the stack before adding a new package; each new dependency MUST be justified in the
  feature's plan.
- MongoDB is the only external runtime dependency.
- Do not build for hypothetical requirements (YAGNI).

**Rationale**: Fewer dependencies mean a smaller attack surface, fewer upgrades, and a
codebase that is easier to understand and maintain.

## Technology Stack & Backend Constraints

- **Language/runtime**: TypeScript on Node.js, with Express as the HTTP framework.
- **Validation**: Zod for request validation and for environment configuration.
- **Persistence**: MongoDB via Mongoose.
- **Authentication**: JWT. JWT MUST protect staff/admin endpoints only; reservation
  endpoints intended for customers MUST remain public.
- **Configuration**: All configuration comes from environment variables, validated with
  Zod at startup; the application MUST fail fast on invalid configuration. No secrets may be
  committed to the repository (provide an example env file with placeholders instead).
- **CORS**: Enabled for the local frontend origin, configured via environment variables.
- **Documentation**: OpenAPI generated from Zod schemas, served at `/docs`.

## Development Workflow & Quality Gates

- Every feature follows the Spec Kit flow: specification → plan → tasks → implementation,
  with artifacts stored under `specs/`.
- Each plan MUST include a Constitution Check confirming compliance with every principle;
  any deviation MUST be documented and justified in the plan's complexity tracking.
- A user story may only be marked done when its tests were written first, were seen
  failing, and now pass.
- All documentation (specs, plans, tasks, README) and all code, including identifiers,
  comments, and commit messages, MUST be written in English.

## Governance

- This constitution supersedes all other project practices. When a plan, task, or code
  conflicts with it, the constitution wins until it is formally amended.
- **Amendments** MUST be made by updating this file, including a Sync Impact Report, a
  version bump, and an updated Last Amended date. Dependent artifacts in progress MUST be
  reviewed for consistency after an amendment.
- **Versioning** follows semantic versioning:
  - MAJOR: removal or backward-incompatible redefinition of a principle or governance rule.
  - MINOR: a new principle or section, or materially expanded guidance.
  - PATCH: clarifications, wording, and typo fixes with no semantic change.
- **Compliance review**: every plan and every code review MUST verify adherence to these
  principles. Added complexity MUST be justified.

**Version**: 1.0.0 | **Ratified**: 2026-11-06 | **Last Amended**: 2026-11-06
