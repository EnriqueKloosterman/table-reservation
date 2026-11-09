import express, { type RequestHandler } from "express";
import type { z } from "zod";
import { validationError, type FieldError } from "../errors/app-error.js";
import { zodIssuesToDetails } from "./zod-issues.js";

export const BODY_LIMIT = "100kb";

/**
 * Per-route JSON body parser. Mounted by `defineRoute` only on routes with a body schema and
 * after `requireAuth`, so unknown routes answer 404 and protected routes 401 before any body
 * is read.
 */
export function jsonBody(): RequestHandler[] {
  const requireJsonContentType: RequestHandler = (req, _res, next) => {
    const mediaType = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      next(validationError([{ field: "body", reason: "Content-Type must be application/json" }]));
      return;
    }
    next();
  };
  return [requireJsonContentType, express.json({ limit: BODY_LIMIT, strict: true })];
}

export type ValidationSchemas = {
  params?: z.ZodType | undefined;
  query?: z.ZodType | undefined;
  body?: z.ZodType | undefined;
};

export type ValidatedInput = { params: unknown; query: unknown; body: unknown };

/**
 * Validates params, query and body, collecting the issues of all three before failing, and
 * stores the parsed values in `res.locals.input`. Missing schemas leave that part `undefined`.
 */
export function buildValidationStep(schemas: ValidationSchemas = {}): RequestHandler {
  return (req, res, next) => {
    const details: FieldError[] = [];
    const input: ValidatedInput = { params: undefined, query: undefined, body: undefined };

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) input.params = result.data;
      else details.push(...zodIssuesToDetails(result.error, "params"));
    }
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) input.query = result.data;
      else details.push(...zodIssuesToDetails(result.error, "query"));
    }
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) input.body = result.data;
      else details.push(...zodIssuesToDetails(result.error));
    }

    if (details.length > 0) {
      next(validationError(details));
      return;
    }
    res.locals.input = input;
    next();
  };
}
