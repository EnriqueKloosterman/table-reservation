import { MongoMemoryServer } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

let server: MongoMemoryServer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  server = await MongoMemoryServer.create();
  project.provide("mongoUri", server.getUri());
  return async () => {
    await server?.stop();
    server = undefined;
  };
}
