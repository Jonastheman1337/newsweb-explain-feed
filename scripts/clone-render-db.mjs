#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const COMPOSE_FILE = "infra/docker-compose.prod-local.yml";
const APP_SOURCE_ENV = "RENDER_DATABASE_EXTERNAL_URL";
const LOG_SOURCE_ENV = "RENDER_LOG_DATABASE_EXTERNAL_URL";
const RENDER_API_ENV = "RENDER_API";
const APP_TARGET_URL = "postgresql://newsweb:newsweb@postgres:5432/newsweb_explain";
const LOG_TARGET_URL =
  "postgresql://newsweblog:newsweblog@postgres-log:5432/newsweb_generation_logs";

function usage() {
  return [
    "Usage: npm run local:prod:clone-db",
    "",
    "Required .env value:",
    `  ${APP_SOURCE_ENV}=postgresql://...`,
    "",
    "Optional .env value:",
    `  ${LOG_SOURCE_ENV}=postgresql://...`,
    `  ${RENDER_API_ENV}=rnd_...`,
    "",
    "Use Render's External Database URL values, not the internal Render service URLs.",
    "The script restores into the isolated local newsweb-prod-local Compose databases."
  ].join("\n");
}

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return {};
  const values = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function envValue(envFile, name) {
  return process.env[name] || envFile[name] || "";
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function postgresToolUrl(value) {
  const url = new URL(value);
  url.searchParams.delete("schema");
  return url.toString();
}

function renderPostgresIdFromUrl(value) {
  const host = new URL(value).hostname;
  const match = host.match(/^(dpg-[a-z0-9-]+)/i);
  return match?.[1] ?? null;
}

function assertSourceUrl(name, value) {
  if (!value) {
    throw new Error(`${name} is missing.\n\n${usage()}`);
  }

  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${name} must be a PostgreSQL connection URL.`);
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "postgres" ||
    host === "postgres-log"
  ) {
    throw new Error(`${name} must point at Render's external database, not a local DB.`);
  }
}

async function fetchRenderJson(path, token, options = {}) {
  const response = await fetch(`https://api.render.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Render API ${path} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function latestRenderExportUrl(postgresId, token) {
  try {
    await fetchRenderJson(`/postgres/${postgresId}/export`, token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: "{}"
    });
  } catch (error) {
    console.warn(
      `[clone-db] Render export request failed; checking for an existing export. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const exports = await fetchRenderJson(`/postgres/${postgresId}/export`, token);
    const latest = [...exports]
      .filter((item) => item.url)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
    if (latest?.url) {
      return latest.url;
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  throw new Error(`Render export for ${postgresId} was not ready after 5 minutes.`);
}

async function restoreDatabaseFromExport(label, exportUrl, targetUrl) {
  console.log(`[clone-db] Restoring ${label} database from Render export...`);
  await run(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "newsweb-prod-local_default",
      "-e",
      "EXPORT_URL",
      "-e",
      "TARGET_DATABASE_URL",
      "postgres:16-alpine",
      "sh",
      "-c",
      [
        "set -eu",
        "psql \"$TARGET_DATABASE_URL\" -v ON_ERROR_STOP=1 -c 'drop schema if exists public cascade; create schema public;'",
        "rm -rf /tmp/render-export /tmp/export.tar.gz",
        "mkdir -p /tmp/render-export",
        "wget -q -O /tmp/export.tar.gz \"$EXPORT_URL\"",
        "tar -xzf /tmp/export.tar.gz -C /tmp/render-export",
        "dumpdir=$(find /tmp/render-export -type f -name toc.dat -exec dirname {} \\; | head -1)",
        "test -n \"$dumpdir\"",
        "pg_restore --no-owner --no-acl --dbname \"$TARGET_DATABASE_URL\" \"$dumpdir\""
      ].join("; ")
    ],
    {
      env: {
        ...process.env,
        EXPORT_URL: exportUrl,
        TARGET_DATABASE_URL: targetUrl
      }
    }
  );
}

async function restoreDatabaseWithPgDump(label, sourceUrl, targetUrl) {
  console.log(`[clone-db] Restoring ${label} database with pg_dump...`);
  await run(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "newsweb-prod-local_default",
      "-e",
      "SOURCE_DATABASE_URL",
      "-e",
      "TARGET_DATABASE_URL",
      "postgres:16-alpine",
      "sh",
      "-c",
      [
        "set -eu",
        "pg_dump --format=custom --no-owner --no-acl --file /tmp/source.dump \"$SOURCE_DATABASE_URL\"",
        "psql \"$TARGET_DATABASE_URL\" -v ON_ERROR_STOP=1 -c 'drop schema if exists public cascade; create schema public;'",
        "pg_restore --no-owner --no-acl --dbname \"$TARGET_DATABASE_URL\" /tmp/source.dump"
      ].join("; ")
    ],
    {
      env: {
        ...process.env,
        SOURCE_DATABASE_URL: postgresToolUrl(sourceUrl),
        TARGET_DATABASE_URL: targetUrl
      }
    }
  );
}

async function restoreDatabase(label, sourceUrl, targetUrl, renderToken) {
  const postgresId = renderPostgresIdFromUrl(sourceUrl);
  if (postgresId && renderToken) {
    const exportUrl = await latestRenderExportUrl(postgresId, renderToken);
    await restoreDatabaseFromExport(label, exportUrl, targetUrl);
    return;
  }

  await restoreDatabaseWithPgDump(label, sourceUrl, targetUrl);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const envFile = loadEnvFile();
  const appSourceUrl = envValue(envFile, APP_SOURCE_ENV);
  const logSourceUrl = envValue(envFile, LOG_SOURCE_ENV);
  const renderToken = envValue(envFile, RENDER_API_ENV);

  assertSourceUrl(APP_SOURCE_ENV, appSourceUrl);
  if (logSourceUrl) {
    assertSourceUrl(LOG_SOURCE_ENV, logSourceUrl);
  }

  console.log("[clone-db] Starting isolated local database containers...");
  await run("docker", [
    "compose",
    "--env-file",
    ".env",
    "-f",
    COMPOSE_FILE,
    "up",
    "-d",
    "--wait",
    "postgres",
    "postgres-log"
  ]);

  await restoreDatabase("app", appSourceUrl, APP_TARGET_URL, renderToken);

  if (logSourceUrl) {
    await restoreDatabase("generation log", logSourceUrl, LOG_TARGET_URL, renderToken);
  } else {
    console.log(
      `[clone-db] ${LOG_SOURCE_ENV} is not set; leaving the local generation log DB empty.`
    );
  }

  console.log("[clone-db] Local production-like databases are ready.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
