#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function loadEnvFile() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => {
        let value = match[2].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [match[1], value];
      })
  );
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") return { help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    index += 1;
    if (key === "--from") result.from = value;
    else if (key === "--to") result.to = value;
    else if (key === "--output") result.output = value;
    else throw new Error(`Unknown argument: ${key}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.from ?? "")) {
    throw new Error("--from YYYY-MM-DD is required");
  }
  result.to ??= result.from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.to)) {
    throw new Error("--to must be YYYY-MM-DD");
  }
  result.output ??= `tmp/openai-organization-usage-${result.from}_${result.to}.json`;
  return result;
}

async function fetchPages(path, params, apiKey) {
  const rows = [];
  let page = null;
  do {
    const url = new URL(`https://api.openai.com${path}`);
    for (const [key, values] of Object.entries(params)) {
      for (const value of Array.isArray(values) ? values : [values]) {
        url.searchParams.append(key, String(value));
      }
    }
    if (page) url.searchParams.set("page", page);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
    }
    const body = await response.json();
    rows.push(...(Array.isArray(body.data) ? body.data : []));
    page = body.has_more && typeof body.next_page === "string" ? body.next_page : null;
  } while (page);
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: npm run openai:usage -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--output PATH]");
    return;
  }
  const env = loadEnvFile();
  const apiKey = process.env.OPENAI_ADMIN_KEY || env.OPENAI_ADMIN_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_ADMIN_KEY is not configured; organization reconciliation was skipped");
  }
  const startTime = Math.floor(new Date(`${args.from}T00:00:00Z`).getTime() / 1000);
  const endTime = Math.floor(
    (new Date(`${args.to}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000) / 1000
  );
  const common = {
    start_time: startTime,
    end_time: endTime,
    bucket_width: "1d",
    limit: 31
  };
  const [completions, costs] = await Promise.all([
    fetchPages(
      "/v1/organization/usage/completions",
      { ...common, "group_by[]": ["model", "service_tier", "project_id"] },
      apiKey
    ),
    fetchPages(
      "/v1/organization/costs",
      { ...common, "group_by[]": ["project_id", "line_item"] },
      apiKey
    )
  ]);
  const artifact = {
    exportedAt: new Date().toISOString(),
    from: args.from,
    to: args.to,
    completions,
    costs
  };
  const output = resolve(process.cwd(), args.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
