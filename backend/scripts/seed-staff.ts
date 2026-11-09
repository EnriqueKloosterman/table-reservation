import { connectDatabase, disconnectDatabase, initModels } from "../src/db/connection.js";
import {
  ProvisionConfigError,
  parseProvisionEnv,
  provisionStaff,
} from "../src/modules/auth/provision-staff.js";

let input: ReturnType<typeof parseProvisionEnv>;
try {
  input = parseProvisionEnv();
} catch (err) {
  if (err instanceof ProvisionConfigError) {
    console.error("Invalid staff provisioning configuration. Fix these environment variables:");
    for (const key of err.keys) console.error(`  - ${key}`);
    process.exit(1);
  }
  throw err;
}

await connectDatabase(input.mongoUri);
await initModels();
const result = await provisionStaff(input);
console.log(result === "created" ? "created" : "already exists");
await disconnectDatabase();
process.exit(0);
