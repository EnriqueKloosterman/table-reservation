import type { RequestHandler } from "express";
import { notFound } from "./app-error.js";

/** Fallback for any unmatched method + path. There is no 405. */
export const notFoundMiddleware: RequestHandler = (_req, _res, next) => {
  next(notFound("Route not found"));
};
