import { serviceUnavailable } from "../../shared/errors/app-error.js";
import type { RouteHandler } from "../../shared/openapi/route.js";

export type HealthController = {
  check: RouteHandler<undefined, undefined, undefined>;
};

/** HTTP handler for the public health check. */
export function createHealthController(isDatabaseUp: () => boolean): HealthController {
  return {
    check: (_req, res) => {
      if (!isDatabaseUp()) throw serviceUnavailable();
      res.json({ status: "ok", database: "up" });
    },
  };
}
