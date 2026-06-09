#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
  if (!body.sessionToken) throw new Error("Login response did not include sessionToken");
  return body.sessionToken;
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
      return {
        message_id: entry.message_id,
        notice: entry.notice,
        attempts: rows.length,
        final_status: final?.status ?? "",
        had_error: rows.some((row) => row.error_group || row.error_text),
        had_checker_error: rows.some((row) => /checker error/i.test(row.reference_check_summary ?? "")),
        had_manual_reprocess: rows.some((row) => row.reason === "manual-reprocess"),
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
        problematicGenerationCount: artifact.summary.problematicGenerations.length
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
