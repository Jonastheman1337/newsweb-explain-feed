import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const dimensions = ["Leselyst", "Vinkel", "Klarspråk", "Fremdrift", "Dybde", "Faktapresisjon"];
const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export function createAssignments(cases, seed) {
  if (!seed || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error("Seed and unique case ids required");
  const assigned = [...cases].sort((a,b) => hash(seed + ":sides:" + a.id).localeCompare(hash(seed + ":sides:" + b.id)));
  const left = new Set(assigned.slice(0, Math.ceil(cases.length / 2)).map(c => c.id));
  return [...cases].sort((a,b) => hash(seed + ":order:" + a.id).localeCompare(hash(seed + ":order:" + b.id)))
    .map(c => ({ caseId: c.id, opaqueId: hash(seed + ":" + hash(c)).slice(0, 16), A: left.has(c.id) ? "candidate" : "control", B: left.has(c.id) ? "control" : "candidate" }));
}
function visible(result) {
  const a = result?.version?.articleJson;
  return {
    state: result ? (result.version?.status === "ready" ? "Ferdig kontrollert" : a ? "Trenger kontroll" : "Kjøringen feilet") : "Ingen ferdig kjøring",
    article: a ? { title: a.title, lead: a.lead, blocks: a.blocks } : null,
    outputHash: hash({ article: a ?? null, state: result?.version?.status ?? "missing" })
  };
}
export function summarizeReviews(mapping, reviews) {
  if (reviews.runId !== mapping.runId || reviews.assignmentHash !== mapping.assignmentHash) throw new Error("Reviews belong to another assignment");
  const expected = new Map(mapping.assignments.map(row => [row.opaqueId, row]));
  if (!Array.isArray(reviews.rows) || new Set(reviews.rows.map(r => r.id)).size !== reviews.rows.length) throw new Error("Duplicate or invalid reviews");
  const wins = { candidate: 0, control: 0, tie: 0, both_bad: 0 };
  const byDimension = Object.fromEntries(dimensions.map(d => [d, { candidate: 0, control: 0, tie: 0, both_bad: 0, unreviewed: 0 }]));
  let reviewed = 0, completeDimensions = 0;
  for (const row of reviews.rows) {
    const assignment = expected.get(row.id);
    if (!assignment || row.outputHashA !== assignment.outputHashA || row.outputHashB !== assignment.outputHashB) throw new Error("Review output mismatch");
    const choices = ["A", "B", "tie", "both_bad", ""];
    if (!choices.includes(row.verdict ?? "")) throw new Error("Invalid verdict");
    if (row.verdict) {
      wins[row.verdict === "A" || row.verdict === "B" ? assignment[row.verdict] : row.verdict]++;
      reviewed++;
    }
    let dimensionCount = 0;
    for (const d of dimensions) {
      const choice = row.dimensions?.[d] ?? "";
      if (!choices.includes(choice)) throw new Error("Invalid dimension choice");
      if (choice) {
        byDimension[d][choice === "A" || choice === "B" ? assignment[choice] : choice]++;
        dimensionCount++;
      } else byDimension[d].unreviewed++;
    }
    if (dimensionCount === dimensions.length) completeDimensions++;
  }
  for (const d of dimensions) byDimension[d].unreviewed += mapping.assignments.length - reviews.rows.length;
  const decided = wins.candidate + wins.control;
  const preference = decided ? wins.candidate / decided : null;
  return {
    runId: mapping.runId, cases: expected.size, reviewed, completeDimensions, wins, byDimension,
    candidatePreference: preference, preferenceThresholdMet: preference !== null && preference >= .65,
    complete: reviewed === expected.size && completeDimensions === expected.size,
    // Human source audit and an explicit release decision are still required.
    releaseDecision: "pending_editorial_and_source_review"
  };
}
function cli() {
  const command = process.argv[2];
  const args = new Map();
  for (let i=3;i<process.argv.length;i+=2) {
    if (!process.argv[i]?.startsWith("--") || !process.argv[i+1] || args.has(process.argv[i])) throw new Error("Expected unique --name value arguments");
    args.set(process.argv[i],process.argv[i+1]);
  }
  const read = name => JSON.parse(fs.readFileSync(args.get(name), "utf8").replace(/^\uFEFF/, ""));
  if (command === "summarize") {
    const summary = summarizeReviews(read("--mapping"), read("--reviews"));
    fs.writeFileSync(args.get("--out"), JSON.stringify(summary,null,2));
    console.log(JSON.stringify(summary,null,2));
    return;
  }
  if (command !== "render") throw new Error("Use render or summarize");
  const corpus = read("--cases");
  if (hash(corpus.cases) !== corpus.casesSha256) throw new Error("Corpus integrity mismatch");
  const dirs = { control: args.get("--control"), candidate: args.get("--candidate") };
  const manifests = Object.fromEntries(Object.entries(dirs).map(([arm,dir]) => [arm,JSON.parse(fs.readFileSync(path.join(dir,"manifest.json"),"utf8"))]));
  for (const [arm,m] of Object.entries(manifests)) if (m.arm !== arm || m.corpusSha !== corpus.casesSha256) throw new Error("Arm/corpus mismatch");
  if (!manifests.control.runnerHash || manifests.control.runnerHash !== manifests.candidate.runnerHash) throw new Error("Runner mismatch");
  if (JSON.stringify(manifests.control.profile) !== JSON.stringify(manifests.candidate.profile)) throw new Error("Model profile mismatch");
  const assignments = createAssignments(corpus.cases,args.get("--seed"));
  const rows = assignments.map(a => {
    const c = corpus.cases.find(c => c.id === a.caseId);
    const sides = {};
    for (const side of ["A","B"]) {
      const arm = a[side], filename = path.join(dirs[arm],c.id+".json");
      const result = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename,"utf8")) : null;
      if (result && (result.fingerprint !== manifests[arm].fingerprint || result.caseHash !== hash(c) || result.status !== "complete")) throw new Error("Result provenance mismatch");
      sides[side] = visible(result);
      a["outputHash"+side] = sides[side].outputHash;
    }
    return { id:a.opaqueId,description:c.description,instruction:c.data.instruction,targetChars:c.data.targetChars,sources:c.data.materials.map(m=>({id:m.sourceId,title:m.title,url:m.url,status:m.status,text:m.text})),previous:c.data.previousArticleJson ? {title:c.data.previousArticleJson.title,lead:c.data.previousArticleJson.lead,blocks:c.data.previousArticleJson.blocks}:null,...sides };
  });
  const assignmentHash = hash(assignments);
  const runId = hash({ assignmentHash, control:manifests.control.fingerprint, candidate:manifests.candidate.fingerprint });
  const mapping = { runId,assignmentHash,manifests,assignments };
  const data = { runId,assignmentHash,dimensions,rows };
  const template = fs.readFileSync(new URL("./sak-voice-review.html",import.meta.url),"utf8");
  const html = template.replace("__REVIEW_DATA__",JSON.stringify(data).replaceAll("<","\\u003c"));
  const target = args.get("--out");
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,html);
  fs.writeFileSync(target+".mapping.json",JSON.stringify(mapping,null,2));
  console.log(JSON.stringify({html:target,cases:rows.length,runId,assignmentHash}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) cli();
