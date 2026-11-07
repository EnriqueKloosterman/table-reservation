import type { OpenAPIRegistry, ResponseConfig, RouteConfig } from "@asteasolutions/zod-to-openapi";
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import type { ZodObject, ZodType, z } from "zod";
import type { Config } from "../../config/env.js";
import type { Clock } from "../clock.js";
import { ERROR_STATUS, type ErrorCode } from "../errors/app-error.js";
import type { AuthenticatedStaff } from "../middleware/require-auth.js";
import { buildValidationStep, jsonBody } from "../validation/validate.js";
import { ErrorResponseSchema } from "./common.js";

export type RouteContext = {
  router: Router;
  registry: OpenAPIRegistry;
  requireAuth: RequestHandler;
  config: Config;
  clock: Clock;
};

type Method = "get" | "post" | "put" | "patch" | "delete";

type Output<T> = T extends ZodType ? z.output<T> : undefined;

export type RouteLocals<P, Q, B> = {
  input: { params: Output<P>; query: Output<Q>; body: Output<B> };
  /** Set by `requireAuth` on routes with `auth: true`. */
  staff: AuthenticatedStaff;
};

export type RouteHandler<P, Q, B> = (
  req: Request,
  res: Response<unknown, RouteLocals<P, Q, B>>,
  next: NextFunction,
) => void | Promise<void>;

export type RouteDefinition<
  P extends ZodObject | undefined,
  Q extends ZodObject | undefined,
  B extends ZodType | undefined,
> = {
  method: Method;
  /** Express-style path, e.g. `/tables/:id`. */
  path: string;
  summary: string;
  description: string;
  tags: string[];
  auth: boolean;
  request?: {
    params?: P;
    query?: Q;
    body?: { schema: B; example: unknown };
  };
  success: {
    status: number;
    description: string;
    schema?: ZodType;
    headers?: ResponseConfig["headers"];
  };
  /** Error codes the operation can produce besides 401 (added when `auth`) and 500 (always). */
  errors: ErrorCode[];
  handler: RouteHandler<P, Q, B>;
};

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

const CODE_MEANING: Record<ErrorCode, string> = {
  VALIDATION_ERROR:
    "the request is invalid (content type, size, JSON syntax, schema or domain rule); " +
    "`details` lists every offending `field`",
  AUTHENTICATION_REQUIRED:
    "missing, malformed, tampered or expired bearer token, or a token for a staff member " +
    "that no longer exists",
  INVALID_CREDENTIALS: "unknown email or wrong password (same refusal for both)",
  NOT_FOUND: "the resource does not exist",
  CONFLICT:
    "the request conflicts with existing data; some cases carry `details` `{ \"reason\": \"duplicate_reservation\" | \"table_has_upcoming_reservations\" }`",
  NO_AVAILABILITY:
    "the requested time cannot be booked; `details` is `{ \"reason\" }` with one of, in " +
    "precedence order: `too_soon`, `too_far_ahead`, `closed_date`, `closed_day`, " +
    "`outside_service_hours`, `party_too_large`, `no_table_free`",
  SERVICE_UNAVAILABLE: 'the database is not connected; `details` is `{ "database": "down" }`',
  INTERNAL_ERROR: "unexpected failure; no `details`, nothing internal is disclosed",
};

function errorResponses(codes: ErrorCode[]): Record<string, ResponseConfig> {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of new Set(codes)) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  const responses: Record<string, ResponseConfig> = {};
  for (const [status, statusCodes] of [...byStatus].sort(([a], [b]) => a - b)) {
    const list = statusCodes.map((c) => `\`${c}\`: ${CODE_MEANING[c]}`).join("; ");
    responses[String(status)] = {
      description: `Error (standard error body). Possible \`error.code\` values: ${list}.`,
      content: { "application/json": { schema: ErrorResponseSchema } },
    };
  }
  return responses;
}

/**
 * Registers one operation in the OpenAPI registry and mounts it on the router as
 * `requireAuth` (if `auth`) → `jsonBody()` (if a body schema) → validation → handler, which
 * implements the refusal order 404 (route match) → 401 → 400.
 */
export function defineRoute<
  P extends ZodObject | undefined = undefined,
  Q extends ZodObject | undefined = undefined,
  B extends ZodType | undefined = undefined,
>(ctx: RouteContext, def: RouteDefinition<P, Q, B>): void {
  const { request, success } = def;

  const codes: ErrorCode[] = [...def.errors];
  if (def.auth) codes.push("AUTHENTICATION_REQUIRED");
  codes.push("INTERNAL_ERROR");

  const successResponse: ResponseConfig = {
    description: success.description,
    ...(success.schema && { content: { "application/json": { schema: success.schema } } }),
    ...(success.headers && { headers: success.headers }),
  };

  const routeConfig: RouteConfig = {
    method: def.method,
    path: toOpenApiPath(def.path),
    summary: def.summary,
    description: def.description,
    tags: def.tags,
    ...(def.auth && { security: [{ bearerAuth: [] }] }),
    request: {
      ...(request?.params && { params: request.params }),
      ...(request?.query && { query: request.query }),
      ...(request?.body && {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: request.body.schema as ZodType,
              example: request.body.example,
            },
          },
        },
      }),
    },
    responses: { [String(success.status)]: successResponse, ...errorResponses(codes) },
  };
  ctx.registry.registerPath(routeConfig);

  const handlers: RequestHandler[] = [
    ...(def.auth ? [ctx.requireAuth] : []),
    ...(request?.body ? jsonBody() : []),
    buildValidationStep({
      params: request?.params,
      query: request?.query,
      body: request?.body?.schema,
    }),
    def.handler as unknown as RequestHandler,
  ];
  ctx.router[def.method](def.path, ...handlers);
}
