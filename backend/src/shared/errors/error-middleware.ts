import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { zodIssuesToDetails } from "../validation/zod-issues.js";
import { AppError, ERROR_STATUS, conflict, validationError } from "./app-error.js";
import { logUnexpectedError } from "./log-error.js";

type BodyParserError = { type: string; status?: number };

function isBodyParserError(err: unknown): err is BodyParserError {
  return typeof err === "object" && err !== null && typeof (err as BodyParserError).type === "string";
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;
}

function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return validationError(zodIssuesToDetails(err));
  if (isDuplicateKeyError(err)) return conflict("Resource already exists");
  if (isBodyParserError(err)) {
    if (err.type === "entity.parse.failed") {
      return validationError([{ field: "body", reason: "Malformed JSON" }]);
    }
    if (err.type === "entity.too.large") {
      return validationError([{ field: "body", reason: "Request body exceeds 100 kB" }]);
    }
    // Other client-side body faults (unsupported charset/encoding, aborted request, …).
    if (err.status !== undefined && err.status >= 400 && err.status < 500) {
      return validationError([{ field: "body", reason: "Invalid request body" }]);
    }
  }
  return undefined;
}

/** Maps every error to the standard `{ error: { code, message, details? } }` body. */
export const errorMiddleware: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const appError = toAppError(err);
  if (!appError) {
    logUnexpectedError("unexpected_error", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
    });
    return;
  }
  res.status(ERROR_STATUS[appError.code]).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && { details: appError.details }),
    },
  });
};
