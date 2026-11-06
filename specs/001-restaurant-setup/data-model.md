# Data Model: Staff Access and Restaurant Setup

**Feature**: `001-restaurant-setup` | **Date**: 2026-11-06 | **Plan**: [plan.md](./plan.md)

MongoDB via Mongoose. Collection names are Mongoose defaults. Instants (`createdAt`,
`updatedAt`, `removedAt`) are BSON dates (UTC). Restaurant-local values (`start`, `end`,
`date`) are **text** interpreted in `RESTAURANT_TIME_ZONE` and never converted to UTC
(Constitution v1.1.0, Principle III).

## StaffMember (`staffmembers`)

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Exposed as the JWT `sub`; never returned in API bodies. |
| `name` | string | Required, trimmed, 1–100 chars. |
| `email` | string | Required; stored as `normalizeEmail(input)` = `trim().toLowerCase()`; valid email format. **Unique index**. |
| `passwordHash` | string | Required; `scrypt$N$r$p$<saltB64>$<hashB64>`; `select: false`; never serialized. |
| `createdAt`, `updatedAt` | Date | Mongoose `timestamps`. |

- Created only by `scripts/seed-staff.ts` (FR-006); there is no API to create, update or delete
  staff members.
- API projection: `{ name, email }`.

## Table (`tables`)

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Exposed as `id` (24-hex string). |
| `name` | string | Required; `normalizeName(input)` = `trim()`; 1–50 chars after trim; case kept as entered. |
| `nameKey` | string | Derived: `name.trim().toLowerCase()`; set by the service on every create/rename. |
| `capacity` | number | Required; integer 1–50. |
| `removed` | boolean | Default `false`. |
| `removedAt` | Date \| null | Default `null`; set when soft-deleted. |
| `createdAt`, `updatedAt` | Date | Mongoose `timestamps`. |

**Indexes**

- `{ nameKey: 1 }` **unique**, `partialFilterExpression: { removed: false }` (FR-009: unique
  among non-removed tables; removed names reusable).

**State transitions**

```text
(create) ──▶ ACTIVE ──(DELETE /tables/:id)──▶ REMOVED   (terminal in this feature)
                │  ▲
                └──┘ PATCH name/capacity
```

- Every read/update/remove filters `{ _id, removed: false }`; a REMOVED table behaves as
  `NOT_FOUND` (FR-010).
- Soft delete: `findOneAndUpdate({ _id, removed: false }, { $set: { removed: true, removedAt: now } })`.
- Duplicate `nameKey` on insert/update → Mongo `11000` → `CONFLICT`.
- Future rule (FR-011, enforced in feature 002): removal is refused with `CONFLICT` when the
  table has future reservations.
- API projection: `{ id, name, capacity }`. List sorted by `nameKey` with collation
  `{ locale: "en", numericOrdering: true }`.

## WeeklySchedule (`weeklyschedules`)

A single document with fixed `_id: "weekly"`.

| Field | Type | Rules |
|---|---|---|
| `_id` | string | Always `"weekly"`. |
| `days` | DaySchedule[7] | Exactly 7 entries, Monday → Sunday, each day once. |
| `updatedAt` | Date | Mongoose `timestamps`. |

**DaySchedule** (embedded, `_id: false`)

| Field | Type | Rules |
|---|---|---|
| `day` | enum | `monday` \| `tuesday` \| `wednesday` \| `thursday` \| `friday` \| `saturday` \| `sunday`. |
| `periods` | ServicePeriod[] | Sorted by `start`; empty array = closed day (FR-013). |

**ServicePeriod** (embedded, `_id: false`)

| Field | Type | Rules |
|---|---|---|
| `name` | string | Trimmed, 1–50 chars; unique within its day by `trim().toLowerCase()`. |
| `start` | string `"HH:mm"` | `^([01]\d|2[0-3]):[0-5]\d$` (00:00–23:59). |
| `end` | string `"HH:mm"` | Same format; `toMinutes(end) > toMinutes(start)`; no midnight crossing. |

**Validation (`validateWeeklySchedule`, pure)**: input days at most once each (unknown day →
error from the Zod enum, repeated day → error); in each day: end > start, no overlap after
sorting (`next.start < prev.end` is an overlap; equal boundaries allowed), no duplicate
normalized names. Output: 7 days in Monday-first order, periods sorted chronologically,
missing days filled with `periods: []`. Errors: `{ field: "days[i].periods[j].<prop>", reason }`.

**Lifecycle**: absent until the first `PUT`; `GET` on absence returns 7 empty days without
writing. `PUT` = one atomic upsert of `days`, executed only after validation succeeds
(refused updates leave the stored document unchanged, FR-024).

## ClosedDate (`closeddates`)

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Internal only; never exposed (the date is the identifier, FR-020). |
| `date` | string `"YYYY-MM-DD"` | Real Gregorian calendar date (`isValidCalendarDate`); on create `date >= todayInTimeZone(RESTAURANT_TIME_ZONE, now)`. **Unique index**. |
| `reason` | string \| null | Optional; trimmed; ≤ 200 chars; empty → `null`. |
| `createdAt`, `updatedAt` | Date | Mongoose `timestamps`. |

- Create duplicate → `11000` → `CONFLICT` (FR-019).
- List: `{ date: { $gte: today } }` unless `includePast=true`; sort `{ date: 1 }` (text order
  equals chronological order for `YYYY-MM-DD`).
- Delete: `deleteOne({ date })`; `deletedCount === 0` → `NOT_FOUND`. Past dates may be deleted.
- A closed date on a weekday already closed in the weekly schedule is accepted.
- API projection: `{ date, reason }`.

## Pure domain functions (unit-tested)

| Function | Module | Contract |
|---|---|---|
| `normalizeEmail(s)` | `shared/validation/normalize.ts` | `s.trim().toLowerCase()` |
| `normalizeName(s)` | `shared/validation/normalize.ts` | `s.trim()` (the display value); key = `normalizeName(s).toLowerCase()` |
| `toMinutes("HH:mm")` | `modules/schedule/schedule.domain.ts` | `h * 60 + m` |
| `validateWeeklySchedule(input)` | `modules/schedule/schedule.domain.ts` | See WeeklySchedule above |
| `isValidCalendarDate(s)` | `modules/closed-dates/closed-dates.domain.ts` | Format + month/day ranges + leap years |
| `todayInTimeZone(tz, now)` | `modules/closed-dates/closed-dates.domain.ts` | `Intl.DateTimeFormat("en-CA", …)` → `YYYY-MM-DD` |
| `parseDuration("8h")` | `config/env.ts` | `^\d+[smhd]$` → seconds |
| `hashPassword` / `verifyPassword` | `modules/auth/password.ts` | scrypt + `timingSafeEqual` (async; not pure, but deterministic given salt) |
