#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function usage() {
  return [
    "Usage: node scripts/analyze-quote-telemetry.mjs ARTIFACT.json [--out PATH]",
    "",
    "Reads a pull-signals artifact (npm run signals:pull) and quantifies where",
    "quotes disappear in the generation pipeline, per prompt_version:",
    "  - how often the source contains a quotable key-person statement",
    "  - whether the final article has a dash quote, guillemets, or only a",
    "    named-person paraphrase",
    "  - whether quote sentences were never generated, survived reference",
    "    repair, or were stripped during repair",
    "  - how often the reference checker marks quote sentences as ungrounded",
    "    compared with other sentences",
    "",
    "Options:",
    "  --out PATH   Write the full JSON summary to PATH in addition to stdout.",
    "  --help       Show this help.",
    "",
    "The artifact must include raw rows (do not pass --no-raw to signals:pull)."
  ].join("\n");
}

// Quote-like text detectors. Keep in sync with
// apps/worker/src/services/rewrite-validation.ts:188-211.
const ATTRIBUTION_VERB_SOURCE =
  "(?:sier|skriver|opplyser|uttaler|mener|peker\\s+på|says?|said|comments?|commented|states?|stated)";
const KEY_PERSON_ROLE_SOURCE =
  "(?:CEO|CFO|chief executive|konsernsjef|toppsjef|finansdirektør|styreleder|primærinnsider|administrerende\\s+direktør)";

const DASH_QUOTE_PATTERN = new RegExp(
  `(?:^|\\n)\\s*–\\s+[\\s\\S]{8,}?\\b${ATTRIBUTION_VERB_SOURCE}\\b`,
  "i"
);
const GUILLEMETS_PATTERN = /«[^»]{8,}»/;
const NAMED_ATTRIBUTION_PATTERNS = [
  new RegExp(
    `${KEY_PERSON_ROLE_SOURCE}[\\s\\S]{0,120}\\b${ATTRIBUTION_VERB_SOURCE}\\b`,
    "i"
  ),
  new RegExp(
    `\\b${ATTRIBUTION_VERB_SOURCE}\\b[\\s\\S]{0,120}${KEY_PERSON_ROLE_SOURCE}`,
    "i"
  )
];

export function classifyQuoteText(text) {
  return {
    dash: DASH_QUOTE_PATTERN.test(text),
    guillemets: GUILLEMETS_PATTERN.test(text),
    attribution: NAMED_ATTRIBUTION_PATTERNS.some((pattern) => pattern.test(text))
  };
}

// "Strict" quote = dash quote or guillemets; a named-person paraphrase alone
// does not count as a quote for the diagnosis.
export function sentenceQuoteKind(sentence) {
  const flags = classifyQuoteText(sentence);
  if (flags.dash || flags.guillemets) return "strict";
  if (flags.attribution) return "attribution";
  return null;
}

function parseJsonField(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.trim() === "null") {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function visibleTextFromOutput(outputJson) {
  if (!outputJson || typeof outputJson !== "object") return null;
  const rewrite =
    typeof outputJson.blockedRewrite === "object" && outputJson.blockedRewrite
      ? outputJson.blockedRewrite
      : outputJson;
  if (typeof rewrite.lead !== "string") return null;
  return [rewrite.title ?? "", rewrite.lead, ...(rewrite.body ?? [])].join("\n");
}

function sentenceReviews(coverage) {
  if (!coverage || !Array.isArray(coverage.sentenceReviews)) return [];
  return coverage.sentenceReviews.filter(
    (item) => item && typeof item.sentence === "string"
  );
}

function emptyBucket() {
  return {
    runs: 0,
    runsWithTelemetry: 0,
    statuses: {},
    opportunities: 0,
    finalState: { dash: 0, guillemets: 0, attribution_only: 0, none: 0 },
    repairPath: {
      never_generated: 0,
      survived: 0,
      stripped_in_repair: 0,
      added_in_repair: 0,
      no_reference_data: 0
    },
    telemetryTextMismatches: 0,
    missingQuoteSourceSpanWarnings: 0,
    // Telemetry-independent counters, available for every prompt version:
    // final visible text per published run, and initial-draft vs final-text
    // quote drift for every run with reference-check coverage.
    publishedRuns: 0,
    publishedWithStrictQuote: 0,
    publishedWithGuillemets: 0,
    publishedWithDashQuote: 0,
    referenceCheckedRuns: 0,
    quoteDrift: {
      never_present: 0,
      survived: 0,
      stripped_in_repair: 0,
      added_in_repair: 0
    },
    checker: {
      quoteSentences: 0,
      quoteSentencesUngrounded: 0,
      attributionSentences: 0,
      attributionSentencesUngrounded: 0,
      otherSentences: 0,
      otherSentencesUngrounded: 0
    }
  };
}

function rate(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function bucketRates(bucket) {
  return {
    publishedStrictQuoteRate: rate(
      bucket.publishedWithStrictQuote,
      bucket.publishedRuns
    ),
    strippedShareOfReferenceCheckedRuns: rate(
      bucket.quoteDrift.stripped_in_repair,
      bucket.referenceCheckedRuns
    ),
    opportunityRate: rate(bucket.opportunities, bucket.runsWithTelemetry),
    finalQuoteRateGivenOpportunity: rate(
      bucket.finalState.dash + bucket.finalState.guillemets,
      bucket.opportunities
    ),
    finalNoneRateGivenOpportunity: rate(bucket.finalState.none, bucket.opportunities),
    strippedShareOfOpportunities: rate(
      bucket.repairPath.stripped_in_repair,
      bucket.opportunities
    ),
    neverGeneratedShareOfOpportunities: rate(
      bucket.repairPath.never_generated,
      bucket.opportunities
    ),
    quoteSentenceUngroundedRate: rate(
      bucket.checker.quoteSentencesUngrounded,
      bucket.checker.quoteSentences
    ),
    attributionSentenceUngroundedRate: rate(
      bucket.checker.attributionSentencesUngrounded,
      bucket.checker.attributionSentences
    ),
    otherSentenceUngroundedRate: rate(
      bucket.checker.otherSentencesUngrounded,
      bucket.checker.otherSentences
    )
  };
}

export function analyzeQuoteTelemetry(artifact) {
  const generations = artifact?.data?.generations;
  if (!Array.isArray(generations)) {
    throw new Error(
      "Artifact has no data.generations rows. Re-run signals:pull without --no-raw."
    );
  }

  const overall = emptyBucket();
  const byPromptVersion = new Map();
  const samples = {
    stripped_in_repair: [],
    never_generated: [],
    ungrounded_quote_sentences: []
  };

  for (const row of generations) {
    const validation = parseJsonField(row.validation_json);
    const telemetry = validation?.quoteTelemetry;
    const buckets = [overall];
    const versionKey = row.prompt_version || "(blank)";
    if (!byPromptVersion.has(versionKey)) {
      byPromptVersion.set(versionKey, emptyBucket());
    }
    buckets.push(byPromptVersion.get(versionKey));

    for (const bucket of buckets) {
      bucket.runs += 1;
      const status = row.status || "(blank)";
      bucket.statuses[status] = (bucket.statuses[status] ?? 0) + 1;
    }
    const visibleText = visibleTextFromOutput(parseJsonField(row.output_json));
    const textFlags = visibleText ? classifyQuoteText(visibleText) : null;
    if (textFlags && row.status === "published") {
      for (const bucket of buckets) {
        bucket.publishedRuns += 1;
        if (textFlags.dash) bucket.publishedWithDashQuote += 1;
        if (textFlags.guillemets) bucket.publishedWithGuillemets += 1;
        if (textFlags.dash || textFlags.guillemets) {
          bucket.publishedWithStrictQuote += 1;
        }
      }
    }

    // Checker behavior and initial-vs-final quote drift are measured on every
    // run with reference data (all prompt versions), not just runs with quote
    // telemetry, so the sample stays large and the baseline rate stable.
    const referenceCheck = validation?.referenceCheck;
    const initialReviews = sentenceReviews(referenceCheck?.initialCoverage);
    for (const review of initialReviews) {
      const kind = sentenceQuoteKind(review.sentence);
      const key =
        kind === "strict"
          ? "quoteSentences"
          : kind === "attribution"
            ? "attributionSentences"
            : "otherSentences";
      for (const bucket of buckets) {
        bucket.checker[key] += 1;
        if (review.grounded === false) bucket.checker[`${key}Ungrounded`] += 1;
      }
      if (kind === "strict" && review.grounded === false) {
        if (samples.ungrounded_quote_sentences.length < 10) {
          samples.ungrounded_quote_sentences.push({
            message_id: row.message_id,
            requested_at: row.requested_at,
            prompt_version: versionKey,
            sentence: review.sentence,
            interpretation: review.interpretation,
            sourceEvidence: review.sourceEvidence
          });
        }
      }
    }

    if (initialReviews.length > 0 && textFlags) {
      const initialStrict = initialReviews.some(
        (review) => sentenceQuoteKind(review.sentence) === "strict"
      );
      const finalStrict = textFlags.dash || textFlags.guillemets;
      const driftKey =
        initialStrict && finalStrict
          ? "survived"
          : initialStrict
            ? "stripped_in_repair"
            : finalStrict
              ? "added_in_repair"
              : "never_present";
      for (const bucket of buckets) {
        bucket.referenceCheckedRuns += 1;
        bucket.quoteDrift[driftKey] += 1;
      }
      if (driftKey === "stripped_in_repair" && samples.stripped_in_repair.length < 10) {
        samples.stripped_in_repair.push({
          message_id: row.message_id,
          requested_at: row.requested_at,
          prompt_version: versionKey,
          status: row.status,
          correction_attempts: referenceCheck?.correctionAttempts ?? null
        });
      }
    }

    if (!telemetry) continue;
    for (const bucket of buckets) bucket.runsWithTelemetry += 1;

    const issues = Array.isArray(validation.issues) ? validation.issues : [];
    if (issues.some((issue) => issue?.code === "MISSING_QUOTE_SOURCE_SPAN")) {
      for (const bucket of buckets) bucket.missingQuoteSourceSpanWarnings += 1;
    }

    if (
      textFlags &&
      (textFlags.dash !== Boolean(telemetry.draftContainsStandaloneDashQuote) ||
        textFlags.guillemets !== Boolean(telemetry.draftContainsInlineGuillemets))
    ) {
      for (const bucket of buckets) bucket.telemetryTextMismatches += 1;
    }

    if (!telemetry.sourceContainsNamedQuoteLikePattern) continue;
    for (const bucket of buckets) bucket.opportunities += 1;

    const finalDash = textFlags
      ? textFlags.dash
      : Boolean(telemetry.draftContainsStandaloneDashQuote);
    const finalGuillemets = textFlags
      ? textFlags.guillemets
      : Boolean(telemetry.draftContainsInlineGuillemets);
    const finalAttribution = textFlags
      ? textFlags.attribution
      : Boolean(telemetry.draftContainsNamedPersonAttribution);
    const finalStateKey = finalDash
      ? "dash"
      : finalGuillemets
        ? "guillemets"
        : finalAttribution
          ? "attribution_only"
          : "none";
    for (const bucket of buckets) bucket.finalState[finalStateKey] += 1;

    let repairPathKey;
    if (initialReviews.length === 0) {
      repairPathKey = "no_reference_data";
    } else {
      const initialStrict = initialReviews.some(
        (review) => sentenceQuoteKind(review.sentence) === "strict"
      );
      const finalStrict = finalDash || finalGuillemets;
      if (initialStrict && finalStrict) repairPathKey = "survived";
      else if (initialStrict && !finalStrict) repairPathKey = "stripped_in_repair";
      else if (!initialStrict && finalStrict) repairPathKey = "added_in_repair";
      else repairPathKey = "never_generated";
    }
    for (const bucket of buckets) bucket.repairPath[repairPathKey] += 1;

    if (repairPathKey === "never_generated" && samples.never_generated.length < 10) {
      samples.never_generated.push({
        message_id: row.message_id,
        requested_at: row.requested_at,
        prompt_version: versionKey,
        status: row.status,
        correction_attempts: referenceCheck?.correctionAttempts ?? null
      });
    }
  }

  const versions = Object.fromEntries(
    [...byPromptVersion.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([version, bucket]) => [version, { ...bucket, rates: bucketRates(bucket) }])
  );

  return {
    overall: { ...overall, rates: bucketRates(overall) },
    byPromptVersion: versions,
    samples
  };
}

function formatBucketLine(name, bucket) {
  const r = bucket.rates;
  return [
    `${name}`,
    `  runs ${bucket.runs}, published ${bucket.publishedRuns}, published with real quote ${bucket.publishedWithStrictQuote} (${r.publishedStrictQuoteRate ?? "-"}%; dash ${bucket.publishedWithDashQuote}, guillemets ${bucket.publishedWithGuillemets})`,
    `  quote drift across reference repair (${bucket.referenceCheckedRuns} runs): never_present ${bucket.quoteDrift.never_present}, survived ${bucket.quoteDrift.survived}, stripped_in_repair ${bucket.quoteDrift.stripped_in_repair} (${r.strippedShareOfReferenceCheckedRuns ?? "-"}%), added_in_repair ${bucket.quoteDrift.added_in_repair}`,
    `  runs with quote telemetry ${bucket.runsWithTelemetry}, quote opportunities ${bucket.opportunities} (${r.opportunityRate ?? "-"}%)`,
    `  final state given opportunity: dash ${bucket.finalState.dash}, guillemets ${bucket.finalState.guillemets}, attribution-only ${bucket.finalState.attribution_only}, none ${bucket.finalState.none}`,
    `  real quote in final text: ${r.finalQuoteRateGivenOpportunity ?? "-"}% of opportunities`,
    `  repair path: never_generated ${bucket.repairPath.never_generated}, survived ${bucket.repairPath.survived}, stripped_in_repair ${bucket.repairPath.stripped_in_repair}, added_in_repair ${bucket.repairPath.added_in_repair}, no_reference_data ${bucket.repairPath.no_reference_data}`,
    `  checker ungrounded rate: quote sentences ${r.quoteSentenceUngroundedRate ?? "-"}% (${bucket.checker.quoteSentencesUngrounded}/${bucket.checker.quoteSentences}), attribution ${r.attributionSentenceUngroundedRate ?? "-"}% (${bucket.checker.attributionSentencesUngrounded}/${bucket.checker.attributionSentences}), other ${r.otherSentenceUngroundedRate ?? "-"}% (${bucket.checker.otherSentencesUngrounded}/${bucket.checker.otherSentences})`,
    `  MISSING_QUOTE_SOURCE_SPAN warnings: ${bucket.missingQuoteSourceSpanWarnings}, telemetry/text mismatches: ${bucket.telemetryTextMismatches}`
  ].join("\n");
}

export function formatSummary(summary) {
  const lines = [formatBucketLine("OVERALL", summary.overall)];
  for (const [version, bucket] of Object.entries(summary.byPromptVersion)) {
    lines.push("", formatBucketLine(`prompt_version ${version}`, bucket));
  }
  lines.push(
    "",
    `samples: stripped_in_repair ${summary.samples.stripped_in_repair.length}, never_generated ${summary.samples.never_generated.length}, ungrounded_quote_sentences ${summary.samples.ungrounded_quote_sentences.length} (full lists in JSON output)`
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { positionals: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--out") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --out");
      args.out = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    args.positionals.push(arg);
  }
  if (args.help) return args;
  if (args.positionals.length !== 1) {
    throw new Error("Exactly one artifact path is required");
  }
  args.artifactPath = args.positionals[0];
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message ?? error));
    console.error("");
    console.error(usage());
    process.exit(1);
  }
  if (args.help) {
    console.log(usage());
    return;
  }

  const artifactPath = resolve(process.cwd(), args.artifactPath);
  if (!existsSync(artifactPath)) {
    console.error(`Artifact not found: ${artifactPath}`);
    process.exit(1);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const summary = analyzeQuoteTelemetry(artifact);
  console.log(formatSummary(summary));

  if (args.out) {
    const outPath = resolve(process.cwd(), args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`\nFull summary written to ${outPath}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
