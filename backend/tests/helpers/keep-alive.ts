import http from "node:http";
import type { Express } from "express";
import request from "supertest";
import { afterAll } from "vitest";

/**
 * Heavy suites send thousands of requests. `request(app)` opens a fresh connection (and a
 * fresh ephemeral port) for each of them; on Windows the closed ports linger in TIME_WAIT and
 * a few consecutive runs end in `EADDRINUSE`. `kept(app)` serves the app from one listening
 * server per app and reuses connections through a keep-alive agent. Same API as supertest.
 */
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
const servers = new Map<Express, http.Server>();

function serverFor(app: Express): http.Server {
  let server = servers.get(app);
  if (!server) {
    server = http.createServer(app).listen(0, "127.0.0.1");
    servers.set(app, server);
  }
  return server;
}

afterAll(async () => {
  agent.destroy();
  await Promise.all(
    [...servers.values()].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  servers.clear();
});

type Method = "get" | "post" | "put" | "patch" | "delete";

export function kept(app: Express): Record<Method, (path: string) => request.Test> {
  const target = request(serverFor(app));
  const method = (name: Method) => (path: string) => target[name](path).agent(agent);
  return {
    get: method("get"),
    post: method("post"),
    put: method("put"),
    patch: method("patch"),
    delete: method("delete"),
  };
}
