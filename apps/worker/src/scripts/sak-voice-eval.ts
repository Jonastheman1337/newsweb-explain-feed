import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parse as parseEnv } from "dotenv";
import { createOpenAIClient, callOpenAIForJson, type OpenAIJsonRequest } from "@newsweb/shared/openai-responses";
import type { SakDraftJobData } from "@newsweb/shared";
import type { SakDraftDeps } from "../services/sak-draft.js";

// Local-only full /sak replay. Both database boundaries are replaced with memory.
// Sources and model responses stay in the caller's git-ignored output directory.
type Case = {
  id: string;
  description: string;
  origin: Record<string, unknown>;
  data: SakDraftJobData;
};
type Corpus = {
  schemaVersion: 1;
  phase: "development" | "locked";
  baselineSha: string;
  cases: Case[];
  casesSha256: string;
};
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!key?.startsWith("--") || !value || args.has(key)) throw new Error("Expected unique --name value arguments");
  args.set(key, value);
}
const allowed = new Set(["--cases", "--root", "--out", "--arm", "--env-file", "--concurrency", "--only", "--dry-run"]);
for (const key of args.keys()) if (!allowed.has(key)) throw new Error("Unknown option: " + key);
function required(name: string): string {
  const value = args.get(name);
  if (!value) throw new Error("Missing " + name);
  return value;
}
const root = path.resolve(required("--root"));
const out = path.resolve(required("--out"));
const arm = required("--arm");
if (!["control", "candidate"].includes(arm)) throw new Error("arm must be control or candidate");
const corpus: Corpus = JSON.parse(fs.readFileSync(required("--cases"), "utf8").replace(/^\uFEFF/, ""));
if (corpus.schemaVersion !== 1 || hash(corpus.cases) !== corpus.casesSha256) throw new Error("Corpus integrity mismatch");
if (new Set(corpus.cases.map(c => c.id)).size !== corpus.cases.length) throw new Error("Duplicate cases");
if (corpus.phase === "locked" && (corpus.cases.length !== 12 || corpus.cases.filter(c => c.data.previousArticleJson).length !== 4)) {
  throw new Error("Locked comparison requires eight first drafts and four revisions");
}
const only = args.get("--only")?.split(",");
if (only?.some(id => !corpus.cases.some(c => c.id === id))) throw new Error("Unknown selected case");
const selected = corpus.cases.filter(c => !only || only.includes(c.id));
const concurrency = Number(args.get("--concurrency") ?? 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) throw new Error("Use one or two concurrent cases");
const codeFiles = [
  "packages/prompt-kit/src/sak-editorial.ts", "packages/prompt-kit/src/sak-prompt.ts",
  "packages/prompt-kit/src/shared-editorial.ts", "packages/prompt-kit/src/currency-editorial.ts",
  "apps/worker/src/services/sak-review.ts", "apps/worker/src/services/sak-validation.ts",
  "apps/worker/src/services/sak-draft.ts", "apps/worker/src/services/revision-instructions.ts"
];
const codeHashes = Object.fromEntries(codeFiles.map(file => [file, hash(fs.readFileSync(path.join(root, file), "utf8"))]));
const binding = await import("@newsweb/prompt-kit");
const expectedVersion = fs.readFileSync(path.join(root, "packages/prompt-kit/src/sak-prompt.ts"), "utf8").match(/SAK_PROMPT_VERSION = "([^"]+)"/)?.[1];
if (binding.SAK_PROMPT_VERSION !== expectedVersion) throw new Error("Wrong prompt-kit binding: use the matching tsconfig paths");
const engine = await import(pathToFileURL(path.join(root, "apps/worker/src/services/sak-draft.ts")).href);
const profile = { model: engine.SAK_MODEL, reasoningEffort: engine.SAK_REASONING_EFFORT, serviceTier: "default", maxOutputTokens: engine.SAK_MAX_OUTPUT_TOKENS, timeoutMs: 360000 };
const runnerHash = hash(fs.readFileSync(new URL(import.meta.url), "utf8"));
const fingerprint = hash({ runnerHash, arm, corpusSha: corpus.casesSha256, codeHashes, profile, promptVersion: binding.SAK_PROMPT_VERSION });
fs.mkdirSync(out, { recursive: true });
const manifest = { runnerHash, arm, corpusSha: corpus.casesSha256, baselineSha: corpus.baselineSha, codeHashes, profile, promptVersion: binding.SAK_PROMPT_VERSION, fingerprint };
const manifestFile = path.join(out, "manifest.json");
if (fs.existsSync(manifestFile) && JSON.parse(fs.readFileSync(manifestFile, "utf8")).fingerprint !== fingerprint) throw new Error("Output directory belongs to another run; choose a new directory");
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
if (args.get("--dry-run") === "true") {
  console.log(JSON.stringify({ ...manifest, cases: selected.map(c => ({ id: c.id, sourceCount: c.data.materials.length, previous: Boolean(c.data.previousArticleJson) })) }, null, 2));
  process.exit(0);
}
const envFile = required("--env-file");
const env = parseEnv(fs.readFileSync(envFile));
const apiKey = env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("No OpenAI API key available");
const client = createOpenAIClient(apiKey);
async function runCase(c: Case): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(c.id)) throw new Error("Unsafe case id");
  const filename = path.join(out, c.id + ".json");
  if (fs.existsSync(filename)) {
    const prior = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (prior.fingerprint !== fingerprint || prior.caseHash !== hash(c)) throw new Error("Existing result mismatch");
    console.log(JSON.stringify({ arm, case: c.id, reused: true, status: prior.version?.status ?? "failed" }));
    return;
  }
  const calls: Array<Record<string, unknown>> = [];
  let version: Record<string, unknown> = {};
  let run: Record<string, unknown> = {};
  const start = Date.now();
  const data = structuredClone(c.data);
  const write = (error: string | null, complete: boolean) => fs.writeFileSync(filename + (complete ? "" : ".partial"), JSON.stringify({
    fingerprint, caseHash: hash(c), caseId: c.id, description: c.description, origin: c.origin,
    status: complete ? "complete" : "running", version, run, calls, error, durationMs: Date.now() - start
  }, null, 2));
  const deps: SakDraftDeps = {
    prisma: {
      sakDraft: {
        findUnique: async () => ({ id: data.sakId, activeGenerationRunId: data.generationRunId }),
        updateMany: async () => ({ count: 1 })
      },
      sakVersion: { upsert: async (value) => { version = { ...version, ...value.create, ...value.update }; } }
    },
    logPrisma: { generationRun: { update: async (value) => { run = { ...run, ...value.data }; } } },
    callModelForJson: async (input) => {
      const request: OpenAIJsonRequest = { ...input, model: input.model ?? profile.model, reasoningEffort: input.reasoningEffort ?? "high", timeoutMs: input.timeoutMs ?? profile.timeoutMs, maxOutputTokens: input.maxOutputTokens ?? profile.maxOutputTokens, serviceTier: "default" };
      const index = calls.length;
      calls.push({ request, requestHash: hash(request), startedAt: new Date().toISOString() });
      write(null, false);
      console.log(JSON.stringify({ arm, case: c.id, stage: input.schemaName, event: "start" }));
      try {
        const result = await callOpenAIForJson(client, request);
        const { content, ...telemetry } = result;
        calls[index] = { ...calls[index], content, telemetry, finishedAt: new Date().toISOString() };
        write(null, false);
        return { content, promptChars: input.systemPrompt.length + input.developerPrompt.length + input.userPrompt.length, modelCall: { ...telemetry, model: request.model } };
      } catch (error) {
        calls[index] = { ...calls[index], error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() };
        write(null, false);
        throw error;
      }
    },
    promptCacheMode: "implicit",
    config: { OPENAI_SAK_REASONING_EFFORT: "high", OPENAI_SAK_TIMEOUT_MS: profile.timeoutMs },
    now: () => new Date(data.todayIso),
    log: (message) => console.log(JSON.stringify({ arm, case: c.id, event: "pipeline", message }))
  };
  let error: string | null = null;
  try {
    await engine.processSakDraft({ name: "sak-draft", data, id: "offline-" + c.id, attemptsMade: 0, opts: { attempts: 1 } }, deps);
  } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
  write(error, true);
  fs.rmSync(filename + ".partial", { force: true });
  console.log(JSON.stringify({ arm, case: c.id, event: "complete", status: version.status ?? "failed", calls: calls.length, durationMs: Date.now() - start }));
}
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < selected.length) {
    const c = selected[next++];
    if (c) await runCase(c);
  }
}));
