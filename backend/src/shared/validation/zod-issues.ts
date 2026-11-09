import type { ZodError } from "zod";
import type { FieldError } from "../errors/app-error.js";

function formatPath(path: readonly PropertyKey[], prefix?: "query" | "params"): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? String(segment) : `.${String(segment)}`;
  }
  if (out === "") return prefix ?? "body";
  if (!prefix) return out;
  return out.startsWith("[") ? `${prefix}${out}` : `${prefix}.${out}`;
}

/** Converts Zod issues into `details` entries using the API field-path convention. */
export function zodIssuesToDetails(error: ZodError, prefix?: "query" | "params"): FieldError[] {
  const details: FieldError[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        details.push({ field: formatPath([...issue.path, key], prefix), reason: "Unknown field" });
      }
    } else {
      details.push({ field: formatPath(issue.path, prefix), reason: issue.message });
    }
  }
  return details;
}
