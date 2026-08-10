import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import {
  PROMPT_VERSION,
  createDeveloperPrompt,
  createSystemPrompt,
  createUserPrompt,
  type OutputMode,
  type PromptPayload
} from "@newsweb/prompt-kit";
import {
  newswebMessageResponseSchema,
  rewriteOutputJsonSchema,
  rewriteOutputSchema,
  type RewriteOutput
} from "@newsweb/shared";

import {
  callOpenAIForJson,
  createOpenAIClient,
  openAIReasoningEfforts,
  type OpenAIReasoningEffort
} from "../services/openai-responses.js";
import { sanitizeRewriteStyle } from "../services/style-sanitizer.js";
import { validateRewriteOutput } from "../services/rewrite-validation.js";

const NEWSWEB_MESSAGE_URL = "https://api3.oslo.oslobors.no/v1/newsreader/message";

type ParsedArgs = {
  options: Map<string, string[]>;
  positionals: string[];
};

type NoticeSource = {
  payload: PromptPayload;
  url: string;
  attachments: Array<{ id: number; name: string | null }>;
};

type ExpectationResult = {
  name: string;
  passed: boolean;
  details: string;
};

type TargetedNoticeEvalReport = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  promptVersion: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  timeoutMs: number;
  source: {
    messageId: number;
    url: string;
    title: string;
    issuerName: string;
    issuerSign: string;
    publishedAt: string;
    categories: string[];
    markets: string[];
    bodyChars: number;
    hasAttachments: boolean;
    attachments: Array<{ id: number; name: string | null }>;
  };
  promptChars: number;
  latencyMs: number;
  validation: {
    valid: boolean;
    issues: Array<{ code: string; severity: string; message: string }>;
    blockingErrors: string[];
    warnings: string[];
  } | null;
  expectations: ExpectationResult[];
  styleSanitization: ReturnType<typeof sanitizeRewriteStyle>["stats"] | null;
  output: RewriteOutput | null;
  rawOutput: RewriteOutput | null;
  errorText: string | null;
  prompts?: {
    system: string;
    developer: string;
    user: string;
  };
};

if (isMainModule()) {
  await main();
}

export function parseArgs(args: string[]): ParsedArgs {
  const options = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (!token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex > 0) {
        addOption(options, token.slice(0, eqIndex), token.slice(eqIndex + 1));
        continue;
      }
      if (token === "dry-run" || token === "include-prompts" || token === "expect-quote" || token === "help") {
        addOption(options, token, "true");
        continue;
      }
      positionals.push(token);
      continue;
    }

    const eqIndex = token.indexOf("=");
    const key = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
    const inlineValue = eqIndex >= 0 ? token.slice(eqIndex + 1) : null;
    const next = args[index + 1];
    const value =
      inlineValue ??
      (!next || next.startsWith("--") ? "true" : (index += 1, next));

    addOption(options, key, value);
  }

  return { options, positionals };
}

function addOption(options: Map<string, string[]>, key: string, value: string): void {
  if (!options.has(key)) {
    options.set(key, []);
  }
  options.get(key)?.push(value);
}

export function parseNewswebMessageId(input: string): number {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error(`Could not parse Newsweb message id from: ${input}`);
  }

  const queryId = parsedUrl.searchParams.get("messageId");
  if (queryId && /^\d+$/.test(queryId)) {
    return Number(queryId);
  }

  const pathMatch = parsedUrl.pathname.match(/\/message\/(\d+)\b/);
  if (pathMatch) {
    return Number(pathMatch[1]);
  }

  throw new Error(`Could not parse Newsweb message id from URL: ${input}`);
}

export function evaluateExpectations(
  rewrite: RewriteOutput,
  options: Map<string, string[]>
): ExpectationResult[] {
  const visibleText = [rewrite.title, rewrite.lead, ...rewrite.body].join("\n");
  const sourceSpansText = rewrite.source_spans.join("\n");
  const excludedHypeText = rewrite.excluded_hype.join("\n");
  const results: ExpectationResult[] = [];

  for (const person of values(options, "expect-person")) {
    results.push({
      name: `expect-person:${person}`,
      passed: normalizedIncludes(visibleText, person),
      details: `Visible article text should mention ${person}.`
    });
  }

  for (const text of values(options, "expect-visible")) {
    results.push({
      name: `expect-visible:${text}`,
      passed: normalizedIncludes(visibleText, text),
      details: `Visible article text should contain ${text}.`
    });
  }

  for (const pattern of values(options, "expect-visible-regex")) {
    results.push(regexExpectation("expect-visible-regex", visibleText, pattern, true));
  }

  for (const text of values(options, "expect-source-span")) {
    results.push({
      name: `expect-source-span:${text}`,
      passed: normalizedIncludes(sourceSpansText, text),
      details: `source_spans should contain ${text}.`
    });
  }

  for (const pattern of values(options, "expect-source-span-regex")) {
    results.push(regexExpectation("expect-source-span-regex", sourceSpansText, pattern, true));
  }

  for (const text of values(options, "expect-not-visible")) {
    results.push({
      name: `expect-not-visible:${text}`,
      passed: !normalizedIncludes(visibleText, text),
      details: `Visible article text should not contain ${text}.`
    });
  }

  for (const pattern of values(options, "expect-not-visible-regex")) {
    results.push(regexExpectation("expect-not-visible-regex", visibleText, pattern, false));
  }

  for (const text of values(options, "expect-not-excluded")) {
    results.push({
      name: `expect-not-excluded:${text}`,
      passed: !normalizedIncludes(excludedHypeText, text),
      details: `excluded_hype should not contain ${text}.`
    });
  }

  for (const pattern of values(options, "expect-not-excluded-regex")) {
    results.push(
      regexExpectation("expect-not-excluded-regex", excludedHypeText, pattern, false)
    );
  }

  if (flag(options, "expect-quote")) {
    results.push({
      name: "expect-quote",
      passed: hasQuoteOrPersonAttribution(visibleText),
      details:
        "Visible article text should include a direct quote, guillemet quote, or a person-attributed paraphrase."
    });
  }

  return results;
}

async function main(): Promise<void> {
  const rootDir = await findRepoRoot();
  loadDotEnv({ path: path.join(rootDir, ".env"), override: false });
  loadDotEnv({ path: path.resolve(process.cwd(), ".env"), override: false });

  const parsed = parseArgs(process.argv.slice(2));
  if (flag(parsed.options, "help")) {
    printUsage();
    return;
  }

  const messageId = requestedMessageId(parsed);
  const outputMode = parseOutputMode(optionalValue(parsed.options, "output-mode"));
  const maxVisibleArticleChars = optionalPositiveInt(
    parsed.options,
    "max-visible-chars"
  );
  const model = optionalValue(parsed.options, "model") ?? process.env.OPENAI_MODEL?.trim() ?? "gpt-5.5";
  const timeoutMs = optionalPositiveInt(parsed.options, "timeout-ms") ?? Number(process.env.OPENAI_TIMEOUT_MS ?? 240000);
  const maxOutputTokens = optionalPositiveInt(parsed.options, "max-output-tokens") ?? 4096;
  const reasoningEffort = parseReasoningEffort(
    optionalValue(parsed.options, "reasoning") ??
      process.env.OPENAI_DEFAULT_REASONING_EFFORT,
    "medium"
  );
  const includePrompts = flag(parsed.options, "include-prompts");
  const dryRun = flag(parsed.options, "dry-run");

  const source = await fetchNoticeSource(messageId);
  const payload: PromptPayload = {
    ...source.payload,
    ...(outputMode ? { outputMode } : {}),
    ...(maxVisibleArticleChars ? { maxVisibleArticleChars } : {})
  };
  const systemPrompt = createSystemPrompt();
  const developerPrompt = createDeveloperPrompt();
  const userPrompt = createUserPrompt(payload);
  const promptChars =
    systemPrompt.length + developerPrompt.length + userPrompt.length;
  const runId = `targeted_notice_eval_${messageId}_${timestampForFile(new Date())}`;

  if (dryRun) {
    const report = buildReport({
      runId,
      model,
      reasoningEffort,
      timeoutMs,
      source,
      payload,
      promptChars,
      latencyMs: 0,
      validation: null,
      expectations: [],
      styleSanitization: null,
      output: null,
      rawOutput: null,
      errorText: null,
      prompts: includePrompts ? { system: systemPrompt, developer: developerPrompt, user: userPrompt } : undefined
    });
    await writeReport(rootDir, parsed.options, report);
    printSourceSummary(source, promptChars);
    console.log("Dry run only: fetched source and built prompts, no model call.");
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required unless --dry-run is used.");
  }

  const startedAt = Date.now();
  let report: TargetedNoticeEvalReport;

  try {
    const client = createOpenAIClient(apiKey);
    const { content: raw } = await callOpenAIForJson(client, {
      schemaName: "rewrite_output",
      schema: rewriteOutputJsonSchema as Record<string, unknown>,
      systemPrompt,
      developerPrompt,
      userPrompt,
      model,
      reasoningEffort,
      timeoutMs,
      maxOutputTokens
    });
    const rawOutput = rewriteOutputSchema.parse(clampRewriteArrays(JSON.parse(raw)));
    const styleResult = sanitizeRewriteStyle(rawOutput);
    const output = styleResult.rewrite;
    const validation = validateRewriteOutput(output, payload);
    const expectations = evaluateExpectations(output, parsed.options);

    report = buildReport({
      runId,
      model,
      reasoningEffort,
      timeoutMs,
      source,
      payload,
      promptChars,
      latencyMs: Date.now() - startedAt,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        blockingErrors: validation.blockingErrors,
        warnings: validation.warnings
      },
      expectations,
      styleSanitization: styleResult.stats,
      output,
      rawOutput,
      errorText: null,
      prompts: includePrompts ? { system: systemPrompt, developer: developerPrompt, user: userPrompt } : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report = buildReport({
      runId,
      model,
      reasoningEffort,
      timeoutMs,
      source,
      payload,
      promptChars,
      latencyMs: Date.now() - startedAt,
      validation: null,
      expectations: [],
      styleSanitization: null,
      output: null,
      rawOutput: null,
      errorText: message,
      prompts: includePrompts ? { system: systemPrompt, developer: developerPrompt, user: userPrompt } : undefined
    });
  }

  const outPath = await writeReport(rootDir, parsed.options, report);
  printSourceSummary(source, promptChars);
  printOutputSummary(report, outPath);

  const failedExpectations = report.expectations.filter((item) => !item.passed);
  const blockingValidation = report.validation?.blockingErrors.length ?? 0;
  if (report.errorText || failedExpectations.length > 0 || blockingValidation > 0) {
    process.exitCode = 1;
  }
}

async function fetchNoticeSource(messageId: number): Promise<NoticeSource> {
  const response = await fetch(`${NEWSWEB_MESSAGE_URL}?messageId=${messageId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Newsweb message ${messageId} failed: ${response.status}`);
  }

  const json = await response.json();
  const parsed = newswebMessageResponseSchema.parse(json);
  const rawMessage = asRecord(asRecord(json)?.data)?.message;
  const raw = asRecord(rawMessage) ?? {};
  const message = parsed.data.message;
  const attachments = extractAttachments(raw.attachments);
  const categories = extractCategories(raw.category);
  const markets = extractStrings(raw.markets);
  const bodyText = message.body ?? "";

  return {
    url: `https://newsweb.oslobors.no/message/${messageId}`,
    attachments,
    payload: {
      messageId,
      title: message.title,
      issuerName: message.issuerName?.trim() || "ikke oppgitt",
      issuerSign: message.issuerSign?.trim() || "ikke oppgitt",
      publishedAt: message.publishedTime ?? new Date(0).toISOString(),
      categories,
      markets,
      bodyText,
      hasAttachments: attachments.length > 0,
      sourceBodyChars: bodyText.length
    }
  };
}

function buildReport(args: {
  runId: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  timeoutMs: number;
  source: NoticeSource;
  payload: PromptPayload;
  promptChars: number;
  latencyMs: number;
  validation: TargetedNoticeEvalReport["validation"];
  expectations: ExpectationResult[];
  styleSanitization: TargetedNoticeEvalReport["styleSanitization"];
  output: RewriteOutput | null;
  rawOutput: RewriteOutput | null;
  errorText: string | null;
  prompts?: TargetedNoticeEvalReport["prompts"];
}): TargetedNoticeEvalReport {
  return {
    schemaVersion: 1,
    runId: args.runId,
    createdAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    model: args.model,
    reasoningEffort: args.reasoningEffort,
    timeoutMs: args.timeoutMs,
    source: {
      messageId: args.payload.messageId,
      url: args.source.url,
      title: args.payload.title,
      issuerName: args.payload.issuerName,
      issuerSign: args.payload.issuerSign,
      publishedAt: args.payload.publishedAt,
      categories: args.payload.categories,
      markets: args.payload.markets,
      bodyChars: args.payload.sourceBodyChars,
      hasAttachments: args.payload.hasAttachments,
      attachments: args.source.attachments
    },
    promptChars: args.promptChars,
    latencyMs: args.latencyMs,
    validation: args.validation,
    expectations: args.expectations,
    styleSanitization: args.styleSanitization,
    output: args.output,
    rawOutput: args.rawOutput,
    errorText: args.errorText,
    ...(args.prompts ? { prompts: args.prompts } : {})
  };
}

async function writeReport(
  rootDir: string,
  options: Map<string, string[]>,
  report: TargetedNoticeEvalReport
): Promise<string> {
  const outPath =
    optionalValue(options, "out") ??
    path.join(
      rootDir,
      "tmp",
      "targeted-notice-eval",
      `${report.runId}.json`
    );
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outPath;
}

function requestedMessageId(parsed: ParsedArgs): number {
  const input =
    optionalValue(parsed.options, "message-id") ??
    optionalValue(parsed.options, "id") ??
    optionalValue(parsed.options, "url") ??
    parsed.positionals[0];
  if (!input) {
    throw new Error("Missing --message-id, --id, --url or positional Newsweb URL/id.");
  }
  return parseNewswebMessageId(input);
}

function parseReasoningEffort(
  value: string | undefined,
  fallback: OpenAIReasoningEffort
): OpenAIReasoningEffort {
  if (!value) return fallback;
  if (!openAIReasoningEfforts.includes(value as OpenAIReasoningEffort)) {
    throw new Error(`Invalid reasoning effort: ${value}`);
  }
  return value as OpenAIReasoningEffort;
}

function parseOutputMode(value: string | undefined): OutputMode | undefined {
  if (!value) return undefined;
  if (value !== "notice" && value !== "extended_notice") {
    throw new Error("--output-mode must be notice or extended_notice");
  }
  return value;
}

function optionalValue(options: Map<string, string[]>, name: string): string | undefined {
  const value = options.get(name)?.[0]?.trim();
  return value ? value : undefined;
}

function values(options: Map<string, string[]>, name: string): string[] {
  return options.get(name)?.filter((value) => value !== "true") ?? [];
}

function flag(options: Map<string, string[]>, name: string): boolean {
  return options.get(name)?.some((value) => value === "true") ?? false;
}

function optionalPositiveInt(
  options: Map<string, string[]>,
  name: string
): number | undefined {
  const raw = optionalValue(options, name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function normalizedIncludes(haystack: string, needle: string): boolean {
  return normalizeForSearch(haystack).includes(normalizeForSearch(needle));
}

function normalizeForSearch(value: string): string {
  return value
    .toLocaleLowerCase("nb-NO")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function regexExpectation(
  name: string,
  text: string,
  pattern: string,
  shouldMatch: boolean
): ExpectationResult {
  const regex = new RegExp(pattern, "iu");
  const matched = regex.test(text);
  return {
    name: `${name}:${pattern}`,
    passed: shouldMatch ? matched : !matched,
    details: `${name} ${shouldMatch ? "should match" : "should not match"} /${pattern}/iu.`
  };
}

function hasQuoteOrPersonAttribution(text: string): boolean {
  return (
    /[«»]/.test(text) ||
    /(^|\n)\s*[-–]\s+\S/.test(text) ||
    /\b(?:konsernsjef|toppsjef|ceo|finansdirektør|styreleder|primærinnsider)\b.{0,120}\b(?:sier|uttaler|opplyser)\b/iu.test(text) ||
    /\b(?:sier|uttaler|opplyser)\b.{0,120}\b(?:konsernsjef|toppsjef|ceo|finansdirektør|styreleder|primærinnsider)\b/iu.test(text)
  );
}

function clampRewriteArrays(raw: Record<string, unknown>): Record<string, unknown> {
  const limits: Record<string, number> = {
    body: 8,
    key_facts: 8,
    source_spans: 8,
    negative_or_surprising: 6,
    excluded_hype: 6,
    source_limitations: 6
  };
  for (const [key, max] of Object.entries(limits)) {
    if (Array.isArray(raw[key]) && raw[key].length > max) {
      raw[key] = raw[key].slice(0, max);
    }
  }
  return raw;
}

function extractCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      return typeof record?.category_no === "string" ? record.category_no : null;
    })
    .filter((item): item is string => Boolean(item));
}

function extractStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function extractAttachments(value: unknown): Array<{ id: number; name: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = typeof record?.id === "number" ? record.id : null;
    if (id == null) return [];
    const name =
      typeof record?.name === "string"
        ? record.name
        : typeof record?.fileName === "string"
          ? record.fileName
          : null;
    return [{ id, name }];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function findRepoRoot(): Promise<string> {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(current, "package.json"), "utf8")
      ) as { name?: string };
      if (packageJson.name === "newsweb-explain-feed") {
        return current;
      }
    } catch {
      // Keep walking.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Could not find repo root.");
    }
    current = parent;
  }
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function printSourceSummary(source: NoticeSource, promptChars: number): void {
  console.log(`\n[notice] ${source.payload.messageId} ${source.payload.title}`);
  console.log(
    `${source.payload.issuerName} (${source.payload.issuerSign}) | ${source.payload.publishedAt}`
  );
  console.log(
    `bodyChars=${source.payload.sourceBodyChars} attachments=${source.attachments.length} promptChars=${promptChars}`
  );
}

function printOutputSummary(report: TargetedNoticeEvalReport, outPath: string): void {
  if (report.errorText) {
    console.log(`\nerror: ${report.errorText}`);
    console.log(`Wrote report: ${outPath}`);
    return;
  }
  const output = report.output;
  if (!output) {
    console.log(`\nNo output generated.`);
    console.log(`Wrote report: ${outPath}`);
    return;
  }

  console.log(`\n[rewrite] ${output.title}`);
  console.log(output.lead);
  for (const paragraph of output.body) {
    console.log(paragraph);
  }
  console.log(`\nsource_spans: ${output.source_spans.join(" | ")}`);
  console.log(`excluded_hype: ${output.excluded_hype.join(" | ") || "(empty)"}`);

  const blockingErrors = report.validation?.blockingErrors ?? [];
  const warnings = report.validation?.warnings ?? [];
  console.log(
    `validation: ${blockingErrors.length === 0 ? "pass" : "fail"} (${blockingErrors.length} blocking, ${warnings.length} warnings)`
  );
  if (blockingErrors.length > 0) {
    for (const error of blockingErrors) console.log(`  - ${error}`);
  }

  if (report.expectations.length > 0) {
    console.log("\nexpectations:");
    for (const expectation of report.expectations) {
      console.log(`  ${expectation.passed ? "PASS" : "FAIL"} ${expectation.name}`);
    }
  }

  console.log(`\nWrote report: ${outPath}`);
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  npm run eval:notice -- url=https://newsweb.oslobors.no/message/675348 expect-person=\"Geir Karlsen\" expect-visible-regex=\"etterspørsel|selger raskt\"",
      "  npm run eval:notice -- -- --url https://newsweb.oslobors.no/message/675348 --expect-person \"Geir Karlsen\"",
      "",
      "Input:",
      "  url=<url> | --url <url>     Newsweb URL, e.g. https://newsweb.oslobors.no/message/675348",
      "  message-id=<id> | id=<id> | --message-id <id> | --id <id>",
      "",
      "Model options:",
      "  --model <name>              Defaults to OPENAI_MODEL or gpt-5.5",
      "  --reasoning <effort>        none|minimal|low|medium|high|xhigh",
      "  --timeout-ms <ms>",
      "  --max-output-tokens <n>",
      "  --dry-run                   Fetch notice and build prompts without calling the model",
      "  --include-prompts           Include full prompts in the JSON report",
      "  --out <path>                Defaults to tmp/targeted-notice-eval/<runId>.json",
      "",
      "Expectations:",
      "  --expect-person <text>      Visible title/lead/body must mention this person",
      "  --expect-quote              Visible text must include a quote or person-attributed paraphrase",
      "  --expect-visible <text>",
      "  --expect-visible-regex <regex>",
      "  --expect-source-span <text>",
      "  --expect-source-span-regex <regex>",
      "  --expect-not-visible <text>",
      "  --expect-not-visible-regex <regex>",
      "  --expect-not-excluded <text>",
      "  --expect-not-excluded-regex <regex>"
    ].join("\n")
  );
}

function isMainModule(): boolean {
  return process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}
