#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  COUNTERFACTUAL_MODELS,
  OPENAI_PRICING_SNAPSHOT,
  calculateOpenAICost,
  roundUsd
} from "./openai-costs.mjs";

const DEFAULT_TABS = ["feedback", "edits", "titles", "events", "generations"];
const DEFAULT_TIMEZONE = "Europe/Oslo";
const DEFAULT_SERVICE_NAME = "autoweb";
const DEFAULT_RENDER_API = "https://api.render.com/v1";
const DEFAULT_LIMIT = 500;

function usage() {
  return [
    "Usage: node scripts/pull-signals.mjs --from YYYY-MM-DD [--to YYYY-MM-DD]",
    "   or: node scripts/pull-signals.mjs YYYY-MM-DD [YYYY-MM-DD]",
    "",
    "Options:",
    "  --from YYYY-MM-DD       Local start date, inclusive. Required.",
    "  --to YYYY-MM-DD         Local end date, inclusive. Defaults to --from.",
    "  --timezone IANA         Local timezone. Defaults to Europe/Oslo.",
    "  --base-url URL          Autoweb base URL. Defaults to Render service URL.",
    "  --render-service NAME   Render service name. Defaults to autoweb.",
    "  --output PATH           Output JSON path. Defaults to tmp/render-signals-export-review-FROM_TO.json.",
    "  --limit N               Per-tab/day admin export limit. Defaults to 500.",
    "  --no-raw                Omit raw CSV rows from the JSON artifact.",
    "  --help                  Show this help.",
    "",
    "The script reads RENDER_API from .env or the environment, discovers the",
    "Render service, reads LOGIN_USERNAME/LOGIN_PASSWORD via Render env-vars,",
    "logs in to the live app, exports /api/admin/signals/export CSVs, and filters",
    "the over-fetched UTC days back to the requested local date range."
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    timezone: DEFAULT_TIMEZONE,
    renderService: DEFAULT_SERVICE_NAME,
    limit: DEFAULT_LIMIT,
    includeRaw: true,
    positionals: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args.positionals.push(arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--no-raw") {
      args.includeRaw = false;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    i += 1;
    if (arg === "--from") args.from = next;
    else if (arg === "--to") args.to = next;
    else if (arg === "--timezone") args.timezone = next;
    else if (arg === "--base-url") args.baseUrl = next.replace(/\/$/, "");
    else if (arg === "--render-service") args.renderService = next;
    else if (arg === "--output") args.output = next;
    else if (arg === "--limit") args.limit = Number(next);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.help) return args;
  if (args.positionals.length > 2) {
    throw new Error(`Unknown argument: ${args.positionals[2]}`);
  }
  args.from ??= args.positionals[0];
  args.to ??= args.positionals[1];
  if (!isLocalDate(args.from)) {
    throw new Error("--from must be a YYYY-MM-DD date");
  }
  if (args.to && !isLocalDate(args.to)) {
    throw new Error("--to must be a YYYY-MM-DD date");
  }
  args.to ??= args.from;
  if (!Number.isInteger(args.limit) || args.limit <= 0 || args.limit > 500) {
    throw new Error("--limit must be an integer between 1 and 500");
  }
  args.output ??= `tmp/render-signals-export-review-${args.from}_${args.to}.json`;
  return args;
}

function isLocalDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
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
  return process.env[name] || envFile[name];
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function addDays(localDate, days) {
  const date = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function timeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = timeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function zonedTimeToUtc(localDate, timeZone) {
  const localAsUtc = Date.UTC(
    localDate.year,
    localDate.month - 1,
    localDate.day,
    localDate.hour ?? 0,
    localDate.minute ?? 0,
    localDate.second ?? 0,
    localDate.ms ?? 0
  );
  let utc = new Date(localAsUtc);
  for (let i = 0; i < 3; i += 1) {
    utc = new Date(localAsUtc - timeZoneOffsetMs(utc, timeZone));
  }
  return utc;
}

function localDateRangeToUtc(from, to, timeZone) {
  const startLocal = { ...parseLocalDate(from), hour: 0, minute: 0, second: 0, ms: 0 };
  const toNextDay = addDays(parseLocalDate(to), 1);
  const endLocalExclusive = { ...toNextDay, hour: 0, minute: 0, second: 0, ms: 0 };
  const start = zonedTimeToUtc(startLocal, timeZone);
  const end = new Date(zonedTimeToUtc(endLocalExclusive, timeZone).getTime() - 1);
  return { start, end };
}

function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

function utcDatesBetween(start, end) {
  const dates = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last) {
    dates.push(utcDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function localDateString(isoTimestamp, timeZone) {
  const parts = timeZoneParts(new Date(isoTimestamp), timeZone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function renderFetchJson(path, token) {
  const url = `${DEFAULT_RENDER_API}${path}`;
  return fetchJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });
}

async function findRenderService(token, serviceName) {
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const rows = await renderFetchJson(`/services?${query.toString()}`, token);
    const match = rows.find(({ service }) => {
      return (
        service?.name === serviceName ||
        service?.repo?.includes("newsweb-explain-feed")
      );
    });
    if (match?.service) return match.service;
    const nextCursor = rows.at(-1)?.cursor;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  throw new Error(`Could not find Render service named ${serviceName}`);
}

async function getRenderEnv(token, serviceId) {
  const rows = await renderFetchJson(`/services/${serviceId}/env-vars?limit=100`, token);
  return Object.fromEntries(
    rows.map((row) => {
      const envVar = row.envVar ?? row;
      return [envVar.key, envVar.value ?? ""];
    })
  );
}

async function resolveLiveApp(args, envFile) {
  if (args.baseUrl && process.env.LOGIN_USERNAME && process.env.LOGIN_PASSWORD) {
    return {
      baseUrl: args.baseUrl,
      username: process.env.LOGIN_USERNAME,
      password: process.env.LOGIN_PASSWORD,
      service: null
    };
  }

  const token = envValue(envFile, "RENDER_API");
  if (!token) {
    throw new Error(
      "RENDER_API is required unless --base-url is used with LOGIN_USERNAME and LOGIN_PASSWORD in the environment"
    );
  }

  const service = await findRenderService(token, args.renderService);
  const renderEnv = await getRenderEnv(token, service.id);
  const username = renderEnv.LOGIN_USERNAME || process.env.LOGIN_USERNAME;
  const password = renderEnv.LOGIN_PASSWORD || process.env.LOGIN_PASSWORD;
  const baseUrl = args.baseUrl || service.serviceDetails?.url;

  if (!baseUrl) throw new Error("Could not resolve live app base URL");
  if (!username || !password) {
    throw new Error("Could not resolve LOGIN_USERNAME/LOGIN_PASSWORD for the live app");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    username,
    password,
    service: {
      id: service.id,
      name: service.name,
      url: service.serviceDetails?.url ?? null,
      dashboardUrl: service.dashboardUrl ?? null
    }
  };
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} ${text.slice(0, 300)}`);
  }
  const body = JSON.parse(text);
  if (body.sessionToken) return body.sessionToken;
  // The public /api/auth/login is served by the web proxy route, which returns
  // the JWT only as the httpOnly newsweb_session cookie, not in the body.
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookieMatch = setCookie.match(/newsweb_session=([^;]+)/);
  if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
  throw new Error(
    "Login response did not include sessionToken or newsweb_session cookie"
  );
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows[0];
  return rows
    .slice(1)
    .filter((values) => values.some((value) => value !== ""))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
    );
}

async function fetchSignalsCsv(baseUrl, sessionToken, tab, utcDay, limit) {
  const query = new URLSearchParams({
    tab,
    from: utcDay,
    to: utcDay,
    limit: String(limit)
  });
  const response = await fetch(`${baseUrl}/api/admin/signals/export?${query.toString()}`, {
    headers: {
      Cookie: `newsweb_session=${encodeURIComponent(sessionToken)}`
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Signal export failed for ${tab}/${utcDay}: ${response.status} ${text.slice(0, 300)}`);
  }
  return parseCsv(text);
}

function timestampFor(tab, row) {
  if (tab === "edits") return row.copied_at;
  if (tab === "generations") return row.requested_at;
  return row.created_at;
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] || "(blank)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

function dailyCounts(rows, tab, timeZone, key) {
  const grouped = new Map();
  for (const row of rows) {
    const day = localDateString(timestampFor(tab, row), timeZone);
    const value = key ? row[key] || "(blank)" : "total";
    const bucket = grouped.get(day) ?? new Map();
    bucket.set(value, (bucket.get(value) ?? 0) + 1);
    grouped.set(day, bucket);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({
      date,
      counts: [...values.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)))
    }));
}

function groupEventsByMessage(events) {
  const map = new Map();
  for (const event of events) {
    const id = event.message_id || "(none)";
    const entry = map.get(id) ?? {
      message_id: id,
      notice: event.notice || "",
      count: 0,
      actions: new Set()
    };
    entry.count += 1;
    if (event.action) entry.actions.add(event.action);
    if (!entry.notice && event.notice) entry.notice = event.notice;
    map.set(id, entry);
  }
  return [...map.values()]
    .map((entry) => ({
      ...entry,
      actions: [...entry.actions].sort()
    }))
    .sort((a, b) => b.count - a.count || String(a.message_id).localeCompare(String(b.message_id)))
    .slice(0, 50);
}

// Pre-P3 skip rows carry only the hyphenated triageKind.
const LEGACY_TRIAGE_REASON_CODES = {
  "document-only": "TRIAGE_DOCUMENT_ONLY",
  "routine-prospectus": "TRIAGE_ROUTINE_PROSPECTUS",
  "routine-reminder": "TRIAGE_ROUTINE_REMINDER",
  "public-sector-results": "TRIAGE_PUBLIC_SECTOR_RESULTS",
  "small-routine-bond": "TRIAGE_SMALL_ROUTINE_BOND"
};

function triageSkipReasonCode(output) {
  if (!output || typeof output !== "object") return null;
  if (output.skippedReason === "DETERMINISTIC_TRIAGE_SKIP") {
    return (
      output.triageReasonCode ??
      LEGACY_TRIAGE_REASON_CODES[output.triageKind] ??
      "(unknown-deterministic)"
    );
  }
  if (typeof output.skippedReason === "string") return output.skippedReason;
  return null;
}

// P3 triage telemetry: skip counts by reason code, shadow candidates from
// the validation_json.triage block (post-P3 rows only), and bypassed skips
// on manual reprocesses.
function triageStats(generations) {
  const byVersion = new Map();
  for (const row of generations) {
    const output = parseJsonField(row.output_json);
    const validation = parseJsonField(row.validation_json);
    const triage =
      validation &&
      typeof validation === "object" &&
      validation.triage &&
      typeof validation.triage === "object"
        ? validation.triage
        : null;
    const reasonCode = triageSkipReasonCode(output);
    if (!triage && !reasonCode) continue;
    const version = promptVersionBucket(row);
    let bucket = byVersion.get(version);
    if (!bucket) {
      bucket = {
        prompt_version: version,
        runs_with_triage_field: 0,
        skip_reason_counts: new Map(),
        shadow_candidate_counts: new Map(),
        bypassed_skip_counts: new Map()
      };
      byVersion.set(version, bucket);
    }
    if (reasonCode) {
      bucket.skip_reason_counts.set(
        reasonCode,
        (bucket.skip_reason_counts.get(reasonCode) ?? 0) + 1
      );
    }
    if (triage) {
      bucket.runs_with_triage_field += 1;
      const shadowIds = Array.isArray(triage.shadowSkipClassIds)
        ? triage.shadowSkipClassIds
        : [];
      for (const classId of shadowIds) {
        const key = String(classId);
        bucket.shadow_candidate_counts.set(
          key,
          (bucket.shadow_candidate_counts.get(key) ?? 0) + 1
        );
      }
      if (typeof triage.bypassedSkipClassId === "string") {
        bucket.bypassed_skip_counts.set(
          triage.bypassedSkipClassId,
          (bucket.bypassed_skip_counts.get(triage.bypassedSkipClassId) ?? 0) + 1
        );
      }
    }
  }

  const ranked = (map) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return [...byVersion.values()]
    .map((bucket) => ({
      prompt_version: bucket.prompt_version,
      runs_with_triage_field: bucket.runs_with_triage_field,
      skipsByReasonCode: ranked(bucket.skip_reason_counts),
      shadow_candidate_counts: ranked(bucket.shadow_candidate_counts),
      bypassed_skip_counts: ranked(bucket.bypassed_skip_counts)
    }))
    .sort((a, b) => a.prompt_version.localeCompare(b.prompt_version));
}

function groupGenerationOutcomes(generationRows) {
  const groups = new Map();
  for (const row of generationRows) {
    const id = row.message_id || "(none)";
    const entry = groups.get(id) ?? {
      message_id: id,
      notice: row.notice || "",
      rows: []
    };
    entry.rows.push(row);
    if (!entry.notice && row.notice) entry.notice = row.notice;
    groups.set(id, entry);
  }

  return [...groups.values()]
    .map((entry) => {
      const rows = entry.rows.sort((a, b) => a.requested_at.localeCompare(b.requested_at));
      const final = rows.at(-1);
      const skipReasonCodes = [
        ...new Set(
          rows
            .map((row) => triageSkipReasonCode(parseJsonField(row.output_json)))
            .filter(Boolean)
        )
      ];
      return {
        message_id: entry.message_id,
        notice: entry.notice,
        attempts: rows.length,
        final_status: final?.status ?? "",
        had_error: rows.some((row) => row.error_group || row.error_text),
        had_checker_error: rows.some((row) => /checker error/i.test(row.reference_check_summary ?? "")),
        had_manual_reprocess: rows.some((row) => row.reason === "manual-reprocess"),
        skip_reason_codes: skipReasonCodes,
        statuses: rows.map((row) => {
          const suffixes = [
            row.error_group ? `/${row.error_group}` : "",
            /checker error/i.test(row.reference_check_summary ?? "") ? "/checker_error" : ""
          ].join("");
          return `${row.requested_at.slice(11, 19)} ${row.reason}:${row.status}${suffixes}`;
        })
      };
    })
    .sort((a, b) => {
      const severity = (row) =>
        row.final_status === "failed" ? 0 :
        row.final_status === "needs_retry" ? 1 :
        row.had_error || row.had_checker_error ? 2 :
        3;
      return severity(a) - severity(b) || Number(a.message_id) - Number(b.message_id);
    });
}

function normalizeNorwegian(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function promptVersionBucket(row) {
  return row.prompt_version || row.promptVersion || "unknown";
}

function isTruthy(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function sortedBuckets(map) {
  return [...map.values()].sort((a, b) =>
    String(a.prompt_version).localeCompare(String(b.prompt_version))
  );
}

function engagementBucket(map, promptVersion) {
  const key = promptVersion || "unknown";
  let bucket = map.get(key);
  if (!bucket) {
    bucket = {
      prompt_version: key,
      generation_count: 0,
      published_generation_count: 0,
      failed_generation_count: 0,
      feedback_count: 0,
      copy_count: 0,
      copy_without_edits_count: 0,
      copy_with_edits_count: 0,
      copy_with_edits_rate: 0,
      regenerate_count: 0,
      title_request_count: 0,
      title_select_count: 0
    };
    map.set(key, bucket);
  }
  return bucket;
}

function engagementByPromptVersion(data) {
  const buckets = new Map();

  for (const row of data.generations ?? []) {
    const bucket = engagementBucket(buckets, promptVersionBucket(row));
    bucket.generation_count += 1;
    if (row.status === "published") bucket.published_generation_count += 1;
    if (row.status === "failed") bucket.failed_generation_count += 1;
  }

  for (const row of data.feedback ?? []) {
    engagementBucket(buckets, promptVersionBucket(row)).feedback_count += 1;
  }

  for (const row of data.edits ?? []) {
    const bucket = engagementBucket(buckets, promptVersionBucket(row));
    bucket.copy_count += 1;
    if (isTruthy(row.has_edits)) bucket.copy_with_edits_count += 1;
    else bucket.copy_without_edits_count += 1;
  }

  for (const row of data.events ?? []) {
    if (row.action === "regenerate_request") {
      engagementBucket(buckets, promptVersionBucket(row)).regenerate_count += 1;
    }
  }

  for (const row of data.titles ?? []) {
    const bucket = engagementBucket(buckets, promptVersionBucket(row));
    if (
      row.action === "title_suggestion_request" ||
      row.action === "title_suggestion_refresh"
    ) {
      bucket.title_request_count += 1;
    }
    if (row.action === "title_suggestion_select") {
      bucket.title_select_count += 1;
    }
  }

  for (const bucket of buckets.values()) {
    bucket.copy_with_edits_rate = rate(bucket.copy_with_edits_count, bucket.copy_count);
  }

  return sortedBuckets(buckets);
}

function firstSentence(text) {
  const value = String(text ?? "");
  const abbreviations = new Set(["ca", "eks", "f", "mill", "mrd", "osv"]);
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (!/[.!?]/.test(char)) continue;
    const next = value[i + 1] ?? "";
    if (next && !/\s/.test(next)) continue;
    if (char === ".") {
      const token = normalizeNorwegian(value.slice(0, i).match(/([A-Za-zÆØÅæøå]+)$/)?.[1] ?? "");
      if (abbreviations.has(token)) continue;
    }
    return value.slice(0, i + 1);
  }
  return value;
}

const descriptorSuffixes = [
  "selskapet",
  "konsernet",
  "rederiet",
  "banken",
  "fondet",
  "gruppen",
  "operatoren",
  "produsenten",
  "leverandoren",
  "utvikleren",
  "aktoren",
  "kommunen",
  "meglerhuset"
];

const descriptorLeadRe = new RegExp(
  `^(?:det\\s+[a-z0-9-]+\\s+)?(?:[a-z0-9-]+(?:${descriptorSuffixes.join("|")})|[a-z0-9-]+(?:-${descriptorSuffixes.join("|-")}))\\s+`,
  "i"
);

function hasDescriptorOrCompanyContextLead(lead) {
  const normalized = normalizeNorwegian(lead);
  const first = normalizeNorwegian(firstSentence(lead));
  return descriptorLeadRe.test(normalized) || /^[^.,:;!?]{2,90},\s+som\b/i.test(first);
}

function hasStockAttributionEnding(lead) {
  const normalized = normalizeNorwegian(firstSentence(lead).trim());
  return [
    "ifolge en borsmelding.",
    "ifolge borsmeldingen.",
    "ifolge en melding.",
    "viser kvartalsrapporten.",
    "viser rapporten.",
    "viser meldingen."
  ].some((ending) => normalized.endsWith(ending));
}

function hasQuoteOrParaphrase(rewrite) {
  return /[–«»]/.test([rewrite.title, rewrite.lead, ...(rewrite.body ?? [])].join("\n"));
}

function hasBulletPreamble(rewrite) {
  return (rewrite.body ?? []).some((item) =>
    /^dette er noen\b/i.test(normalizeNorwegian(item).trim())
  );
}

function hasInertTitle(title) {
  const normalized = normalizeNorwegian(title);
  return (
    /^(lavere|hoyere|inntektsfall|resultatfall|resultathopp|underskudd|overskudd|driftsresultatet|resultatet)\b/i.test(
      normalized
    ) ||
    /^.+(?:-resultatet|-tapet|-inntektene)\b/i.test(normalized) ||
    /^.+\sfor\s[A-ZÆØÅ]/.test(String(title ?? ""))
  );
}

function parseRewriteOutput(row) {
  const raw = row.output_json ?? row.outputJson;
  if (!raw) return { missing: true, parseError: false, rewrite: null };
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { missing: false, parseError: true, rewrite: null };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { missing: false, parseError: true, rewrite: null };
  }
  const rewrite = {
    title: typeof parsed.title === "string" ? parsed.title : "",
    lead: typeof parsed.lead === "string" ? parsed.lead : "",
    body: Array.isArray(parsed.body)
      ? parsed.body.filter((item) => typeof item === "string")
      : []
  };
  if (!rewrite.title && !rewrite.lead && !rewrite.body.length) {
    return { missing: false, parseError: true, rewrite: null };
  }
  return { missing: false, parseError: false, rewrite };
}

function articleShapeBucket(map, promptVersion) {
  const key = promptVersion || "unknown";
  let bucket = map.get(key);
  if (!bucket) {
    bucket = {
      prompt_version: key,
      article_count: 0,
      missing_output_count: 0,
      parse_error_count: 0,
      descriptor_company_context_lead_count: 0,
      descriptor_company_context_lead_rate: 0,
      stock_attribution_ending_count: 0,
      stock_attribution_ending_rate: 0,
      quote_or_paraphrase_count: 0,
      quote_or_paraphrase_rate: 0,
      bullet_preamble_count: 0,
      bullet_preamble_rate: 0,
      inert_title_count: 0,
      inert_title_rate: 0
    };
    map.set(key, bucket);
  }
  return bucket;
}

function articleShapeByPromptVersion(generations) {
  const buckets = new Map();
  for (const row of generations ?? []) {
    const bucket = articleShapeBucket(buckets, promptVersionBucket(row));
    const parsed = parseRewriteOutput(row);
    if (parsed.missing) {
      bucket.missing_output_count += 1;
      continue;
    }
    if (parsed.parseError || !parsed.rewrite) {
      bucket.parse_error_count += 1;
      continue;
    }

    bucket.article_count += 1;
    if (hasDescriptorOrCompanyContextLead(parsed.rewrite.lead)) {
      bucket.descriptor_company_context_lead_count += 1;
    }
    if (hasStockAttributionEnding(parsed.rewrite.lead)) {
      bucket.stock_attribution_ending_count += 1;
    }
    if (hasQuoteOrParaphrase(parsed.rewrite)) {
      bucket.quote_or_paraphrase_count += 1;
    }
    if (hasBulletPreamble(parsed.rewrite)) {
      bucket.bullet_preamble_count += 1;
    }
    if (hasInertTitle(parsed.rewrite.title)) {
      bucket.inert_title_count += 1;
    }
  }

  for (const bucket of buckets.values()) {
    bucket.descriptor_company_context_lead_rate = rate(
      bucket.descriptor_company_context_lead_count,
      bucket.article_count
    );
    bucket.stock_attribution_ending_rate = rate(
      bucket.stock_attribution_ending_count,
      bucket.article_count
    );
    bucket.quote_or_paraphrase_rate = rate(
      bucket.quote_or_paraphrase_count,
      bucket.article_count
    );
    bucket.bullet_preamble_rate = rate(bucket.bullet_preamble_count, bucket.article_count);
    bucket.inert_title_rate = rate(bucket.inert_title_count, bucket.article_count);
  }

  return sortedBuckets(buckets);
}

function parseJsonField(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index];
}

function validationIssueStats(generations) {
  const byVersion = new Map();
  const codeTotals = new Map();

  for (const row of generations) {
    const validation = parseJsonField(row.validation_json);
    if (!validation || typeof validation !== "object") continue;
    const version = promptVersionBucket(row);
    let bucket = byVersion.get(version);
    if (!bucket) {
      bucket = {
        prompt_version: version,
        runs_with_validation: 0,
        runs_with_blocking: 0,
        runs_with_warning: 0,
        issue_counts: new Map()
      };
      byVersion.set(version, bucket);
    }
    bucket.runs_with_validation += 1;
    const issues = Array.isArray(validation.issues) ? validation.issues : [];
    let hasBlocking = false;
    let hasWarning = false;
    for (const issue of issues) {
      if (!issue || typeof issue !== "object") continue;
      const code = String(issue.code ?? "(unknown)");
      const severity = String(issue.severity ?? "(unknown)");
      const key = `${code}:${severity}`;
      bucket.issue_counts.set(key, (bucket.issue_counts.get(key) ?? 0) + 1);
      codeTotals.set(key, (codeTotals.get(key) ?? 0) + 1);
      if (severity === "blocking") hasBlocking = true;
      if (severity === "warning") hasWarning = true;
    }
    if (hasBlocking) bucket.runs_with_blocking += 1;
    if (hasWarning) bucket.runs_with_warning += 1;
  }

  const toRanked = (map) =>
    [...map.entries()]
      .map(([key, count]) => {
        const [code, severity] = key.split(":");
        return { code, severity, count };
      })
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  return {
    byPromptVersion: [...byVersion.values()]
      .map((bucket) => ({
        prompt_version: bucket.prompt_version,
        runs_with_validation: bucket.runs_with_validation,
        runs_with_blocking: bucket.runs_with_blocking,
        runs_with_warning: bucket.runs_with_warning,
        issues: toRanked(bucket.issue_counts)
      }))
      .sort((a, b) => a.prompt_version.localeCompare(b.prompt_version)),
    rankedIssueCodes: toRanked(codeTotals)
  };
}

function numericAssessmentStats(generations) {
  const byVersion = new Map();
  const dispositionTotals = new Map();
  const shadowCandidateTotals = new Map();

  for (const row of generations) {
    const validation = parseJsonField(row.validation_json);
    if (!validation || typeof validation !== "object") continue;
    const assessments = Array.isArray(validation.numberAssessments)
      ? validation.numberAssessments
      : null;
    if (!assessments) continue;
    const version = promptVersionBucket(row);
    let bucket = byVersion.get(version);
    if (!bucket) {
      bucket = {
        prompt_version: version,
        runs_with_assessments: 0,
        assessed_number_count: 0,
        matched_count: 0,
        derived_count: 0,
        unexpected_count: 0,
        disposition_counts: new Map(),
        shadow_candidate_counts: new Map()
      };
      byVersion.set(version, bucket);
    }
    bucket.runs_with_assessments += 1;
    for (const assessment of assessments) {
      if (!assessment || typeof assessment !== "object") continue;
      const disposition = String(assessment.disposition ?? "(unknown)");
      const ruleId =
        typeof assessment.ruleId === "string" ? assessment.ruleId : "(none)";
      const count =
        typeof assessment.count === "number" && Number.isFinite(assessment.count)
          ? assessment.count
          : 1;
      const key = `${disposition}:${ruleId}`;
      bucket.assessed_number_count += count;
      if (disposition === "matched") bucket.matched_count += count;
      if (disposition === "derived") bucket.derived_count += count;
      if (disposition === "unexpected") bucket.unexpected_count += count;
      bucket.disposition_counts.set(
        key,
        (bucket.disposition_counts.get(key) ?? 0) + count
      );
      dispositionTotals.set(key, (dispositionTotals.get(key) ?? 0) + count);
      // candidateRuleId is the live shadow signal: a disabled derivation rule
      // that would have accepted the number. Historical rows lack the key.
      if (typeof assessment.candidateRuleId === "string") {
        bucket.shadow_candidate_counts.set(
          assessment.candidateRuleId,
          (bucket.shadow_candidate_counts.get(assessment.candidateRuleId) ?? 0) +
            count
        );
        shadowCandidateTotals.set(
          assessment.candidateRuleId,
          (shadowCandidateTotals.get(assessment.candidateRuleId) ?? 0) + count
        );
      }
    }
  }

  const toRanked = (map) =>
    [...map.entries()]
      .map(([key, count]) => {
        const separator = key.indexOf(":");
        return {
          disposition: key.slice(0, separator),
          rule_id: key.slice(separator + 1),
          count
        };
      })
      .sort((a, b) => b.count - a.count || a.rule_id.localeCompare(b.rule_id));

  const toRankedCandidates = (map) =>
    [...map.entries()]
      .map(([candidateRuleId, count]) => ({
        candidate_rule_id: candidateRuleId,
        count
      }))
      .sort(
        (a, b) =>
          b.count - a.count || a.candidate_rule_id.localeCompare(b.candidate_rule_id)
      );

  return {
    byPromptVersion: [...byVersion.values()]
      .map((bucket) => ({
        prompt_version: bucket.prompt_version,
        runs_with_assessments: bucket.runs_with_assessments,
        assessed_number_count: bucket.assessed_number_count,
        matched_count: bucket.matched_count,
        derived_count: bucket.derived_count,
        unexpected_count: bucket.unexpected_count,
        unexpected_rate: rate(bucket.unexpected_count, bucket.assessed_number_count),
        dispositions: toRanked(bucket.disposition_counts),
        shadow_candidates: toRankedCandidates(bucket.shadow_candidate_counts)
      }))
      .sort((a, b) => a.prompt_version.localeCompare(b.prompt_version)),
    rankedDispositions: toRanked(dispositionTotals),
    rankedShadowCandidates: toRankedCandidates(shadowCandidateTotals)
  };
}

// P4 marker-leak shadow telemetry: matches persist only as the
// validation_json.markerLeaks field (no issue while in shadow), so the
// false-positive record the promotion decision needs is counted here.
function markerLeakStats(generations) {
  const byVersion = new Map();
  for (const row of generations) {
    const validation = parseJsonField(row.validation_json);
    if (!validation || typeof validation !== "object") continue;
    const leaks = Array.isArray(validation.markerLeaks)
      ? validation.markerLeaks
      : null;
    if (!leaks) continue;
    const version = promptVersionBucket(row);
    let bucket = byVersion.get(version);
    if (!bucket) {
      bucket = {
        prompt_version: version,
        runs_with_field: 0,
        runs_with_leaks: 0,
        category_counts: new Map(),
        pattern_counts: new Map()
      };
      byVersion.set(version, bucket);
    }
    bucket.runs_with_field += 1;
    if (leaks.length === 0) continue;
    bucket.runs_with_leaks += 1;
    for (const leak of leaks) {
      if (!leak || typeof leak !== "object") continue;
      const category = String(leak.category ?? "(unknown)");
      const id = String(leak.id ?? "(unknown)");
      bucket.category_counts.set(
        category,
        (bucket.category_counts.get(category) ?? 0) + 1
      );
      bucket.pattern_counts.set(id, (bucket.pattern_counts.get(id) ?? 0) + 1);
    }
  }

  const ranked = (map) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return [...byVersion.values()]
    .map((bucket) => ({
      prompt_version: bucket.prompt_version,
      runs_with_field: bucket.runs_with_field,
      runs_with_leaks: bucket.runs_with_leaks,
      categories: ranked(bucket.category_counts),
      pattern_ids: ranked(bucket.pattern_counts)
    }))
    .sort((a, b) => a.prompt_version.localeCompare(b.prompt_version));
}

function referenceRepairStats(generations) {
  const byVersion = new Map();

  for (const row of generations) {
    const validation = parseJsonField(row.validation_json);
    const referenceCheck =
      parseJsonField(row.reference_check_json) ??
      (validation && typeof validation === "object" ? validation.referenceCheck : null);
    const version = promptVersionBucket(row);
    let bucket = byVersion.get(version);
    if (!bucket) {
      bucket = {
        prompt_version: version,
        run_count: 0,
        reference_check_ran: 0,
        correction_applied_count: 0,
        correction_attempt_total: 0,
        attempts_distribution: { "0": 0, "1": 0, "2": 0, "3+": 0 },
        checker_error_count: 0,
        blocking_after_repairs_count: 0,
        high_risk_unsupported_count: 0,
        attribution_correction_count: 0,
        validation_repair_applied_count: 0,
        editorial_review_repair_count: 0,
        outcome_runs: 0,
        outcome_state_counts: new Map(),
        checker_error_kind_counts: new Map(),
        would_block_count: 0,
        would_retry_count: 0,
        initial_coverages: [],
        final_coverages: []
      };
      byVersion.set(version, bucket);
    }
    bucket.run_count += 1;
    if (validation && typeof validation === "object") {
      const validationRepair = validation.validationRepair;
      if (validationRepair && typeof validationRepair === "object" && validationRepair.applied) {
        bucket.validation_repair_applied_count += 1;
      }
      const editorialReview = validation.editorialReview;
      if (editorialReview && typeof editorialReview === "object" && editorialReview.repairApplied) {
        bucket.editorial_review_repair_count += 1;
      }
    }
    if (!referenceCheck || typeof referenceCheck !== "object") continue;
    bucket.reference_check_ran += 1;
    if (referenceCheck.checkerError) bucket.checker_error_count += 1;
    if (referenceCheck.correctionApplied) bucket.correction_applied_count += 1;
    if (referenceCheck.blocking) bucket.blocking_after_repairs_count += 1;
    if (Number(referenceCheck.highRiskUnsupportedSentenceCount) > 0) {
      bucket.high_risk_unsupported_count += 1;
    }
    if (referenceCheck.attributionCorrectionApplied) {
      bucket.attribution_correction_count += 1;
    }
    const attempts = Number(referenceCheck.correctionAttempts ?? 0);
    bucket.correction_attempt_total += Number.isFinite(attempts) ? attempts : 0;
    const attemptsKey = attempts >= 3 ? "3+" : String(Math.max(0, attempts));
    bucket.attempts_distribution[attemptsKey] += 1;
    const initial = Number(referenceCheck.initialCoveragePercent);
    const final = Number(referenceCheck.finalCoveragePercent);
    if (Number.isFinite(initial)) bucket.initial_coverages.push(initial);
    if (Number.isFinite(final)) bucket.final_coverages.push(final);
    // P4 shadow outcome block; historical rows lack the key.
    const outcome = referenceCheck.outcome;
    if (outcome && typeof outcome === "object" && !Array.isArray(outcome)) {
      bucket.outcome_runs += 1;
      const state = String(outcome.state ?? "(unknown)");
      bucket.outcome_state_counts.set(
        state,
        (bucket.outcome_state_counts.get(state) ?? 0) + 1
      );
      const entries = Array.isArray(outcome.checkerErrors)
        ? outcome.checkerErrors
        : [];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const kind = String(entry.kind ?? "(unknown)");
        bucket.checker_error_kind_counts.set(
          kind,
          (bucket.checker_error_kind_counts.get(kind) ?? 0) + 1
        );
      }
      const shadow =
        outcome.shadow && typeof outcome.shadow === "object"
          ? outcome.shadow
          : null;
      if (shadow?.wouldBlock) bucket.would_block_count += 1;
      if (shadow?.wouldRetry) bucket.would_retry_count += 1;
    }
  }

  const avg = (values) =>
    values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1))
      : null;

  const rankedCounts = (map) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return [...byVersion.values()]
    .map((bucket) => ({
      prompt_version: bucket.prompt_version,
      run_count: bucket.run_count,
      reference_check_ran: bucket.reference_check_ran,
      correction_applied_count: bucket.correction_applied_count,
      correction_applied_rate: rate(bucket.correction_applied_count, bucket.reference_check_ran),
      correction_attempt_total: bucket.correction_attempt_total,
      attempts_distribution: bucket.attempts_distribution,
      checker_error_count: bucket.checker_error_count,
      blocking_after_repairs_count: bucket.blocking_after_repairs_count,
      high_risk_unsupported_count: bucket.high_risk_unsupported_count,
      attribution_correction_count: bucket.attribution_correction_count,
      validation_repair_applied_count: bucket.validation_repair_applied_count,
      editorial_review_repair_count: bucket.editorial_review_repair_count,
      outcome_runs: bucket.outcome_runs,
      outcome_state_counts: rankedCounts(bucket.outcome_state_counts),
      checker_error_kind_counts: rankedCounts(bucket.checker_error_kind_counts),
      would_block_count: bucket.would_block_count,
      would_retry_count: bucket.would_retry_count,
      avg_initial_coverage: avg(bucket.initial_coverages),
      avg_final_coverage: avg(bucket.final_coverages)
    }))
    .sort((a, b) => a.prompt_version.localeCompare(b.prompt_version));
}

function emptyTokenUsage() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0
  };
}

function tokenCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function modelCallUsage(call) {
  const usage = call?.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const inputTokens = tokenCount(usage.inputTokens);
  const outputTokens = tokenCount(usage.outputTokens);
  const totalTokens = tokenCount(usage.totalTokens);
  if (inputTokens == null && outputTokens == null && totalTokens == null) return null;
  return {
    input_tokens: inputTokens ?? 0,
    cached_input_tokens: tokenCount(usage.cachedInputTokens) ?? 0,
    cache_write_input_tokens: tokenCount(usage.cacheWriteInputTokens) ?? 0,
    output_tokens: outputTokens ?? 0,
    reasoning_tokens: tokenCount(usage.reasoningTokens) ?? 0,
    total_tokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0)
  };
}

function modelCallUsageEntries(call) {
  const attempts = Array.isArray(call?.attempts) ? call.attempts : [];
  const attemptEntries = attempts
    .map((attempt) => ({ attempt, usage: modelCallUsage(attempt) }))
    .filter((entry) => entry.usage != null);
  if (attemptEntries.length > 0) return attemptEntries;
  const usage = modelCallUsage(call);
  return usage ? [{ attempt: null, usage }] : [];
}

function modelCallCost(call, { modelOverride, serviceTierOverride } = {}) {
  let costUsd = 0;
  let known = true;
  let longContextAttemptCount = 0;
  const entries = modelCallUsageEntries(call);
  for (const { attempt, usage } of entries) {
    const estimate = calculateOpenAICost({
      model:
        modelOverride ??
        attempt?.responseModel ??
        call?.responseModel ??
        call?.model,
      serviceTier:
        serviceTierOverride ??
        attempt?.serviceTier ??
        attempt?.requestedServiceTier ??
        call?.serviceTier ??
        call?.requestedServiceTier ??
        "default",
      usage
    });
    if (!estimate.knownModel) known = false;
    else costUsd += estimate.costUsd;
    if (estimate.longContext) longContextAttemptCount += 1;
  }
  return {
    hasUsage: entries.length > 0,
    known,
    costUsd: known && entries.length > 0 ? costUsd : null,
    longContextAttemptCount
  };
}

function addTokenUsage(target, usage) {
  for (const key of Object.keys(target)) target[key] += usage[key];
}

function tokenUsageSummary(usage) {
  return {
    ...usage,
    standard_input_tokens: Math.max(
      0,
      usage.input_tokens -
        usage.cached_input_tokens -
        usage.cache_write_input_tokens
    ),
    cache_read_share: rate(usage.cached_input_tokens, usage.input_tokens),
    cache_write_share: rate(usage.cache_write_input_tokens, usage.input_tokens)
  };
}

function addUsageGroup(map, key, usage, actualCost) {
  let group = map.get(key);
  if (!group) {
    group = {
      key,
      call_count: 0,
      calls_with_usage: 0,
      calls_with_cost: 0,
      estimated_cost_usd: 0,
      token_usage: emptyTokenUsage()
    };
    map.set(key, group);
  }
  group.call_count += 1;
  if (usage) {
    group.calls_with_usage += 1;
    addTokenUsage(group.token_usage, usage);
  }
  if (actualCost?.costUsd != null) {
    group.calls_with_cost += 1;
    group.estimated_cost_usd += actualCost.costUsd;
  }
}

function usageGroups(map) {
  return [...map.values()]
    .map((group) => ({
      key: group.key,
      call_count: group.call_count,
      calls_with_usage: group.calls_with_usage,
      calls_with_cost: group.calls_with_cost,
      usage_coverage_rate: rate(group.calls_with_usage, group.call_count),
      estimated_cost_usd:
        group.calls_with_cost > 0 ? roundUsd(group.estimated_cost_usd) : null,
      token_usage: tokenUsageSummary(group.token_usage)
    }))
    .sort((a, b) => b.token_usage.total_tokens - a.token_usage.total_tokens);
}

function modelCallStats(generations) {
  const byVersion = new Map();

  for (const row of generations) {
    const calls = parseJsonField(row.model_calls);
    const version = promptVersionBucket(row);
    let bucket = byVersion.get(version);
    if (!bucket) {
      bucket = {
        prompt_version: version,
        run_count: 0,
        runs_with_model_calls: 0,
        total_calls: 0,
        rewrite_call_distribution: { "1": 0, "2": 0, "3": 0, "4+": 0 },
        runs_with_repair_calls: 0,
        reasoning_efforts: new Map(),
        calls_with_usage: 0,
        calls_with_attempt_count: 0,
        total_api_attempts: 0,
        token_usage: emptyTokenUsage(),
        usage_by_model_tier: new Map(),
        usage_by_schema_effort: new Map(),
        prompt_cache_modes: new Map(),
        latency_seconds: []
      };
      byVersion.set(version, bucket);
    }
    bucket.run_count += 1;

    if (row.started_at && row.finished_at) {
      const seconds =
        (new Date(row.finished_at).getTime() - new Date(row.started_at).getTime()) / 1000;
      if (Number.isFinite(seconds) && seconds >= 0) {
        bucket.latency_seconds.push(Number(seconds.toFixed(1)));
      }
    }

    if (!Array.isArray(calls) || calls.length === 0) continue;
    bucket.runs_with_model_calls += 1;
    bucket.total_calls += calls.length;
    let rewriteCalls = 0;
    for (const call of calls) {
      if (!call || typeof call !== "object") continue;
      if (call.schemaName === "rewrite_output") rewriteCalls += 1;
      const effortKey = `${call.schemaName ?? "(unknown)"}:${call.reasoningEffort ?? "(unknown)"}`;
      bucket.reasoning_efforts.set(
        effortKey,
        (bucket.reasoning_efforts.get(effortKey) ?? 0) + 1
      );
      const cacheModeKey =
        typeof call.promptCacheMode === "string" ? call.promptCacheMode : "(unset)";
      bucket.prompt_cache_modes.set(
        cacheModeKey,
        (bucket.prompt_cache_modes.get(cacheModeKey) ?? 0) + 1
      );
      const usage = modelCallUsage(call);
      const actualCost = modelCallCost(call);
      if (usage) {
        bucket.calls_with_usage += 1;
        addTokenUsage(bucket.token_usage, usage);
      }
      const attemptCount =
        tokenCount(call.attemptCount) ??
        (Array.isArray(call.attempts) ? call.attempts.length : null);
      if (attemptCount != null) {
        bucket.calls_with_attempt_count += 1;
        bucket.total_api_attempts += attemptCount;
      }
      addUsageGroup(
        bucket.usage_by_model_tier,
        `${call.responseModel ?? call.model ?? "(unknown)"}:${call.serviceTier ?? call.requestedServiceTier ?? "(unknown)"}`,
        usage,
        actualCost
      );
      addUsageGroup(bucket.usage_by_schema_effort, effortKey, usage, actualCost);
    }
    if (rewriteCalls > 0) {
      const key = rewriteCalls >= 4 ? "4+" : String(rewriteCalls);
      bucket.rewrite_call_distribution[key] += 1;
      if (rewriteCalls > 1) bucket.runs_with_repair_calls += 1;
    }
  }

  return [...byVersion.values()]
    .map((bucket) => {
      const latencies = bucket.latency_seconds.sort((a, b) => a - b);
      return {
        prompt_version: bucket.prompt_version,
        run_count: bucket.run_count,
        runs_with_model_calls: bucket.runs_with_model_calls,
        total_calls: bucket.total_calls,
        avg_calls_per_run: bucket.runs_with_model_calls
          ? Number((bucket.total_calls / bucket.runs_with_model_calls).toFixed(2))
          : null,
        rewrite_call_distribution: bucket.rewrite_call_distribution,
        runs_with_repair_calls: bucket.runs_with_repair_calls,
        repair_call_rate: rate(bucket.runs_with_repair_calls, bucket.runs_with_model_calls),
        calls_with_usage: bucket.calls_with_usage,
        usage_coverage_rate: rate(bucket.calls_with_usage, bucket.total_calls),
        calls_with_attempt_count: bucket.calls_with_attempt_count,
        total_api_attempts: bucket.total_api_attempts,
        token_usage: tokenUsageSummary(bucket.token_usage),
        usage_by_response_model_and_service_tier: usageGroups(
          bucket.usage_by_model_tier
        ),
        usage_by_schema_and_effort: usageGroups(bucket.usage_by_schema_effort),
        calls_by_schema_and_effort: [...bucket.reasoning_efforts.entries()]
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => b.count - a.count),
        calls_by_prompt_cache_mode: [...bucket.prompt_cache_modes.entries()]
          .map(([mode, count]) => ({ mode, count }))
          .sort((a, b) => b.count - a.count),
        latency_seconds_p50: percentile(latencies, 50),
        latency_seconds_p90: percentile(latencies, 90),
        latency_sample_count: latencies.length
      };
    })
    .sort((a, b) => a.prompt_version.localeCompare(b.prompt_version));
}

function openAICostStats(generations) {
  let totalCalls = 0;
  let callsWithUsage = 0;
  let callsWithActualCost = 0;
  let actualCostUsd = 0;
  let longContextAttemptCount = 0;
  let successfulStoryCount = 0;
  const unknownActualModels = new Set();
  const counterfactual = Object.fromEntries(
    COUNTERFACTUAL_MODELS.map((model) => [model, { costUsd: 0, callsWithCost: 0 }])
  );

  for (const row of generations) {
    const calls = parseJsonField(row.model_calls);
    if (row.status === "published") successfulStoryCount += 1;
    if (!Array.isArray(calls) || calls.length === 0) continue;
    for (const call of calls) {
      if (!call || typeof call !== "object") continue;
      totalCalls += 1;
      const actual = modelCallCost(call);
      if (!actual.hasUsage) continue;
      callsWithUsage += 1;
      longContextAttemptCount += actual.longContextAttemptCount;
      if (actual.costUsd == null) {
        unknownActualModels.add(
          String(call.responseModel ?? call.model ?? "(unknown)")
        );
      } else {
        callsWithActualCost += 1;
        actualCostUsd += actual.costUsd;
      }
      for (const model of COUNTERFACTUAL_MODELS) {
        const estimate = modelCallCost(call, {
          modelOverride: model,
          serviceTierOverride: "default"
        });
        if (estimate.costUsd != null) {
          counterfactual[model].costUsd += estimate.costUsd;
          counterfactual[model].callsWithCost += 1;
        }
      }
    }
  }

  return {
    pricing_snapshot: {
      date: OPENAI_PRICING_SNAPSHOT.snapshotDate,
      source: OPENAI_PRICING_SNAPSHOT.source,
      currency: OPENAI_PRICING_SNAPSHOT.currency
    },
    total_calls: totalCalls,
    calls_with_usage: callsWithUsage,
    usage_coverage_rate: rate(callsWithUsage, totalCalls),
    calls_with_actual_cost: callsWithActualCost,
    actual_cost_usd:
      callsWithActualCost > 0 ? roundUsd(actualCostUsd) : null,
    successful_story_count: successfulStoryCount,
    actual_cost_per_successful_story_usd:
      successfulStoryCount > 0 && callsWithActualCost > 0
        ? roundUsd(actualCostUsd / successfulStoryCount)
        : null,
    long_context_attempt_count: longContextAttemptCount,
    unknown_actual_models: [...unknownActualModels].sort(),
    counterfactual_standard: Object.fromEntries(
      Object.entries(counterfactual).map(([model, value]) => [
        model,
        {
          calls_with_cost: value.callsWithCost,
          cost_usd:
            value.callsWithCost > 0 ? roundUsd(value.costUsd) : null,
          cost_per_successful_story_usd:
            successfulStoryCount > 0 && value.callsWithCost > 0
              ? roundUsd(value.costUsd / successfulStoryCount)
              : null
        }
      ])
    )
  };
}

function countSentencesApprox(text) {
  return String(text ?? "")
    .split(/[.!?](?:\s|$)/)
    .filter((part) => part.trim().length > 0).length;
}

const attributionRe = /ifolge|melder selskapet|opplyser|skriver selskapet|borsmelding/;

function editPatternStats(edits) {
  const stats = {
    copy_count: 0,
    with_edits_count: 0,
    title_changed_count: 0,
    body_changed_count: 0,
    title_shortened_count: 0,
    percent_sign_fix_count: 0,
    thousand_separator_fix_count: 0,
    attribution_added_count: 0,
    sentences_removed_count: 0,
    examples: []
  };

  for (const row of edits) {
    stats.copy_count += 1;
    if (!isTruthy(row.has_edits)) continue;
    stats.with_edits_count += 1;

    const originalTitle = String(row.original_title ?? "");
    const editedTitle = String(row.edited_title ?? "");
    const originalBody = String(row.original_body ?? "");
    const editedBody = String(row.edited_body ?? "");
    const titleChanged = originalTitle.trim() !== editedTitle.trim();
    const bodyChanged = originalBody.trim() !== editedBody.trim();

    if (titleChanged) {
      stats.title_changed_count += 1;
      if (
        editedTitle.trim().length > 0 &&
        editedTitle.trim().length < originalTitle.trim().length * 0.9
      ) {
        stats.title_shortened_count += 1;
      }
    }
    if (bodyChanged) {
      stats.body_changed_count += 1;
      const combinedOriginal = `${originalTitle}\n${originalBody}`;
      const combinedEdited = `${editedTitle}\n${editedBody}`;
      if (combinedOriginal.includes("%") && !combinedEdited.includes("%")) {
        stats.percent_sign_fix_count += 1;
      }
      if (/\d[  ]\d{3}/.test(combinedOriginal) && /\d\.\d{3}/.test(combinedEdited)) {
        stats.thousand_separator_fix_count += 1;
      }
      const normalizedOriginal = normalizeNorwegian(combinedOriginal);
      const normalizedEdited = normalizeNorwegian(combinedEdited);
      if (!attributionRe.test(normalizedOriginal) && attributionRe.test(normalizedEdited)) {
        stats.attribution_added_count += 1;
      }
      if (countSentencesApprox(editedBody) < countSentencesApprox(originalBody)) {
        stats.sentences_removed_count += 1;
      }
    }

    if (stats.examples.length < 20 && (titleChanged || bodyChanged)) {
      stats.examples.push({
        copied_at: row.copied_at,
        message_id: row.message_id,
        prompt_version: row.prompt_version,
        title_changed: titleChanged,
        body_changed: bodyChanged,
        original_title: originalTitle,
        edited_title: editedTitle
      });
    }
  }

  stats.with_edits_rate = rate(stats.with_edits_count, stats.copy_count);
  return stats;
}

export function analyze(data, timeZone) {
  const generations = data.generations ?? [];
  const events = data.events ?? [];

  const generationOutcomes = groupGenerationOutcomes(generations);
  const problematicGenerations = generationOutcomes.filter(
    (row) =>
      row.final_status === "failed" ||
      row.final_status === "needs_retry" ||
      row.had_error ||
      row.had_checker_error ||
      row.had_manual_reprocess
  );

  // Reason-coded false-skip signal: a skip followed by a manual reprocess,
  // attributed to the skip class that produced it.
  const falseSkipCounts = new Map();
  for (const group of generationOutcomes) {
    if (!group.had_manual_reprocess) continue;
    for (const code of group.skip_reason_codes ?? []) {
      const entry = falseSkipCounts.get(code) ?? {
        reason_code: code,
        count: 0,
        later_published_count: 0
      };
      entry.count += 1;
      if (group.final_status === "published") entry.later_published_count += 1;
      falseSkipCounts.set(code, entry);
    }
  }
  const falseSkipSignalsByReasonCode = [...falseSkipCounts.values()].sort(
    (a, b) => b.count - a.count || a.reason_code.localeCompare(b.reason_code)
  );

  return {
    counts: Object.fromEntries(DEFAULT_TABS.map((tab) => [tab, data[tab]?.length ?? 0])),
    daily: {
      feedback: dailyCounts(data.feedback ?? [], "feedback", timeZone),
      edits: dailyCounts(data.edits ?? [], "edits", timeZone),
      titles: dailyCounts(data.titles ?? [], "titles", timeZone, "action"),
      events: dailyCounts(events, "events", timeZone, "action"),
      generations: dailyCounts(generations, "generations", timeZone, "status")
    },
    eventActions: countBy(events, "action"),
    eventSources: countBy(events, "action_source"),
    titleActions: countBy(data.titles ?? [], "action"),
    generationStatuses: countBy(generations, "status"),
    generationReasons: countBy(generations, "reason"),
    generationErrorGroups: countBy(
      generations.filter((row) => row.error_group),
      "error_group"
    ),
    engagement: {
      byPromptVersion: engagementByPromptVersion(data),
      articleShapeByPromptVersion: articleShapeByPromptVersion(generations)
    },
    qualityPipeline: {
      validationIssues: validationIssueStats(generations),
      numericAssessmentsByPromptVersion: numericAssessmentStats(generations),
      markerLeaksByPromptVersion: markerLeakStats(generations),
      triageByPromptVersion: triageStats(generations),
      referenceRepairByPromptVersion: referenceRepairStats(generations),
      modelCallsByPromptVersion: modelCallStats(generations),
      openAIUsageAndCost: openAICostStats(generations),
      editPatterns: editPatternStats(data.edits ?? [])
    },
    noticesByEventCount: groupEventsByMessage(events),
    feedback: (data.feedback ?? []).map((row) => ({
      created_at: row.created_at,
      message_id: row.message_id,
      notice: row.notice,
      version: row.version,
      text: row.text,
      prompt_version: row.prompt_version,
      model: row.model,
      action_source: row.action_source
    })),
    edits: (data.edits ?? []).map((row) => ({
      copied_at: row.copied_at,
      message_id: row.message_id,
      notice: row.notice,
      has_edits: row.has_edits,
      original_title: row.original_title,
      edited_title: row.edited_title,
      original_body: row.original_body,
      edited_body: row.edited_body,
      prompt_version: row.prompt_version,
      model: row.model,
      action_source: row.action_source
    })),
    titles: (data.titles ?? []).map((row) => ({
      created_at: row.created_at,
      message_id: row.message_id,
      notice: row.notice,
      action: row.action,
      current_title: row.current_title,
      selected_title: row.selected_title,
      selected_index: row.selected_index,
      selected_was_original: row.selected_was_original,
      suggestions: row.suggestions,
      prompt_version: row.prompt_version,
      model: row.model,
      action_source: row.action_source
    })),
    failedGenerations: generations
      .filter((row) => row.status === "failed" || row.status === "needs_retry")
      .map((row) => ({
        requested_at: row.requested_at,
        message_id: row.message_id,
        notice: row.notice,
        reason: row.reason,
        status: row.status,
        error_group: row.error_group,
        error_text: row.error_text?.slice(0, 300)
      })),
    referenceCheckerErrors: generations
      .filter((row) => /checker error/i.test(row.reference_check_summary ?? ""))
      .map((row) => ({
        requested_at: row.requested_at,
        message_id: row.message_id,
        notice: row.notice,
        status: row.status,
        reference_check_summary: row.reference_check_summary
      })),
    generationOutcomes,
    falseSkipSignalsByReasonCode,
    problematicGenerations
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const envFile = loadEnvFile();
  const range = localDateRangeToUtc(args.from, args.to, args.timezone);
  const utcDays = utcDatesBetween(range.start, range.end);
  const app = await resolveLiveApp(args, envFile);
  const sessionToken = await login(app.baseUrl, app.username, app.password);

  const fetched = {};
  const data = Object.fromEntries(DEFAULT_TABS.map((tab) => [tab, []]));
  for (const tab of DEFAULT_TABS) {
    fetched[tab] = [];
    const seen = new Set();
    for (const utcDay of utcDays) {
      const rows = await fetchSignalsCsv(app.baseUrl, sessionToken, tab, utcDay, args.limit);
      fetched[tab].push({ utcDay, rows: rows.length });
      for (const row of rows) {
        const timestamp = timestampFor(tab, row);
        if (!timestamp) continue;
        const time = new Date(timestamp);
        if (time < range.start || time > range.end) continue;
        const key = JSON.stringify(row);
        if (seen.has(key)) continue;
        seen.add(key);
        data[tab].push(row);
      }
    }
    data[tab].sort((a, b) => timestampFor(tab, b).localeCompare(timestampFor(tab, a)));
  }

  const artifact = {
    summary: {
      generatedAt: new Date().toISOString(),
      range: {
        timezone: args.timezone,
        fromLocal: `${args.from}T00:00:00`,
        toLocal: `${args.to}T23:59:59.999`,
        fromUtc: range.start.toISOString(),
        toUtc: range.end.toISOString(),
        fetchedUtcDays: utcDays
      },
      source: {
        baseUrl: app.baseUrl,
        renderService: app.service
      },
      fetched,
      ...analyze(data, args.timezone)
    }
  };

  if (args.includeRaw) {
    artifact.data = data;
  }

  const outputPath = resolve(process.cwd(), args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        output: outputPath,
        range: artifact.summary.range,
        counts: artifact.summary.counts,
        generationStatuses: artifact.summary.generationStatuses,
        generationErrorGroups: artifact.summary.generationErrorGroups,
        feedbackCount: artifact.summary.feedback.length,
        editCount: artifact.summary.edits.length,
        titleCount: artifact.summary.titles.length,
        problematicGenerationCount: artifact.summary.problematicGenerations.length,
        rankedValidationIssues:
          artifact.summary.qualityPipeline.validationIssues.rankedIssueCodes.slice(0, 12),
        numericAssessments:
          artifact.summary.qualityPipeline.numericAssessmentsByPromptVersion
            .byPromptVersion,
        markerLeaks: artifact.summary.qualityPipeline.markerLeaksByPromptVersion,
        triage: artifact.summary.qualityPipeline.triageByPromptVersion,
        falseSkipSignals: artifact.summary.falseSkipSignalsByReasonCode,
        referenceRepair: artifact.summary.qualityPipeline.referenceRepairByPromptVersion,
        modelCalls: artifact.summary.qualityPipeline.modelCallsByPromptVersion,
        openAIUsageAndCost: artifact.summary.qualityPipeline.openAIUsageAndCost,
        editPatterns: {
          ...artifact.summary.qualityPipeline.editPatterns,
          examples: undefined
        }
      },
      null,
      2
    )
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
