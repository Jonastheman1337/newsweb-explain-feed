#!/usr/bin/env node

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const INFRA_KEYS = new Set([
  "DATABASE_URL",
  "REDIS_URL",
  "API_BASE_URL",
  "API_PORT",
  "PORT",
  "GENERATION_LOG_DATABASE_URL",
  "START_WORKER",
  "NEWSWEB_POLLING_ENABLED",
  "NODE_OPTIONS"
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseEnv(path) {
  if (!path) return {};
  const text = readFileSync(resolve(path), "utf8");
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      if (match[2].startsWith('"')) {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"');
      }
    }
    values[match[1]] = value;
  }
  return values;
}

function encodeValue(value) {
  if (/^[A-Za-z0-9_./:@,+-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

const variablesPath = argument("--variables");
const secretFilePath = argument("--secret-file");
const loginSourcePath = argument("--login-source");
const outputPath = argument("--out");
const force = process.argv.includes("--force");

if (!variablesPath || !outputPath) {
  throw new Error(
    "Usage: merge-render-env.mjs --variables <export.env> [--secret-file <render-secret.env>] [--login-source <verified.env>] --out <app.env> [--force]"
  );
}

const absoluteOutput = resolve(outputPath);
if (existsSync(absoluteOutput) && !force) {
  throw new Error(`Refusing to overwrite ${absoluteOutput} without --force.`);
}

const merged = {
  ...parseEnv(secretFilePath),
  ...parseEnv(variablesPath)
};
const verifiedLogin = parseEnv(loginSourcePath);
for (const key of ["LOGIN_USERNAME", "LOGIN_PASSWORD"]) {
  if (!merged[key] && verifiedLogin[key]) merged[key] = verifiedLogin[key];
}
for (const key of INFRA_KEYS) delete merged[key];

merged.DEV_AUTH_BYPASS = "false";
merged.MAGIC_LINK_BASE_URL = "https://autoweb24.no/login";

for (const required of [
  "ADMIN_API_KEY",
  "LOGIN_PASSWORD",
  "LOGIN_USERNAME",
  "SESSION_SECRET"
]) {
  if (!merged[required]) throw new Error(`${required} is missing from the merged Render configuration.`);
}
if (!merged.OPENAI_API_KEY && !merged.LITELLM_API_KEY && !merged.ANTHROPIC_API_KEY) {
  throw new Error("No model-provider credential is present in the merged Render configuration.");
}

const output = Object.entries(merged)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `${key}=${encodeValue(String(value))}`)
  .join("\n");

writeFileSync(absoluteOutput, `${output}\n`, { encoding: "utf8", mode: 0o600 });
try {
  chmodSync(absoluteOutput, 0o600);
} catch {
  // Windows does not provide POSIX modes; the server-side copy is chmodded separately.
}
console.log(`Wrote ${Object.keys(merged).length} variables to ${absoluteOutput} without printing values.`);
