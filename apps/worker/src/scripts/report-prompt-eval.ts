import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createReportDeveloperPrompt,
  createReportSystemPrompt,
  createReportUserPrompt,
  PROMPT_VERSION,
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
import { replayValidationPayloadFromRow } from "../services/generation-run-replay.js";

// Replays stored report generation payloads (generation_runs.input_json.sourcePayload)
// through the CURRENT report prompt and compares the output against the published
// rewrite (which is the old prompt's output). Read-only against the DB.

type NoticeResult = {
  messageId: number;
  generationRunId: string | null;
  runRequestedAt: string | null;
  storedPromptVersion: string | null;
  baseline: SideResult | null;
  candidate: SideResult | null;
  candidateValidationIssues?: Array<{ code: string; severity: string; message: string }>;
  latencyMs?: number;
  errorText?: string;
};

type SideResult = {
  title: string;
  lead: string;
  body: string[];
  duplication: { leadNumbers: string[]; duplicated: string[] };
};

const rootDir = await findRepoRoot();
loadDotEnv({ path: path.join(rootDir, ".env"), override: false });
loadDotEnv({ path: path.resolve(process.cwd(), ".env"), override: false });

const args = parseArgs(process.argv.slice(2));
const messageIds = (args.values["message-ids"] ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
if (messageIds.length === 0 || messageIds.some((id) => !/^\d+$/.test(id))) {
  console.error(
    "Usage: npx tsx src/scripts/report-prompt-eval.ts --message-ids 680139,677301 [--model NAME] [--reasoning EFFORT] [--timeout-ms N] [--max-output-tokens N] [--dry-run]"
  );
  process.exit(1);
}

const dryRun = args.flags.has("dry-run");
const model = args.values.model ?? process.env.OPENAI_MODEL?.trim() ?? "gpt-5.5";
const reasoningEffort = parseReasoningEffort(
  args.values.reasoning ??
    process.env.OPENAI_REPORT_REASONING_EFFORT ??
    process.env.OPENAI_DEFAULT_REASONING_EFFORT,
  "medium"
);
const timeoutMs = Number(args.values["timeout-ms"] ?? process.env.OPENAI_TIMEOUT_MS ?? 240000);
const maxOutputTokens = Number(args.values["max-output-tokens"] ?? 16384);

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey && !dryRun) {
  throw new Error("OPENAI_API_KEY is required unless --dry-run is used.");
}

// db.ts reads DATABASE_URL at module load, so import only after dotenv above.
const { logPrisma, prisma } = await import("@newsweb/shared/db");
const client = apiKey ? createOpenAIClient(apiKey) : null;

const results: NoticeResult[] = [];
for (const idText of messageIds) {
  const messageId = Number(idText);
  const result: NoticeResult = {
    messageId,
    generationRunId: null,
    runRequestedAt: null,
    storedPromptVersion: null,
    baseline: null,
    candidate: null
  };
  results.push(result);
  try {
    const rows = await logPrisma.generationRun.findMany({
      where: { messageId },
      orderBy: { requestedAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        promptVersion: true,
        requestedAt: true,
        inputJson: true
      }
    });
    const reportRow = rows.find((row) => {
      const sp = asRecord(asRecord(row.inputJson)?.sourcePayload);
      return (
        sp !== null &&
        typeof sp.reportText === "string" &&
        typeof sp.reportPageCount === "number"
      );
    });
    if (!reportRow) {
      result.errorText = `No generation run with a report sourcePayload among latest ${rows.length} runs.`;
      continue;
    }
    const sourcePayload = asRecord(asRecord(reportRow.inputJson)?.sourcePayload)!;
    const payload = sourcePayload as unknown as ReportPromptPayload;
    result.generationRunId = reportRow.id;
    result.runRequestedAt = reportRow.requestedAt.toISOString();
    result.storedPromptVersion = reportRow.promptVersion;

    const baselineRow = await prisma.rewrite.findFirst({
      where: { messageId, status: "published" },
      orderBy: { version: "desc" },
      select: { rewriteJson: true, version: true, promptVersion: true }
    });
    const baselineParsed = baselineRow
      ? rewriteOutputSchema.safeParse(baselineRow.rewriteJson)
      : null;
    if (baselineParsed?.success) {
      result.baseline = toSideResult(baselineParsed.data);
    }

    const systemPrompt = createReportSystemPrompt();
    const developerPrompt = createReportDeveloperPrompt(undefined, payload);
    const userPrompt = createReportUserPrompt(payload);
    if (dryRun) {
      result.errorText = `dry-run: prompts built (user prompt ${userPrompt.length} chars, reportText ${payload.reportText.length} chars).`;
      continue;
    }

    const startedAt = Date.now();
    const { content: raw } = await callOpenAIForJson(client!, {
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
    result.latencyMs = Date.now() - startedAt;
    const parsed = rewriteOutputSchema.parse(clampRewriteArrays(JSON.parse(raw)));
    const rewrite = sanitizeRewriteStyle(parsed).rewrite;
    result.candidate = toSideResult(rewrite);

    const replay = replayValidationPayloadFromRow({ sourcePayload });
    if (replay) {
      result.candidateValidationIssues = validateRewriteOutput(rewrite, replay.payload).issues.map(
        (issue) => ({ code: issue.code, severity: issue.severity, message: issue.message })
      );
    }
  } catch (error) {
    result.errorText = error instanceof Error ? error.message : String(error);
  }
}

const runId = `report_prompt_eval_${timestampForFile(new Date())}`;
const outputDir = path.join(rootDir, "tmp", "report-prompt-eval");
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `${runId}.json`);
await fs.writeFile(
  outputPath,
  `${JSON.stringify(
    { runId, promptVersion: PROMPT_VERSION, model, reasoningEffort, dryRun, results },
    null,
    2
  )}\n`,
  "utf8"
);

for (const result of results) {
  console.log(`\n=== ${result.messageId} ===`);
  if (result.errorText) console.log(`note: ${result.errorText}`);
  printSide("BASELINE (published)", result.baseline);
  printSide(`NEW (${PROMPT_VERSION})`, result.candidate);
  if (result.candidateValidationIssues?.length) {
    console.log(
      `validation: ${result.candidateValidationIssues
        .map((issue) => `${issue.severity}:${issue.code}`)
        .join(", ")}`
    );
  }
}
console.log(`\nWrote eval report: ${outputPath}`);

await prisma.$disconnect();
if (logPrisma !== prisma) {
  await logPrisma.$disconnect();
}

function printSide(label: string, side: SideResult | null): void {
  if (!side) {
    console.log(`--- ${label}: (missing)`);
    return;
  }
  console.log(`--- ${label} [lead numbers repeated in body opening: ${side.duplication.duplicated.length > 0 ? side.duplication.duplicated.join(" ") : "none"}]`);
  console.log(`TITLE: ${side.title}`);
  console.log(`LEAD:  ${side.lead}`);
  for (const paragraph of side.body) {
    console.log(`BODY:  ${paragraph}`);
  }
}

function toSideResult(rewrite: RewriteOutput): SideResult {
  return {
    title: rewrite.title,
    lead: rewrite.lead,
    body: rewrite.body,
    duplication: numberDuplication(rewrite)
  };
}

function numberDuplication(rewrite: RewriteOutput): SideResult["duplication"] {
  const leadNumbers = [...extractNumbers(rewrite.lead)];
  const openingNumbers = extractNumbers(rewrite.body.slice(0, 3).join("\n"));
  return {
    leadNumbers,
    duplicated: leadNumbers.filter((token) => openingNumbers.has(token))
  };
}

function extractNumbers(text: string): Set<string> {
  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return new Set(
    matches
      .filter((token) => token.replace(/[.,]/g, "").length > 1 || Number(token) > 3)
      .map((token) => token.replace(".", ","))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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

function parseArgs(argv: string[]): { values: Record<string, string>; flags: Set<string> } {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (name === "dry-run" || next === undefined || next.startsWith("--")) {
      flags.add(name);
    } else {
      values[name] = next;
      index += 1;
    }
  }
  return { values, flags };
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
