import { OpenApiGeneratorV31, type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import swaggerUi from "swagger-ui-express";
import { defineRoute, type RouteContext } from "./route.js";
import { z } from "./zod.js";

const API_DESCRIPTION =
  "Staff API of the table reservation system: sign-in, tables, weekly service hours and " +
  "closed dates.";

export function buildOpenApiDocument(registry: OpenAPIRegistry) {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "Table Reservation API", version: "0.1.0", description: API_DESCRIPTION },
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
