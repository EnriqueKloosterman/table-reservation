import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, inject } from "vitest";
import { initModels } from "../../src/db/connection.js";

/**
 * Connects Mongoose to a database unique to the calling test file, clears every collection
 * before each test and drops the database afterwards.
 */
export function useTestDatabase(): void {
  beforeAll(async () => {
    await mongoose.connect(inject("mongoUri"), { dbName: `test_${randomUUID()}` });
    await initModels();
  });

  beforeEach(async () => {
    const collections = Object.values(mongoose.connection.collections);
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}
