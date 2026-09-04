// Exports the offline numeric-replay corpus from the generation-log database.
// Two cohorts:
//  - failed:    failed runs whose validation carries UNEXPECTED_NUMBERS —
//               byte-for-byte the legacy tmp/export-replay-corpus.mts shape
//               (no rewriteSource key), replayed by `replay-numbers`;
//  - published: published runs whose validationRepair stripped numbers
//               (issueCodes contains UNEXPECTED_NUMBERS and hiddenDraft is
//               preserved) — emitted with `rewriteSource: "hiddenDraft"` as
//               the last key, replayed by `replay-stripped-numbers` with the
//               hiddenDraft as rewrite-under-test (outputJson holds the
//               post-strip published rewrite the classifier diffs against).
// Rows are merged sorted by requestedAt. Output is gitignored JSONL; never
// overwrite a frozen corpus file — each window gets its own file. Run with
// GENERATION_LOG_DATABASE_URL set (e.g. via tmp/run-with-prod-db.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..", "..");
loadDotEnv({ path: path.join(repoRoot, ".env"), override: false });

if (!process.env.GENERATION_LOG_DATABASE_URL) {
  throw new Error("GENERATION_LOG_DATABASE_URL must be set for the export");
}
const { logPrisma } = await import("@newsweb/shared/db");

type CorpusCohort = "failed" | "published";

function parseArgs(argv: string[]): {
  from: Date;
  to: Date;
  outPath: string;
  cohorts: Set<CorpusCohort>;
} {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  const fromRaw = options.get("from");
  const toRaw = options.get("to");
  if (!fromRaw || !toRaw) {
    throw new Error(
      "Usage: export-replay-corpus --from YYYY-MM-DD --to YYYY-MM-DD [--out PATH] [--cohorts failed,published]"
    );
  }
  const from = new Date(`${fromRaw}T00:00:00.000Z`);
  const to = new Date(`${toRaw}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("--from/--to must be YYYY-MM-DD dates");
  }
  const outPath = path.resolve(
    repoRoot,
    options.get("out") ??
      path.join("tmp", "editorial-eval", `replay-corpus-${fromRaw}_${toRaw}.jsonl`)
  );
  const cohorts = new Set<CorpusCohort>();
  for (const cohort of (options.get("cohorts") ?? "failed,published").split(",")) {
    const trimmed = cohort.trim();
    if (trimmed !== "failed" && trimmed !== "published") {
      throw new Error(`Unknown cohort: ${trimmed}`);
    }
    cohorts.add(trimmed);
  }
  return { from, to, outPath, cohorts };
}

const hasUnexpectedNumbers = (validation: unknown): boolean => {
  const issues = (validation as { issues?: Array<{ code?: string }> } | null)
    ?.issues;
  return (
    Array.isArray(issues) &&
    issues.some((issue) => issue?.code === "UNEXPECTED_NUMBERS")
  );
};

const hasHiddenDraftNumberRepair = (validation: unknown): boolean => {
  const record = validation as {
    validationRepair?: { issueCodes?: unknown } | null;
    hiddenDraft?: unknown;
  } | null;
  const issueCodes = record?.validationRepair?.issueCodes;
  return (
    Array.isArray(issueCodes) &&
    issueCodes.includes("UNEXPECTED_NUMBERS") &&
    typeof record?.hiddenDraft === "object" &&
    record.hiddenDraft !== null
  );
};

const { from, to, outPath, cohorts } = parseArgs(process.argv.slice(2));
if (fs.existsSync(outPath)) {
  throw new Error(
    `Refusing to overwrite existing corpus file: ${outPath} (frozen corpora are release evidence; pass --out for a new path)`
  );
}

type PoolRow = {
  id: string;
  messageId: number;
  promptVersion: string | null;
  requestedAt: Date;
  reason: string | null;
  validationJson: unknown;
  rewriteSource?: "hiddenDraft";
};

const pool: PoolRow[] = [];
const cohortCounts = new Map<CorpusCohort, { window: number; matched: number }>();

for (const cohort of ["failed", "published"] as const) {
  if (!cohorts.has(cohort)) continue;
  const rows = await logPrisma.generationRun.findMany({
    where: { status: cohort, requestedAt: { gte: from, lte: to }, messageId: { gt: 0 } },
    select: {
      id: true,
      messageId: true,
      promptVersion: true,
      requestedAt: true,
      reason: true,
      validationJson: true
    },
    orderBy: { requestedAt: "asc" }
  });
  const matched = rows.filter((row) =>
    cohort === "failed"
      ? hasUnexpectedNumbers(row.validationJson)
      : hasHiddenDraftNumberRepair(row.validationJson)
  );
  cohortCounts.set(cohort, { window: rows.length, matched: matched.length });
  for (const row of matched) {
    pool.push(
      cohort === "published" ? { ...row, rewriteSource: "hiddenDraft" } : row
    );
  }
}

pool.sort(
  (a, b) =>
    a.requestedAt.getTime() - b.requestedAt.getTime() ||
    a.id.localeCompare(b.id)
);

for (const [cohort, counts] of cohortCounts) {
  console.log(
    `${cohort} rows in window: ${counts.window}; matched: ${counts.matched}`
  );
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const out = fs.createWriteStream(outPath);
let missingPayload = 0;
for (const row of pool) {
  const full = await logPrisma.generationRun.findUnique({
    where: { id: row.id },
    select: { inputJson: true, outputJson: true }
  });
  const input = full?.inputJson as { sourcePayload?: unknown } | null;
  const sourcePayload =
    input && typeof input === "object" ? (input.sourcePayload ?? null) : null;
  if (!sourcePayload) missingPayload += 1;
  out.write(
    JSON.stringify({
      id: row.id,
      messageId: row.messageId,
      promptVersion: row.promptVersion,
      requestedAt: row.requestedAt,
      reason: row.reason,
      sourcePayload,
      outputJson: full?.outputJson ?? null,
      validationJson: row.validationJson,
      // Last key, and only on published rows, so failed rows keep the exact
      // legacy shape (grep -v rewriteSource recovers the failed cohort).
      ...(row.rewriteSource ? { rewriteSource: row.rewriteSource } : {})
    }) + "\n"
  );
}
out.end();
await new Promise<void>((resolve) => out.on("finish", () => resolve()));
console.log(
  `wrote ${pool.length} rows to ${outPath}; rows without sourcePayload: ${missingPayload}`
);
await logPrisma.$disconnect();
