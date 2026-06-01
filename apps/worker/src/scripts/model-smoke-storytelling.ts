import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createReportDeveloperPrompt,
  createReportSystemPrompt,
  createReportUserPrompt,
  createSystemPrompt,
  createDeveloperPrompt,
  createUserPrompt,
  PROMPT_VERSION,
  type PromptPayload,
  type ReportPromptPayload
} from "@newsweb/prompt-kit";
import {
  rewriteOutputJsonSchema,
  rewriteOutputSchema,
  type RewriteOutput
} from "@newsweb/shared";
import { config as loadDotEnv } from "dotenv";

import {
  callOpenAIForJson,
  createOpenAIClient,
  type OpenAIReasoningEffort,
  openAIReasoningEfforts
} from "../services/openai-responses.js";
import { sanitizeRewriteStyle } from "../services/style-sanitizer.js";
import { validateRewriteOutput } from "../services/rewrite-validation.js";

type SmokeCase = {
  id: string;
  kind: "regular" | "report";
  payload: PromptPayload | ReportPromptPayload;
  validationPayload: PromptPayload;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
  reasoningEffort: OpenAIReasoningEffort;
};

type SmokeResult = {
  id: string;
  kind: SmokeCase["kind"];
  title: string;
  lead: string;
  body: string[];
  stockAttributionEnding: string | null;
  styleStats: ReturnType<typeof sanitizeRewriteStyle>["stats"];
  validationIssues: Array<{ code: string; severity: string; message: string }>;
  failures: string[];
};

const rootDir = await findRepoRoot();
loadDotEnv({ path: path.join(rootDir, ".env"), override: false });
loadDotEnv({ path: path.resolve(process.cwd(), ".env"), override: false });

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required for model smoke tests.");
}

const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.5";
const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? 240000);
const defaultReasoning = parseReasoningEffort(
  process.env.OPENAI_DEFAULT_REASONING_EFFORT,
  "medium"
);
const reportReasoning = parseReasoningEffort(
  process.env.OPENAI_REPORT_REASONING_EFFORT,
  defaultReasoning
);

const client = createOpenAIClient(apiKey);
const cases = buildSmokeCases(defaultReasoning, reportReasoning);
const results: SmokeResult[] = [];

for (const smokeCase of cases) {
  const raw = await callOpenAIForJson(client, {
    schemaName: "rewrite_output",
    schema: rewriteOutputJsonSchema as Record<string, unknown>,
    systemPrompt: smokeCase.systemPrompt,
    developerPrompt: smokeCase.developerPrompt,
    userPrompt: smokeCase.userPrompt,
    model,
    reasoningEffort: smokeCase.reasoningEffort,
    timeoutMs,
    maxOutputTokens: 4096
  });
  const parsed = rewriteOutputSchema.parse(clampRewriteArrays(JSON.parse(raw)));
  const styleResult = sanitizeRewriteStyle(parsed);
  const rewrite = styleResult.rewrite;
  const validation = validateRewriteOutput(rewrite, smokeCase.validationPayload);
  results.push({
    id: smokeCase.id,
    kind: smokeCase.kind,
    title: rewrite.title,
    lead: rewrite.lead,
    body: rewrite.body,
    stockAttributionEnding: stockAttributionEnding(rewrite.lead),
    styleStats: styleResult.stats,
    validationIssues: validation.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message
    })),
    failures: caseFailures(smokeCase, rewrite, validation.issues)
  });
}

const globalFailures = attributionRepetitionFailures(results);
const report = {
  promptVersion: PROMPT_VERSION,
  model,
  timeoutMs,
  generatedAt: new Date().toISOString(),
  globalFailures,
  results
};

await fs.mkdir(path.join(rootDir, "tmp"), { recursive: true });
const outputPath = path.join(
  rootDir,
  "tmp",
  `model-smoke-storytelling-${timestampForFile(new Date())}.json`
);
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const result of results) {
  console.log(`\n[${result.id}] ${result.title}`);
  console.log(result.lead);
  if (result.failures.length > 0) {
    console.log(`failures: ${result.failures.join(" | ")}`);
  }
}
if (globalFailures.length > 0) {
  console.log(`\nglobal failures: ${globalFailures.join(" | ")}`);
}
console.log(`\nWrote smoke report: ${outputPath}`);

const totalFailures =
  globalFailures.length + results.reduce((sum, result) => sum + result.failures.length, 0);
if (totalFailures > 0) {
  process.exitCode = 1;
}

function buildSmokeCases(
  defaultReasoningEffort: OpenAIReasoningEffort,
  reportReasoningEffort: OpenAIReasoningEffort
): SmokeCase[] {
  const reportPayload: ReportPromptPayload = {
    messageId: 990001,
    title: "Jinhui Shipping and Transportation Limited Fourth Quarter Results",
    issuerName: "Jinhui Shipping and Transportation Limited",
    issuerSign: "JIN",
    publishedAt: "2026-02-27T07:00:00.000Z",
    categories: ["FINANCIAL REPORTS"],
    markets: ["XOSL"],
    bodyText:
      "Jinhui Shipping and Transportation Limited announces unaudited fourth quarter results and dividend proposal.",
    hasAttachments: true,
    sourceBodyChars: 101,
    reportText: [
      "Consolidated income statement, fourth quarter 2025.",
      "Revenue was USD 37.5 million, down from USD 44.2 million in the same quarter last year.",
      "Result before taxation was a loss of USD 2.7 million, compared with a profit of USD 5.2 million last year.",
      "Result after taxation was also a loss of USD 2.7 million, compared with USD 5.2 million last year.",
      "The board proposes a dividend of USD 0.18 per share for 2025.",
      "The group disposed of three Supramax vessels and recognized a one-off loss of USD 3.0 million.",
      "At year-end the group operated 23 vessels, 18 of them owned. Six Ultramax vessels are under construction for delivery in 2028 and 2029."
    ].join("\n"),
    reportPageCount: 16
  };
  const reportReferenceText = [reportPayload.bodyText, reportPayload.reportText].join(
    "\n\n"
  );

  const namedPlatformPayload: PromptPayload = {
    messageId: 990002,
    title: "Otovo launches Endurance platform and reports fourth quarter results",
    issuerName: "Otovo ASA",
    issuerSign: "OTOVO",
    publishedAt: "2026-02-28T16:30:00.000Z",
    categories: ["INSIDE INFORMATION", "FINANCIAL REPORTS"],
    markets: ["XOSL"],
    bodyText: [
      "Otovo launches the Endurance platform, a software platform for sales, installation planning and customer follow-up.",
      "The company says the platform replaces parts of the previous cloud system after the Evo transaction, which was the acquisition of European installer portfolios in 2024.",
      "Fourth quarter revenue was NOK 138.5 million, down 4 percent from NOK 144.2 million.",
      "EBITDA was NOK -62 million, compared with NOK -31 million last year.",
      "Result before tax was NOK -161 million, compared with NOK -71.6 million last year.",
      "The company will raise USD 15-20 million in a private placement."
    ].join("\n"),
    hasAttachments: false,
    sourceBodyChars: 0
  };
  namedPlatformPayload.sourceBodyChars = namedPlatformPayload.bodyText.length;

  return [
    {
      id: "report_storytelling",
      kind: "report",
      payload: reportPayload,
      validationPayload: {
        ...reportPayload,
        bodyText: reportReferenceText,
        sourceBodyChars: reportReferenceText.length
      },
      systemPrompt: createReportSystemPrompt(),
      developerPrompt: createReportDeveloperPrompt(),
      userPrompt: createReportUserPrompt(reportPayload),
      reasoningEffort: reportReasoningEffort
    },
    {
      id: "named_platform_accounting",
      kind: "regular",
      payload: namedPlatformPayload,
      validationPayload: namedPlatformPayload,
      systemPrompt: createSystemPrompt(),
      developerPrompt: createDeveloperPrompt(),
      userPrompt: createUserPrompt(namedPlatformPayload),
      reasoningEffort: defaultReasoningEffort
    }
  ];
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

function caseFailures(
  smokeCase: SmokeCase,
  rewrite: RewriteOutput,
  issues: Array<{ code: string }>
): string[] {
  const failures: string[] = [];
  const visibleText = [rewrite.title, rewrite.lead, ...rewrite.body].join("\n");
  if (rewrite.body.some((item) => /^\s*Dette er noen\b/i.test(item))) {
    failures.push("body_contains_bullet_preamble");
  }
  if (/\b(?:EBITDA|EBITA|EBIT)\b/.test(visibleText)) {
    failures.push("visible_uppercase_accounting_acronym");
  }
  if (issues.some((issue) => issue.code === "UNEXPLAINED_NAMED_TRANSACTION")) {
    failures.push("unexplained_named_item");
  }
  if (
    smokeCase.kind === "report" &&
    /\bfikk et resultat\b/i.test(rewrite.lead) &&
    !/\b(?:snur|snudde|øker|økte|faller|falt|ned|opp|bedre|svakere|dobl|femdobl|pluss|minus|mot|fra)\b/i.test(
      rewrite.lead
    )
  ) {
    failures.push("bare_result_formula_lead");
  }
  return failures;
}

function attributionRepetitionFailures(results: SmokeResult[]): string[] {
  const endings = results
    .map((result) => result.stockAttributionEnding)
    .filter((ending): ending is string => Boolean(ending));
  if (endings.length === results.length && new Set(endings).size === 1) {
    return [`same_stock_attribution_ending:${endings[0]}`];
  }
  return [];
}

function stockAttributionEnding(lead: string): string | null {
  const firstSentence = lead.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? lead;
  const normalized = foldNorwegian(firstSentence.trim().toLowerCase());
  const endings = [
    "ifolge en borsmelding.",
    "ifolge en melding.",
    "viser kvartalsrapporten.",
    "viser rapporten."
  ];
  return endings.find((ending) => normalized.endsWith(ending)) ?? null;
}

function foldNorwegian(text: string): string {
  return text
    .replace(/[æÆ]/g, "ae")
    .replace(/[øØ]/g, "o")
    .replace(/[åÅ]/g, "a");
}

function parseReasoningEffort(
  raw: string | undefined,
  fallback: OpenAIReasoningEffort
): OpenAIReasoningEffort {
  if (raw && (openAIReasoningEfforts as readonly string[]).includes(raw)) {
    return raw as OpenAIReasoningEffort;
  }
  return fallback;
}

async function findRepoRoot(): Promise<string> {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = path.join(current, "package.json");
    try {
      const packageJson = JSON.parse(await fs.readFile(candidate, "utf8")) as {
        name?: string;
      };
      if (packageJson.name === "newsweb-explain-feed") {
        return current;
      }
    } catch {
      // Continue walking upward.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Could not find repo root package.json.");
    }
    current = parent;
  }
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
