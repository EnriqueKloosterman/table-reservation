import { createApp } from "./app.js";
import { ConfigError, loadConfig, type Config } from "./config/env.js";
import { connectDatabase, disconnectDatabase, initModels } from "./db/connection.js";

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error("Invalid configuration. Fix these environment variables:");
      for (const issue of err.issues) console.error(`  - ${issue.key}: ${issue.message}`);
      process.exit(1);
    }
    throw err;
  }
}

const config = loadConfigOrExit();
await connectDatabase(config.MONGODB_URI);
await initModels();

const server = createApp({ config }).listen(config.PORT, () => {
  console.log(`Listening on http://localhost:${config.PORT} (docs at /docs)`);
});

function shutdown(): void {
  server.close(() => {
    void disconnectDatabase().then(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
