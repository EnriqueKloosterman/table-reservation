import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { ErrorResponseSchema } from "./common.js";

/** A fresh registry per app, so test apps never share registered paths. */
export function createRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();
  registry.register("ErrorResponse", ErrorResponseSchema);
  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  return registry;
}
