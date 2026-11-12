// Generates src/api/schema.d.ts from the backend's OpenAPI document.
//   node scripts/api-types.mjs           -> writes the file
//   node scripts/api-types.mjs --check   -> exits 1 if the file is out of date
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const specUrl = process.env.API_SPEC_URL ?? "http://localhost:3000/openapi.json";
const target = fileURLToPath(new URL("../src/api/schema.d.ts", import.meta.url));
const check = process.argv.includes("--check");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let generated;
try {
  const response = await fetch(specUrl);
  if (!response.ok) {
    fail(`Could not read the API description (the server answered ${String(response.status)}).`);
  }
  const document = await response.json();
  const ast = await openapiTS(document);
  generated = astToString(ast);
} catch {
  fail("Could not read the API description. Is the backend running?");
}

if (check) {
  let current = "";
  try {
    current = await readFile(target, "utf8");
  } catch {
    fail("src/api/schema.d.ts does not exist. Run `npm run api:types`.");
  }
  if (current !== generated) {
    fail("src/api/schema.d.ts is out of date with the backend. Run `npm run api:types`.");
  }
  process.stdout.write("API types are up to date.\n");
} else {
  await writeFile(target, generated, "utf8");
  process.stdout.write("Wrote src/api/schema.d.ts.\n");
}
