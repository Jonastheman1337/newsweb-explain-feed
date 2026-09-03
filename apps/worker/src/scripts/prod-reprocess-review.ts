// Full-pipeline review on production: queue a manual reprocess for each
// notice (the real worker path: related-notice attach, draft, reference
// repairs, validation, publish as a new version), wait for the runs, dump the
// results and write a before/after review page.
//
//   npm run review:prod -w apps/worker -- 675152 681428 681076
//   npm run review:prod -w apps/worker -- @tmp/editorial-eval/ids.txt --out tmp/editorial-eval/prod-review.html
//   npm run review:prod -w apps/worker -- 675152 --skip-queue   # only dump + render existing versions
//
// Needs SSH access to the production host (same as scripts/deploy-upcloud.sh).
// The admin key never leaves the host: the request is made from inside the
// api container. Each run creates a new published version on the live feed,
// in the notice's own chronological position.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RewriteOutput } from "@newsweb/shared";
import { splitIntoSentences } from "../services/reference-check.js";

const execFileAsync = promisify(execFile);

const HOST = process.env.AUTOWEB_HOST ?? "autoweb@81.27.105.83";
const POLL_INTERVAL_MS = 45_000;
const POLL_TIMEOUT_MS = 25 * 60_000;

type Review = { index: number; sentence: string; grounded: boolean; interpretation: string; source?: string };
type RewriteRow = {
  id: string;
  version: number;
  status: string;
  generatedAt: string;
  promptVersion: string;
  model: string;
  rewriteJson: RewriteOutput | { errorCode: string; message: string; blockedRewrite?: RewriteOutput };
  validationJson: {
    errorCode?: string | null;
    issues?: Array<{ code: string; severity: string; message: string }>;
    referenceCheck?: {
      correctionAttempts?: number;
      blocking?: boolean;
      blockingReason?: string | null;
      priorContextViolationCount?: number;
      finalCoverage?: { sentenceReviews?: Review[]; visibleArticleSentenceCount?: number } | null;
    };
    relatedNotices?: {
      resolved?: Array<{ messageId: number; relation: string; title: string; publishedAt: string; resolvedBy: string; score: number }>;
      unresolved?: Array<{ raw: string; reason: string }>;
    };
  };
};
type NoticeRow = {
  messageId: number;
  title: string;
  issuerName: string;
  issuerSign: string;
  publishedAt: string;
  rewrites: RewriteRow[];
  published: Array<{ id: string; version: number; rewriteJson: RewriteOutput }>;
};

async function ssh(command: string, stdin?: string): Promise<string> {
  const child = execFile(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", HOST, command],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  if (stdin !== undefined) {
    child.stdin?.end(stdin);
  }
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += chunk));
  child.stderr?.on("data", (chunk) => (stderr += chunk));
  const code: number = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    throw new Error(`ssh failed (${code}): ${stderr.trim() || stdout.trim()}`);
  }
  return stdout;
}

function psql(sql: string): Promise<string> {
  return ssh(
    `docker exec -i autoweb-prod-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'`,
    sql
  );
}

async function queueReprocess(messageId: number): Promise<{ version: number; generationRunId: string }> {
  const script =
    `fetch("http://127.0.0.1:4000/admin/reprocess/${messageId}",{method:"POST",headers:{"x-admin-key":process.env.ADMIN_API_KEY}})` +
    `.then(async r=>{const t=await r.text();if(!r.ok){console.error(t);process.exit(1)}console.log(t)})` +
    `.catch(e=>{console.error(String(e));process.exit(1)})`;
  const out = await ssh(`docker exec autoweb-prod-api-1 node -e '${script}'`);
  const parsed = JSON.parse(out.trim()) as { queued: boolean; version: number; generationRunId: string };
  return { version: parsed.version, generationRunId: parsed.generationRunId };
}

async function waitForRuns(targets: Map<number, number>): Promise<void> {
  const ids = [...targets.keys()].join(",");
  const startedAt = Date.now();
  while (true) {
    const out = await psql(
      `select message_id||':'||version||':'||status from rewrites where message_id in (${ids}) and version >= 2 order by message_id, version;`
    );
    const finals = new Set(
      out
        .split("\n")
        .filter(Boolean)
        .filter((line) => /:(published|failed|skipped)$/.test(line))
        .map((line) => line.split(":").slice(0, 2).join(":"))
    );
    let done = 0;
    for (const [messageId, version] of targets) {
      if (finals.has(`${messageId}:${version}`)) done += 1;
    }
    console.log(`[review] ${done}/${targets.size} runs final`);
    if (done >= targets.size) return;
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error("timed out waiting for reprocess runs");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function dumpNotices(ids: number[]): Promise<NoticeRow[]> {
  const sql = `select json_build_object(
  'messageId', s.message_id, 'title', s.title, 'issuerName', s.issuer_name, 'issuerSign', s.issuer_sign,
  'publishedAt', s.published_at,
  'rewrites', (select coalesce(json_agg(json_build_object(
      'id', r.id, 'version', r.version, 'status', r.status, 'generatedAt', r.generated_at,
      'promptVersion', r.prompt_version, 'model', r.model,
      'rewriteJson', r.rewrite_json, 'validationJson', r.validation_json) order by r.version), '[]'::json)
      from rewrites r where r.message_id = s.message_id),
  'published', (select coalesce(json_agg(json_build_object(
      'id', p.id, 'version', p.version, 'rewriteJson', p.rewrite_json) order by p.version), '[]'::json)
      from published_rewrites p where p.message_id = s.message_id)
)::text from source_notices s where s.message_id in (${ids.join(",")}) order by s.published_at;`;
  const out = await psql(sql);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NoticeRow);
}

const esc = (value: unknown) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const osloDate = (iso: string) =>
  new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(iso)
  );
const newsweb = (id: number) => `https://newsweb.oslobors.no/message/${id}`;

function outputOf(rewrite: RewriteRow): RewriteOutput | null {
  const json = rewrite.rewriteJson as { title?: unknown; blockedRewrite?: RewriteOutput };
  if (json && typeof json.title === "string") return json as RewriteOutput;
  if (json?.blockedRewrite) return json.blockedRewrite;
  return null;
}

function renderArticle(output: RewriteOutput | null, reviews: Review[]): string {
  if (!output) return `<p class="none">Ingen tekst.</p>`;
  const byIndex = new Map(reviews.map((review) => [review.index, review]));
  let index = 0;
  const paragraph = (text: string, cls: string) => {
    const html = splitIntoSentences(text)
      .map((sentence) => {
        const review = byIndex.get(index);
        index += 1;
        const classes = ["s"];
        if (review?.source === "prior") classes.push("prior");
        if (review?.source === "both") classes.push("both");
        if (review && !review.grounded) classes.push("unsupported");
        const title =
          review?.source === "prior"
            ? "fra den tidligere meldingen"
            : review?.source === "both"
              ? "i begge meldinger"
              : review && !review.grounded
                ? `udekket: ${review.interpretation}`
                : "";
        return `<span class="${classes.join(" ")}"${title ? ` title="${esc(title)}"` : ""}>${esc(sentence)}</span>`;
      })
      .join(" ");
    return `<p class="${cls}">${html}</p>`;
  };
  return [`<h3>${esc(output.title)}</h3>`, paragraph(output.lead, "lead"), ...output.body.map((p) => paragraph(p, "body"))].join(
    "\n"
  );
}

function signalLine(rewrite: RewriteRow): string {
  const rc = rewrite.validationJson.referenceCheck ?? {};
  const output = outputOf(rewrite);
  const chars = output ? [output.lead, ...output.body].join("\n\n").length : 0;
  const reviews = rc.finalCoverage?.sentenceReviews ?? [];
  const visible = rc.finalCoverage?.visibleArticleSentenceCount ?? reviews.length;
  const priorCount = reviews.filter((r) => r.source === "prior" && r.index < visible).length;
  const violations = rc.priorContextViolationCount ?? 0;
  const repairs = rc.correctionAttempts ?? 0;
  const status =
    rewrite.status === "published"
      ? `<span class="pill ok">publisert</span>`
      : `<span class="pill bad">${esc(rewrite.status)}${rewrite.validationJson.errorCode ? ` · ${esc(rewrite.validationJson.errorCode)}` : ""}</span>`;
  return `<div class="signals">${status}<span class="pill">${chars} tegn</span><span class="pill">${repairs} reparasjon${repairs === 1 ? "" : "er"}</span>${
    priorCount ? `<span class="pill prior">${priorCount} setning${priorCount === 1 ? "" : "er"} fra tidligere melding</span>` : ""
  }${violations ? `<span class="pill bad">${violations} regelbrudd</span>` : ""}</div>`;
}

export function renderReviewPage(rows: NoticeRow[], targets: Map<number, number>, title: string): string {
  const stats = { notices: 0, published: 0, failed: 0, usedPrior: 0, violations: 0, repairs: 0 };
  const blocks: string[] = [];
  for (const row of rows) {
    const targetVersion = targets.get(row.messageId);
    const latest = targetVersion
      ? row.rewrites.find((r) => r.version === targetVersion) ?? null
      : row.rewrites.filter((r) => r.status !== "needs_retry").at(-1) ?? null;
    if (!latest) continue;
    stats.notices += 1;
    const before =
      row.published.filter((p) => p.version < latest.version).sort((a, b) => b.version - a.version)[0]?.rewriteJson ?? null;
    const rc = latest.validationJson.referenceCheck ?? {};
    const reviews = rc.finalCoverage?.sentenceReviews ?? [];
    const visible = rc.finalCoverage?.visibleArticleSentenceCount ?? reviews.length;
    if (latest.status === "published") stats.published += 1;
    else stats.failed += 1;
    if (reviews.some((r) => r.source === "prior" && r.index < visible)) stats.usedPrior += 1;
    stats.violations += rc.priorContextViolationCount ?? 0;
    stats.repairs += rc.correctionAttempts ?? 0;
    const related = latest.validationJson.relatedNotices?.resolved ?? [];
    blocks.push(`
<section class="case" id="n-${row.messageId}">
  <header>
    <p class="eyebrow">${esc(row.issuerSign)} · ${esc(osloDate(row.publishedAt))} · <a href="${newsweb(row.messageId)}" target="_blank" rel="noopener">Newsweb</a></p>
    <h2>${esc(row.title)}</h2>
    ${
      related.length
        ? `<p class="related">${related
            .map(
              (r) =>
                `<a href="${newsweb(r.messageId)}" target="_blank" rel="noopener">${esc(r.title)}</a> <span class="muted">${esc(osloDate(r.publishedAt))}</span>`
            )
            .join("<br>")}</p>`
        : `<p class="related muted">Ingen tidligere melding funnet.</p>`
    }
  </header>
  <div class="pair">
    <article class="arm">
      <p class="armLabel">Før</p>
      ${renderArticle(before, [])}
    </article>
    <article class="arm new">
      <p class="armLabel">Ny versjon ${latest.version}</p>
      ${renderArticle(outputOf(latest), reviews)}
      ${signalLine(latest)}
    </article>
  </div>
</section>`);
  }

  return `<title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#f4f5f7;--surface:#ffffff;--ink:#171d26;--muted:#5b6573;--line:#d9dde3;--accent:#a3570a;--accentSoft:#fbead2;--ok:#1f7a4d;--okSoft:#dff3e7;--bad:#b3261e;--badSoft:#fbe3e1;--both:#3b5fa0}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#13161b;--surface:#1b2027;--ink:#e7e9ec;--muted:#9aa4b1;--line:#2c333d;--accent:#f0a44a;--accentSoft:#3a2a12;--ok:#5fcb8f;--okSoft:#173626;--bad:#ff8a80;--badSoft:#3d1b19;--both:#8fb0f0}}
:root[data-theme="dark"]{--bg:#13161b;--surface:#1b2027;--ink:#e7e9ec;--muted:#9aa4b1;--line:#2c333d;--accent:#f0a44a;--accentSoft:#3a2a12;--ok:#5fcb8f;--okSoft:#173626;--bad:#ff8a80;--badSoft:#3d1b19;--both:#8fb0f0}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:15px;line-height:1.5}
main{max-width:1180px;margin:0 auto;padding:32px 24px 80px}
h1{font-family:"IBM Plex Serif",Georgia,serif;font-weight:600;font-size:28px;margin:0 0 4px;text-wrap:balance}
.sub{color:var(--muted);margin:0 0 28px;font-size:14px}
.legend{display:flex;flex-wrap:wrap;gap:12px 20px;font-size:13px;color:var(--muted);margin:0 0 8px}
.legend .s{color:var(--ink)}
.case{margin:0 0 40px;padding-top:20px;border-top:2px solid var(--line)}
.eyebrow{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--muted);margin:0 0 4px}
.case h2{font-family:"IBM Plex Serif",Georgia,serif;font-weight:600;font-size:18px;margin:0 0 6px;text-wrap:balance}
.related{font-size:13.5px;margin:0 0 14px}
.muted{color:var(--muted)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media (max-width:820px){.pair{grid-template-columns:1fr}}
.arm{background:var(--surface);border:1px solid var(--line);padding:18px 20px 14px;min-width:0}
.arm.new{border-color:var(--accent)}
.armLabel{margin:0 0 10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:500}
.new .armLabel{color:var(--accent)}
.arm h3{font-family:"IBM Plex Serif",Georgia,serif;font-weight:600;font-size:18px;margin:0 0 8px;line-height:1.3;text-wrap:balance}
.lead,.body{font-family:"IBM Plex Serif",Georgia,serif;font-size:15.5px;line-height:1.55;margin:0 0 10px;max-width:62ch}
.lead{font-weight:600}
.s.prior{background:var(--accentSoft);box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:0 2px;border-bottom:2px solid var(--accent)}
.s.both{border-bottom:2px dotted var(--both)}
.s.unsupported{text-decoration:underline wavy var(--bad);text-underline-offset:3px}
.signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}
.pill{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11.5px;padding:2px 8px;border-radius:3px;background:var(--bg);border:1px solid var(--line);color:var(--ink)}
.pill.ok{background:var(--okSoft);color:var(--ok);border-color:transparent}
.pill.bad{background:var(--badSoft);color:var(--bad);border-color:transparent}
.pill.prior{background:var(--accentSoft);color:var(--accent);border-color:transparent}
.none{color:var(--muted);font-style:italic}
a{color:inherit}
</style>
<main>
  <h1>${esc(title)}</h1>
  <p class="sub">${stats.notices} saker kjørt på nytt i produksjon · ${stats.published} publisert, ${stats.failed} feilet · ${stats.usedPrior} bruker den tidligere meldingen · ${stats.violations} regelbrudd · ${stats.repairs} referansereparasjoner totalt</p>
  <div class="legend"><span><span class="s prior">Markert</span> fra den tidligere meldingen</span><span><span class="s both">Prikket</span> i begge</span><span><span class="s unsupported">Bølget</span> udekket etter siste sjekk</span></div>
  ${blocks.join("\n")}
</main>`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  const ids: number[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--skip-queue") {
      options.set("skip-queue", "1");
    } else if (arg.startsWith("--")) {
      options.set(arg.slice(2), args[i + 1] ?? "");
      i += 1;
    } else if (arg.startsWith("@")) {
      const text = await fs.readFile(arg.slice(1), "utf8");
      ids.push(...text.split(/[\s,]+/).filter(Boolean).map(Number));
    } else {
      ids.push(Number(arg));
    }
  }
  const validIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (validIds.length === 0) {
    console.error("Usage: prod-reprocess-review <messageId ...|@file> [--out page.html] [--dump rows.jsonl] [--title ...] [--skip-queue]");
    process.exit(1);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = options.get("out") ?? `tmp/editorial-eval/prod-review-${stamp}.html`;
  const dumpPath = options.get("dump") ?? outPath.replace(/\.html$/i, "") + ".jsonl";
  const title = options.get("title") ?? `${validIds.length} saker gjennom hele løypa`;

  const targets = new Map<number, number>();
  if (!options.has("skip-queue")) {
    for (const messageId of validIds) {
      const queued = await queueReprocess(messageId);
      targets.set(messageId, queued.version);
      console.log(`[review] queued ${messageId} as version ${queued.version} (${queued.generationRunId})`);
    }
    await waitForRuns(targets);
  }

  const rows = await dumpNotices(validIds);
  await fs.mkdir(path.dirname(dumpPath), { recursive: true });
  await fs.writeFile(dumpPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await fs.writeFile(outPath, renderReviewPage(rows, targets, title));
  console.log(`[review] wrote ${outPath} (rows: ${dumpPath})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
