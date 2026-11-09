import { OpenApiGeneratorV31, type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import swaggerUi from "swagger-ui-express";
import { defineRoute, type RouteContext } from "./route.js";
import { z } from "./zod.js";

const API_DESCRIPTION = `Staff API of the table reservation system: sign-in, tables, weekly service hours and closed dates.

## Signing in from this page
1. Open \`POST /auth/login\`, choose **Try it out**, enter your staff email and password and **Execute**.
2. Copy the \`token\` from the response.
3. Click **Authorize**, paste the token (without the \`Bearer \` prefix) and confirm. The token is kept across page reloads until it expires (\`expiresAt\`).
4. Call any protected (🔒) operation.

## Errors
Every error has the body \`{ "error": { "code", "message", "details"? } }\`. Branch on \`error.code\` (and, for validation errors, on \`details[].field\`); \`message\` and \`reason\` are human-readable and may change.
- \`VALIDATION_ERROR\` 400 — \`details\` lists every offending field (\`name\`, \`days[1].periods[0].end\`, \`query.includePast\`, \`params.date\`, or \`body\` for the body as a whole).
- \`AUTHENTICATION_REQUIRED\` 401, \`INVALID_CREDENTIALS\` 401, \`NOT_FOUND\` 404, \`CONFLICT\` 409, \`SERVICE_UNAVAILABLE\` 503 (health only), \`INTERNAL_ERROR\` 500.
- Precedence: unknown route (404) → authentication (401) → validation (400) → existence (404) → uniqueness (409).

## Request rules
Bodies must be \`application/json\`, at most 100 kB; objects are strict (unknown fields are refused) and \`null\` is refused unless stated. Times (\`HH:mm\`) and dates (\`YYYY-MM-DD\`) are restaurant-local; "today" is decided by the server.`;

export function buildOpenApiDocument(registry: OpenAPIRegistry) {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "Table Reservation API", version: "0.1.0", description: API_DESCRIPTION },
    servers: [{ url: "/" }],
  });
}

const OpenApiDocumentSchema = z
  .looseObject({ openapi: z.string(), info: z.looseObject({}), paths: z.looseObject({}) })
  .openapi("OpenApiDocument", { description: "An OpenAPI 3.1 document." });

/** Adds `GET /openapi.json` (generated lazily, after every route is registered) and `/docs`. */
export function registerDocsRoutes(ctx: RouteContext): void {
  let document: ReturnType<typeof buildOpenApiDocument> | undefined;

  defineRoute(ctx, {
    method: "get",
    path: "/openapi.json",
    summary: "Get the OpenAPI document",
    description: "Returns this API's OpenAPI 3.1 document, generated from the Zod schemas.",
    tags: ["Documentation"],
    auth: false,
    success: {
      status: 200,
      description: "The generated OpenAPI 3.1 document.",
      schema: OpenApiDocumentSchema,
    },
    errors: [],
    handler: (_req, res) => {
      document ??= buildOpenApiDocument(ctx.registry);
      res.json(document);
    },
  });

  ctx.router.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
      swaggerOptions: { url: "/openapi.json", persistAuthorization: true, tryItOutEnabled: true },
    }),
  );
}
