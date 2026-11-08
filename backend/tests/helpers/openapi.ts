import type { Express } from "express";
import request from "supertest";

export type OperationObject = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: { required?: boolean; content?: Record<string, { example?: unknown; examples?: unknown }> };
  responses: Record<
    string,
    { description?: string; content?: Record<string, { schema?: { $ref?: string } }> }
  >;
};

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, OperationObject>>;
  components: { securitySchemes?: Record<string, unknown>; schemas?: Record<string, unknown> };
};

export type Operation = { method: string; path: string; key: string; op: OperationObject };

export async function fetchOpenApi(app: Express): Promise<OpenApiDocument> {
  const res = await request(app).get("/openapi.json");
  if (res.status !== 200) throw new Error(`GET /openapi.json returned ${res.status}`);
  return res.body as OpenApiDocument;
}

/** Every operation as `{ method: "GET", path: "/tables/{id}", key: "GET /tables/{id}" }`. */
export function operationsOf(doc: OpenApiDocument): Operation[] {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, op]) => ({
      method: method.toUpperCase(),
      path,
      key: `${method.toUpperCase()} ${path}`,
      op,
    })),
  );
}
