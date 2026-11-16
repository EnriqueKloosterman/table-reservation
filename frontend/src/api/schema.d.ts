export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check service health
         * @description Public health check. Returns 200 when the service and its database are up, and 503 SERVICE_UNAVAILABLE with `details: { "database": "down" }` when the database is not connected.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The service and database are up. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Health"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `SERVICE_UNAVAILABLE`: the database is not connected; `details` is `{ "database": "down" }`. */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in
         * @description Signs a staff member in with email and password. The email is trimmed and lowercased before matching. Returns a bearer token and its UTC expiry (`expiresAt`, equal to the token's `exp` claim). Every well-formed request with an unknown email or a wrong password gets the same `INVALID_CREDENTIALS` refusal; a syntactically invalid email or an empty password is `VALIDATION_ERROR`, which reveals nothing about existing accounts. Copy `token` into the Authorize dialog to call the protected operations.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    /**
                     * @example {
                     *       "email": " Ana@Resto.com ",
                     *       "password": "correct horse battery"
                     *     }
                     */
                    "application/json": components["schemas"]["LoginRequest"];
                };
            };
            responses: {
                /** @description Signed in. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LoginResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INVALID_CREDENTIALS`: unknown email or wrong password (same refusal for both). */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the signed-in staff member
         * @description Returns the profile of the staff member the bearer token belongs to (never a password or hash). A token whose staff account no longer exists is refused with 401.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The signed-in staff member. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StaffProfile"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tables
         * @description Lists active tables ordered by name, ignoring case, with digit runs compared as numbers (T2 before T10), English collation. Removed tables are not listed.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Active tables. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Table"][];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Create a table
         * @description Creates a table. The name is stored trimmed with its case kept, and must not match an active table's name ignoring case and surrounding spaces (409 CONFLICT). The response has a `Location: /tables/{id}` header.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    /**
                     * @example {
                     *       "name": "T1",
                     *       "capacity": 4
                     *     }
                     */
                    "application/json": components["schemas"]["CreateTable"];
                };
            };
            responses: {
                /** @description The created table. */
                201: {
                    headers: {
                        /** @description URL of the new table, `/tables/{id}`. */
                        Location: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Table"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `CONFLICT`: the request conflicts with existing data; some cases carry `details` `{ "reason": "duplicate_reservation" | "table_has_upcoming_reservations" }`. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tables/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a table
         * @description Returns one active table. A malformed id answers 404 NOT_FOUND, the same as an unknown or removed id.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Table id (24 hex characters). */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The table. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Table"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `NOT_FOUND`: the resource does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /**
         * Remove a table
         * @description Soft-deletes an active table; its name becomes reusable and its id answers 404 from then on. A malformed id answers 404 NOT_FOUND, the same as an unknown or removed id. A table with a reservation (or any time hold) that has not ended cannot be removed: 409 CONFLICT with `details.reason` `table_has_upcoming_reservations`, and the table stays active. A reservation ending exactly now has ended. Reservations already made keep referring to a removed table and still show its name. If a reservation races the removal the table may be briefly unavailable and is restored before the 409 is sent; if restoring fails the answer is 500 and the table stays removed.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Table id (24 hex characters). */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Removed. No body. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `NOT_FOUND`: the resource does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `CONFLICT`: the request conflicts with existing data; some cases carry `details` `{ "reason": "duplicate_reservation" | "table_has_upcoming_reservations" }`. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /**
         * Update a table
         * @description Changes the name and/or capacity of an active table (at least one field). Resubmitting the table's own name with different case or spaces is not a conflict. A refused update leaves the table unchanged. A capacity below the party size of upcoming reservations (not yet ended) on this table is still applied; the response lists those reservations in `affectedReservations` (always present, complete, ordered by start instant then id; empty when `capacity` is not in the body) and never changes them. A malformed id answers 404 NOT_FOUND, the same as an unknown or removed id.
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Table id (24 hex characters). */
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    /**
                     * @example {
                     *       "capacity": 6
                     *     }
                     */
                    "application/json": components["schemas"]["UpdateTable"];
                };
            };
            responses: {
                /** @description The updated table and the upcoming reservations its new capacity affects. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UpdatedTable"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `NOT_FOUND`: the resource does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `CONFLICT`: the request conflicts with existing data; some cases carry `details` `{ "reason": "duplicate_reservation" | "table_has_upcoming_reservations" }`. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the weekly schedule
         * @description Returns the weekly service periods: all 7 days, Monday first, periods sorted by start. Before any update every day has no periods (closed). Times are restaurant-local wall-clock values (HH:mm, 00:00–23:59) in the restaurant's time zone; a period cannot cross midnight.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The weekly schedule. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WeeklySchedule"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        /**
         * Replace the weekly schedule
         * @description Replaces the whole schedule. Days may come in any order, each at most once; omitted days are closed. Within a day, periods must not overlap (touching boundaries are allowed) and names must be unique ignoring case. Any error refuses the whole update and leaves the stored schedule unchanged; error indexes refer to the submitted arrays. Returns the stored schedule in normalized form, plus `affectedReservations`: the upcoming reservations (not yet ended) that are no longer fully inside a service period of their weekday under the new schedule (always present, complete, ordered by start instant then id). The schedule is applied even then, and reservations are never changed. Times are restaurant-local wall-clock values (HH:mm, 00:00–23:59) in the restaurant's time zone; a period cannot cross midnight.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    /**
                     * @example {
                     *       "days": [
                     *         {
                     *           "day": "monday",
                     *           "periods": []
                     *         },
                     *         {
                     *           "day": "tuesday",
                     *           "periods": [
                     *             {
                     *               "name": "Lunch",
                     *               "start": "12:00",
                     *               "end": "15:00"
                     *             },
                     *             {
                     *               "name": "Dinner",
                     *               "start": "20:00",
                     *               "end": "23:30"
                     *             }
                     *           ]
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["WeeklySchedule"];
                };
            };
            responses: {
                /** @description The stored schedule, normalized (7 days, Monday first, periods sorted), and the upcoming reservations it contradicts. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReplacedSchedule"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/closed-dates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List closed dates
         * @description Lists closed dates in ascending order, from today onwards unless `includePast=true`. `includePast` accepts exactly "true" or "false". Dates are restaurant-local calendar dates (YYYY-MM-DD); "today" is decided by the server in the restaurant's time zone.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Exactly "true" or "false" (default). "true" also lists past closures. */
                    includePast?: "true" | "false";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Closed dates. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ClosedDate"][];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Close a date
         * @description Marks a calendar date as closed, with an optional reason. The date must exist in the calendar and be today or later (a past date is 400, even if it is already closed). A date that is already closed is 409 CONFLICT. The date is closed even when upcoming reservations (not yet ended) exist on it: they are listed in `affectedReservations` (always present, complete, ordered by start instant then id) and are never changed. Dates are restaurant-local calendar dates (YYYY-MM-DD); "today" is decided by the server in the restaurant's time zone.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    /**
                     * @example {
                     *       "date": "2026-12-25",
                     *       "reason": "Christmas"
                     *     }
                     */
                    "application/json": components["schemas"]["CreateClosedDate"];
                };
            };
            responses: {
                /** @description The closed date and the upcoming reservations on it. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CreatedClosedDate"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `CONFLICT`: the request conflicts with existing data; some cases carry `details` `{ "reason": "duplicate_reservation" | "table_has_upcoming_reservations" }`. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/closed-dates/{date}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Reopen a date
         * @description Removes the closure of a date, including past ones. A malformed or impossible date is 400 (field `params.date`); a valid date that is not closed is 404. Dates are restaurant-local calendar dates (YYYY-MM-DD); "today" is decided by the server in the restaurant's time zone.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Restaurant-local calendar date, exactly YYYY-MM-DD. */
                    date: components["schemas"]["CalendarDate"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Removed. No body. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `NOT_FOUND`: the resource does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check whether a party can be seated
         * @description Public — no sign-in required. Answers whether a party of `partySize` can start a reservation at `time` on `date` (restaurant-local), with a `reason` when it cannot. `reason` is present if and only if `available` is false, and the table that would be assigned is never revealed. When several reasons apply, the first in this order is reported: `too_soon`, `too_far_ahead`, `closed_date`, `closed_day`, `outside_service_hours`, `party_too_large`, `no_table_free`. A party larger than every table is `party_too_large`, not a validation error. The answer is a snapshot and is not cacheable (`Cache-Control: no-store`); a later reservation request can still be refused.
         */
        get: {
            parameters: {
                query: {
                    /** @description Restaurant-local calendar date, exactly YYYY-MM-DD. */
                    date: components["schemas"]["CalendarDate"] & unknown;
                    /** @description Restaurant-local start time, HH:mm (00:00-23:59). */
                    time: components["schemas"]["Time"] & unknown;
                    /** @description Number of guests: a whole number from 1 to 50, without sign or leading zeros. */
                    partySize: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The answer for the requested date, time and party size. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AvailabilityResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/availability/times": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List bookable times for a date
         * @description Public — no sign-in required. Lists the start times at which a party of `partySize` can currently reserve on `date`, grouped by service period under the stored period names, in chronological order; periods without a bookable time are omitted. Times are generated at a fixed interval from the start of each period up to the last start that still ends by the period end, and only times that pass every availability rule are listed, so each listed time is accepted by `GET /availability` and `POST /reservations` if nothing changed in between. A non-empty list carries no `reason`; an empty one carries exactly one, chosen in this order: `too_soon` (date before today), `too_far_ahead`, `closed_date`, `closed_day`, `party_too_large`; then `outside_service_hours` if no service period is long enough for a reservation; then `too_soon` if the minimum notice rules out every remaining time; otherwise `no_table_free`. The answer is a snapshot and is not cacheable (`Cache-Control: no-store`).
         */
        get: {
            parameters: {
                query: {
                    /** @description Restaurant-local calendar date, exactly YYYY-MM-DD. */
                    date: components["schemas"]["CalendarDate"] & unknown;
                    /** @description Number of guests: a whole number from 1 to 50, without sign or leading zeros. */
                    partySize: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Bookable times grouped by service period, or an empty list with a reason. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TimesResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reservations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the reservations of one day (staff)
         * @description Staff sign-in required. Lists the reservations of one restaurant-local date, ordered by start time (ties: table name in natural order, then id). `status` chooses `confirmed` (default), `all` or `cancelled`. The `summary` counts confirmed reservations only under every status choice, so it is identical for all three. Any valid date is accepted, past or future; a day without matches answers 200 with an empty list and a zero summary. The response contains guests' personal data and is never cached. Read-only.
         */
        get: {
            parameters: {
                query: {
                    /**
                     * @description Restaurant-local date, YYYY-MM-DD.
                     * @example 2026-11-14
                     */
                    date: components["schemas"]["CalendarDate"] & unknown;
                    /**
                     * @description Which reservations the list contains: `confirmed` (default) only the confirmed ones, `cancelled` only the cancelled ones, `all` both in one start-time order. It never changes the summary.
                     * @example all
                     */
                    status?: "confirmed" | "all" | "cancelled";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The day view. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DayView"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Reserve a table as a guest
         * @description Public — no sign-in required. Creates a confirmed reservation for a guest and assigns the most suitable free table automatically (smallest capacity that seats the party, then name in natural order); the guest cannot choose it. The response carries the details, the assigned table name and a `secretCode` that is shown only here and is never returned again. Refusal order: validation (400), duplicate reservation (409 `CONFLICT` with `details.reason` `duplicate_reservation`: the same email, trimmed and lowercased, already holds an overlapping reservation), then availability (409 `NO_AVAILABILITY` with `details.reason`; in precedence order `too_soon`, `too_far_ahead`, `closed_date`, `closed_day`, `outside_service_hours`, `party_too_large`, `no_table_free`). `no_table_free` is also the answer to a request that loses a race for the last table to another request. There is no idempotency key: repeating a request that had succeeded is refused as a duplicate reservation, and a retry after a 500 may be refused as a duplicate if a hold remains. After a successful creation a confirmation email with the details and the cancellation link is sent to the guest in the background; a failure to send it never changes this response. The new reservation has status `confirmed` (see `ReservationStatus`).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    /**
                     * @example {
                     *       "date": "2026-11-14",
                     *       "time": "20:30",
                     *       "partySize": 3,
                     *       "name": "Ana García",
                     *       "email": "ana@mail.com",
                     *       "phone": "+34 600 123 456"
                     *     }
                     */
                    "application/json": components["schemas"]["CreateReservation"];
                };
            };
            responses: {
                /** @description The confirmed reservation, including the secret code (shown only here). */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReservationConfirmation"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `CONFLICT`: the request conflicts with existing data; some cases carry `details` `{ "reason": "duplicate_reservation" | "table_has_upcoming_reservations" }`; `NO_AVAILABILITY`: the requested time cannot be booked; `details` is `{ "reason" }` with one of, in precedence order: `too_soon`, `too_far_ahead`, `closed_date`, `closed_day`, `outside_service_hours`, `party_too_large`, `no_table_free`. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reservations/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel a reservation with its secret code
         * @description Public — no sign-in required. Cancels an upcoming confirmed reservation identified by the secret code from its confirmation email. The code is accepted only in the request body, never in the URL, so it does not end up in logs or browser history. On success the table and the guest's time slot are released at once and the guest receives a cancellation email (a failure to send it never changes the answer). Refusal order: validation (400), unknown code (404 `NOT_FOUND`, one generic answer for every code that matches nothing), then 409: `ALREADY_CANCELLED` (safe to repeat, changes nothing) takes precedence over `CANNOT_CANCEL` (the start time has been reached or passed). If the release cannot be completed the answer is 500 and a repeated request with the same code repairs it. The response is never cached.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    /**
                     * @example {
                     *       "code": "Yq3k0v8p1Zr7mWbN2xTfH5cJdL9sAeUoGiPyQ4tKXhE"
                     *     }
                     */
                    "application/json": components["schemas"]["CancelReservation"];
                };
            };
            responses: {
                /** @description The reservation is now cancelled. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CancellationResult"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `NOT_FOUND`: the resource does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `ALREADY_CANCELLED`: the reservation is already cancelled; nothing changes and no email is sent; `CANNOT_CANCEL`: the reservation has already started or ended; nothing changes. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reservations/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel a reservation as staff
         * @description Staff sign-in is required (bearer token). Cancels an upcoming confirmed reservation by its id, with the same rules as the guest cancellation: the table and the guest's time slot are released at once and the guest receives a cancellation email (a failure to send it never changes the answer). Use it for the reservations listed in `affectedReservations` after a closed date, schedule or table change. Check order: authentication (401), then an unknown or malformed id (404 `NOT_FOUND`, the same answer as the guest operation), then 409: `ALREADY_CANCELLED` (safe to repeat, changes nothing) takes precedence over `CANNOT_CANCEL` (the start time has been reached or passed). No request body is needed; one that is sent is ignored. If the release cannot be completed the answer is 500 and a repeated request repairs it. The response is never cached.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Reservation id (24 hex characters). */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The reservation is now cancelled. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CancellationResult"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `NOT_FOUND`: the resource does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `ALREADY_CANCELLED`: the reservation is already cancelled; nothing changes and no email is sent; `CANNOT_CANCEL`: the reservation has already started or ended; nothing changes. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reservations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read one reservation (staff)
         * @description Staff sign-in required. Reads one reservation of any status and date by its id (the ids in `affectedReservations` and in the day view). A malformed or unknown id is 404 `NOT_FOUND` 'Reservation not found'. Contains personal data; never cached. Read-only.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Reservation id (24 hex characters). */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The reservation. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReservationView"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `VALIDATION_ERROR`: the request is invalid (content type, size, JSON syntax, schema or domain rule); `details` lists every offending `field`. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `AUTHENTICATION_REQUIRED`: missing, malformed, tampered or expired bearer token, or a token for a staff member that no longer exists. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `NOT_FOUND`: the resource does not exist. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the OpenAPI document
         * @description Returns this API's OpenAPI 3.1 document, generated from the Zod schemas.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The generated OpenAPI 3.1 document. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OpenApiDocument"];
                    };
                };
                /** @description Error (standard error body). Possible `error.code` values: `INTERNAL_ERROR`: unexpected failure; no `details`, nothing internal is disclosed. */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * @example {
         *       "error": {
         *         "code": "VALIDATION_ERROR",
         *         "message": "Request validation failed",
         *         "details": [
         *           {
         *             "field": "capacity",
         *             "reason": "Too big: expected number to be <=50"
         *           }
         *         ]
         *       }
         *     }
         */
        ErrorResponse: {
            error: {
                /** @enum {string} */
                code: "VALIDATION_ERROR" | "AUTHENTICATION_REQUIRED" | "INVALID_CREDENTIALS" | "NOT_FOUND" | "CONFLICT" | "NO_AVAILABILITY" | "ALREADY_CANCELLED" | "CANNOT_CANCEL" | "SERVICE_UNAVAILABLE" | "INTERNAL_ERROR";
                message: string;
                /** @description Present only for VALIDATION_ERROR (non-empty array of field errors), SERVICE_UNAVAILABLE ({ "database": "down" }), NO_AVAILABILITY ({ "reason": <availability reason> }) and some CONFLICT cases ({ "reason": <conflict reason> }). */
                details?: components["schemas"]["FieldError"][] | {
                    /** @enum {string} */
                    database: "down";
                } | {
                    reason: components["schemas"]["AvailabilityReason"];
                } | {
                    reason: components["schemas"]["ConflictReason"];
                };
            };
        };
        FieldError: {
            /** @example capacity */
            field: string;
            /** @example Too big: expected number to be <=50 */
            reason: string;
        };
        /**
         * @description Why the requested time cannot be booked. When several reasons apply, the first in this order is reported: too_soon, too_far_ahead, closed_date, closed_day, outside_service_hours, party_too_large, no_table_free.
         * @enum {string}
         */
        AvailabilityReason: "too_soon" | "too_far_ahead" | "closed_date" | "closed_day" | "outside_service_hours" | "party_too_large" | "no_table_free";
        /**
         * @description duplicate_reservation: the guest already holds an overlapping reservation. table_has_upcoming_reservations: the table still has reservations that have not ended.
         * @enum {string}
         */
        ConflictReason: "duplicate_reservation" | "table_has_upcoming_reservations";
        /**
         * @description `confirmed`: the reservation holds its table and time. `cancelled`: it was cancelled by the guest or by staff; it stays stored for history but no longer counts anywhere.
         * @enum {string}
         */
        ReservationStatus: "confirmed" | "cancelled";
        Health: {
            /** @enum {string} */
            status: "ok";
            /** @enum {string} */
            database: "up";
        };
        LoginResponse: {
            /** @description HS256 JWT. Send as `Authorization: Bearer <token>`. */
            token: string;
            /**
             * Format: date-time
             * @description UTC instant when the token expires (equals the token's `exp` claim).
             * @example 2026-11-06T18:00:00.000Z
             */
            expiresAt: string;
            staff: components["schemas"]["StaffProfile"];
        };
        StaffProfile: {
            /** @example Ana */
            name: string;
            /** @example ana@resto.com */
            email: string;
        };
        LoginRequest: {
            /** @description Trimmed and lowercased, then checked as an email address. */
            email: string;
            password: string;
        };
        Table: {
            /** @example 6740c0ffee0123456789abcd */
            id: string;
            /** @example T1 */
            name: string;
            /** @example 4 */
            capacity: number;
        };
        CreateTable: {
            /** @description 1–50 characters after trimming; unique among active tables, ignoring case. */
            name: string;
            /** @description Seats, integer 1–50. */
            capacity: number;
        };
        UpdatedTable: {
            /** @example 6740c0ffee0123456789abcd */
            id: string;
            /** @example T1 */
            name: string;
            /** @example 4 */
            capacity: number;
            /** @description Upcoming reservations (not yet ended) on this table whose party size exceeds the new capacity. Always present, complete, ordered by start instant then id; empty when `capacity` is not in the request. Informational: reservations are never modified, moved or cancelled. */
            affectedReservations: components["schemas"]["AffectedReservation"][];
        };
        AffectedReservation: {
            /** @example 6741a0ffee0123456789abcd */
            id: string;
            /** @example 2026-12-24 */
            date: string;
            /** @example 20:00 */
            startTime: string;
            /** @example 22:00 */
            endTime: string;
            /** @example 6 */
            partySize: number;
            /** @example Ana García */
            guestName: string;
            /** @example T5 */
            tableName: string;
            /**
             * @description Always `confirmed`: cancelled reservations are never listed (see `ReservationStatus`).
             * @enum {string}
             */
            status: "confirmed";
        };
        /** @description Partial update; at least one field is required. */
        UpdateTable: {
            /** @description 1–50 characters after trimming; unique among active tables, ignoring case. */
            name?: string;
            /** @description Seats, integer 1–50. */
            capacity?: number;
        };
        WeeklySchedule: {
            days: components["schemas"]["DaySchedule"][];
        };
        /** @description An empty `periods` array means the day is closed. */
        DaySchedule: {
            day: components["schemas"]["DayName"];
            periods: components["schemas"]["ServicePeriod"][];
        };
        /** @enum {string} */
        DayName: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
        /** @description end must be after start; no midnight crossing. */
        ServicePeriod: {
            /** @example Lunch */
            name: string;
            start: components["schemas"]["Time"];
            end: components["schemas"]["Time"];
        };
        /**
         * @description Restaurant-local wall-clock time, HH:mm (00:00–23:59).
         * @example 12:00
         */
        Time: string;
        ReplacedSchedule: {
            days: components["schemas"]["DaySchedule"][];
            /** @description Upcoming reservations (not yet ended) no longer fully inside a service period of their weekday. Always present, complete, ordered by start instant then id. Informational: reservations are never modified, moved or cancelled. */
            affectedReservations: components["schemas"]["AffectedReservation"][];
        };
        CreatedClosedDate: {
            /** @example 2026-12-25 */
            date: string;
            /** @example Christmas */
            reason: string | null;
            /** @description Upcoming reservations (not yet ended) on the newly closed date. Always present, complete, ordered by start instant then id. Informational: reservations are never modified, moved or cancelled. */
            affectedReservations: components["schemas"]["AffectedReservation"][];
        };
        CreateClosedDate: {
            date: components["schemas"]["CalendarDate"];
            /**
             * @description Optional, ≤ 200 characters after trimming; empty or absent → null.
             * @example Christmas
             */
            reason?: string | null;
        };
        /**
         * Format: date
         * @description Restaurant-local calendar date, exactly YYYY-MM-DD.
         * @example 2026-12-25
         */
        CalendarDate: string;
        ClosedDate: {
            /** @example 2026-12-25 */
            date: string;
            /** @example Christmas */
            reason: string | null;
        };
        /**
         * @example {
         *       "date": "2026-11-14",
         *       "time": "21:45",
         *       "partySize": 4,
         *       "available": false,
         *       "reason": "outside_service_hours"
         *     }
         */
        AvailabilityResponse: {
            /** @example 2026-11-14 */
            date: string;
            /** @example 20:30 */
            time: string;
            /** @example 4 */
            partySize: number;
            available: boolean;
            reason?: components["schemas"]["AvailabilityReason"] & unknown;
        };
        /**
         * @example {
         *       "date": "2026-12-24",
         *       "partySize": 2,
         *       "periods": [],
         *       "reason": "closed_date"
         *     }
         */
        TimesResponse: {
            /** @example 2026-11-14 */
            date: string;
            /** @example 2 */
            partySize: number;
            /** @description Bookable start times (restaurant-local HH:mm) grouped by service period, in chronological order. Periods without a bookable time are omitted. */
            periods: {
                /** @example Lunch */
                name: string;
                /**
                 * @example [
                 *       "12:00",
                 *       "12:15",
                 *       "12:30",
                 *       "12:45",
                 *       "13:00"
                 *     ]
                 */
                times: string[];
            }[];
            reason?: components["schemas"]["AvailabilityReason"] & unknown;
        };
        ReservationConfirmation: {
            /** @example 6741a0ffee0123456789abcd */
            id: string;
            /**
             * @description Always `confirmed` on creation (see `ReservationStatus`).
             * @enum {string}
             */
            status: "confirmed";
            /** @example 2026-11-14 */
            date: string;
            /** @example 20:30 */
            startTime: string;
            /** @example 22:30 */
            endTime: string;
            /** @example 3 */
            partySize: number;
            guest: {
                /** @example Ana García */
                name: string;
                /** @example ana@mail.com */
                email: string;
                /** @example +34 600 123 456 */
                phone: string;
            };
            table: {
                /** @example T4 */
                name: string;
            };
            /**
             * @description UTC instant.
             * @example 2026-11-07T10:15:00.000Z
             */
            createdAt: string;
            /**
             * @description Secret code (256 random bits, base64url). Returned only here: it is never stored in plain text, logged or returned again.
             * @example Yq3k0v8p1Zr7mWbN2xTfH5cJdL9sAeUoGiPyQ4tKXhE
             */
            secretCode: string;
        };
        CreateReservation: {
            date: components["schemas"]["CalendarDate"] & unknown;
            time: components["schemas"]["Time"] & unknown;
            /**
             * @description Number of guests, integer 1-50.
             * @example 3
             */
            partySize: number;
            /**
             * @description Guest name, 1-100 characters (UTF-16 code units) after trimming.
             * @example Ana García
             */
            name: string;
            /**
             * @description One email address (no display name, no list), at most 254 characters; stored lowercased.
             * @example ana@mail.com
             */
            email: string;
            /**
             * @description Must be 7-20 characters: digits, spaces, '-', '(' and ')' with an optional leading '+', and at least 7 digits.
             * @example +34 600 123 456
             */
            phone: string;
        };
        /**
         * @example {
         *       "id": "6741a0ffee0123456789abcd",
         *       "status": "cancelled",
         *       "date": "2026-11-14",
         *       "startTime": "20:30",
         *       "endTime": "22:30",
         *       "partySize": 3,
         *       "cancelledAt": "2026-11-10T09:30:00.000Z"
         *     }
         */
        CancellationResult: {
            /** @example 6741a0ffee0123456789abcd */
            id: string;
            /**
             * @description Always `cancelled` here (see `ReservationStatus`).
             * @enum {string}
             */
            status: "cancelled";
            /**
             * @description Restaurant-local date.
             * @example 2026-11-14
             */
            date: string;
            /**
             * @description Restaurant-local start time.
             * @example 20:30
             */
            startTime: string;
            /**
             * @description Restaurant-local end time.
             * @example 22:30
             */
            endTime: string;
            /** @example 3 */
            partySize: number;
            /**
             * @description UTC instant, ISO-8601.
             * @example 2026-11-10T09:30:00.000Z
             */
            cancelledAt: string;
        };
        CancelReservation: {
            /**
             * @description The secret code from the confirmation email, exactly as received (no trimming, no case change). Any text is accepted; a code that matches nothing gets the generic 404.
             * @example Yq3k0v8p1Zr7mWbN2xTfH5cJdL9sAeUoGiPyQ4tKXhE
             */
            code: string;
        };
        /**
         * @example {
         *       "date": "2026-11-14",
         *       "status": "all",
         *       "summary": {
         *         "reservations": 1,
         *         "guests": 3,
         *         "tablesUsed": 1
         *       },
         *       "reservations": [
         *         {
         *           "id": "6741a0ffee0123456789abcd",
         *           "status": "confirmed",
         *           "date": "2026-11-14",
         *           "startTime": "20:30",
         *           "endTime": "22:30",
         *           "partySize": 3,
         *           "guest": {
         *             "name": "Ana García",
         *             "email": "ana@mail.com",
         *             "phone": "+34 600 123 456"
         *           },
         *           "table": {
         *             "name": "T4"
         *           },
         *           "createdAt": "2026-11-07T10:15:00.000Z"
         *         },
         *         {
         *           "id": "6741a0ffee0123456789abce",
         *           "status": "cancelled",
         *           "date": "2026-11-14",
         *           "startTime": "21:00",
         *           "endTime": "23:00",
         *           "partySize": 2,
         *           "guest": {
         *             "name": "Luis Pérez",
         *             "email": "luis@mail.com",
         *             "phone": "+34 600 000 111"
         *           },
         *           "table": {
         *             "name": "T10"
         *           },
         *           "createdAt": "2026-11-07T11:00:00.000Z",
         *           "cancelledAt": "2026-11-10T09:30:00.000Z",
         *           "cancelledBy": "guest"
         *         }
         *       ]
         *     }
         */
        DayView: {
            /** @example 2026-11-14 */
            date: string;
            /**
             * @description Which reservations the list contains: `confirmed` (default) only the confirmed ones, `cancelled` only the cancelled ones, `all` both in one start-time order. It never changes the summary.
             * @example all
             * @enum {string}
             */
            status: "confirmed" | "all" | "cancelled";
            summary: components["schemas"]["ReservationSummary"];
            reservations: components["schemas"]["ReservationView"][];
        };
        /** @description Confirmed reservations only, identical under every status choice. */
        ReservationSummary: {
            /** @example 1 */
            reservations: number;
            /** @example 3 */
            guests: number;
            /** @example 1 */
            tablesUsed: number;
        };
        /**
         * @example {
         *       "id": "6741a0ffee0123456789abcd",
         *       "status": "confirmed",
         *       "date": "2026-11-14",
         *       "startTime": "20:30",
         *       "endTime": "22:30",
         *       "partySize": 3,
         *       "guest": {
         *         "name": "Ana García",
         *         "email": "ana@mail.com",
         *         "phone": "+34 600 123 456"
         *       },
         *       "table": {
         *         "name": "T4"
         *       },
         *       "createdAt": "2026-11-07T10:15:00.000Z"
         *     }
         */
        ReservationView: {
            /**
             * @description Reservation id (24 hex characters).
             * @example 6741a0ffee0123456789abcd
             */
            id: string;
            status: components["schemas"]["ReservationStatus"];
            /**
             * @description Restaurant-local date.
             * @example 2026-11-14
             */
            date: string;
            /**
             * @description Restaurant-local start time.
             * @example 20:30
             */
            startTime: string;
            /**
             * @description Restaurant-local end time.
             * @example 22:30
             */
            endTime: string;
            /** @example 3 */
            partySize: number;
            guest: {
                /** @example Ana García */
                name: string;
                /** @example ana@mail.com */
                email: string;
                /** @example +34 600 123 456 */
                phone: string;
            };
            table: {
                /**
                 * @description The table's current name.
                 * @example T4
                 */
                name: string;
            };
            /**
             * @description UTC instant, ISO-8601.
             * @example 2026-11-07T10:15:00.000Z
             */
            createdAt: string;
            /**
             * @description Present only when cancelled. UTC instant, ISO-8601.
             * @example 2026-11-10T09:30:00.000Z
             */
            cancelledAt?: string;
            /**
             * @description Present only when cancelled: who cancelled.
             * @example guest
             * @enum {string}
             */
            cancelledBy?: "guest" | "staff";
        };
        /** @description An OpenAPI 3.1 document. */
        OpenApiDocument: {
            openapi: string;
            info: {
                [key: string]: unknown;
            };
            paths: {
                [key: string]: unknown;
            };
        } & {
            [key: string]: unknown;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
