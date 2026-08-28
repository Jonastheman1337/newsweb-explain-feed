import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { z } from "zod";

const sentenceBoundaryRegex = /(?<=[.!?])\s+/;
const protectedPeriod = "<NEWSWEB_PERIOD>";
const monthNamePattern =
  "jan(?:uar)?|feb(?:ruar)?|mars|apr(?:il)?|mai|jun(?:i)?|jul(?:i)?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?|january|february|march|april|may|june|july|august|september|october|november|december";
const dateWithMonthRegex = new RegExp(
  `\\b(\\d{1,2})\\.\\s+(${monthNamePattern})\\b`,
  "gi"
);
const abbreviationRegex =
  /\b(ca|cirka|kl|nr|mill|mrd|bln|bn|dr|prof|st|vs)\.\s+/gi;

export const referenceCheckSentenceSchema = z.object({
  index: z.number().int().min(0),
  sentence: z.string().min(1).max(700),
  grounded: z.boolean(),
  interpretation: z.string().min(1).max(700),
  sourceEvidence: z.string().max(700)
});

export const referenceCheckResultSchema = z.object({
  sentences: z.array(referenceCheckSentenceSchema).min(1).max(64)
});

export type ReferenceCheckResult = z.infer<typeof referenceCheckResultSchema>;

export type ReferenceCoverageItem = {
  index: number;
  sentence: string;
  grounded: boolean;
  interpretation: string;
  sourceEvidence: string;
};

export type ReferenceCoverageReport = {
  totalSentences: number;
  visibleArticleSentenceCount: number;
  groundedSentences: number;
  coveragePercent: number;
  items: ReferenceCoverageItem[];
  unsupportedSentences: ReferenceCoverageItem[];
};

export type ReferenceCheckGateResult = {
  blocking: boolean;
  reason: string | null;
  highRiskUnsupportedSentences: ReferenceCoverageItem[];
};

export type ReferenceCheckPrompt = {
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
  draftSentences: string[];
  visibleDraftSentences: string[];
};

const HIGH_RISK_UNSUPPORTED_PATTERNS = [
  /\d/,
  /\b(?:resultat|inntekt|inntekter|omsetning|driftsresultat|ebit|ebitda|utbytte)\b/i,
  /\b(?:kroner|dollar|euro|million|millioner|milliard|milliarder|prosent)\b/i,
  /\b(?:kontrakt|avtale|oppkjøp|oppkjop|emisjon|fusjon|transaksjon|salg|kjøp|kjop)\b/i,
  /\b(?:gjeld|lån|lan|obligasjon|forfall|vilkår|vilkar|guiding|utsikter)\b/i,
  /\b(?:styrker|forbedrer|sikrer|reduserer|øker|oker|bidrar|kan gi|kan bidra)\b/i
];

const TRADE_ARITHMETIC_CONTEXT_PATTERNS = [
  /\b(?:aksje|aksjer|shares?)\b/i,
  /\b(?:kurs|snittpris|average price|price per share|per aksje)\b/i,
  /\b(?:kjøpt|kjop|kjøp|kjøper|purchased|acquired|solgt|sold)\b/i
];

const MONEY_CONTEXT_PATTERNS = [
  /\b(?:nok|kroner|kr|usd|dollars?|eur|euros?|gbp|pund|pounds?)\b/i
];

export const referenceCheckJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sentences: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer", minimum: 0 },
          sentence: { type: "string", minLength: 1, maxLength: 700 },
          grounded: { type: "boolean" },
          interpretation: { type: "string", minLength: 1, maxLength: 700 },
          sourceEvidence: { type: "string", maxLength: 700 }
        },
        required: [
          "index",
          "sentence",
          "grounded",
          "interpretation",
          "sourceEvidence"
        ]
      }
    }
  },
  required: ["sentences"]
} as const;

function normalizeSentence(sentence: string): string {
  return sentence.replace(/\s+/g, " ").trim();
}

function protectSentenceInternalPeriods(text: string): string {
  return text
    .replace(dateWithMonthRegex, (_match, day: string, month: string) => {
      return `${day}${protectedPeriod} ${month}`;
    })
    .replace(abbreviationRegex, (_match, abbreviation: string) => {
      return `${abbreviation}${protectedPeriod} `;
    });
}

function restoreProtectedPeriods(text: string): string {
  return text.replaceAll(protectedPeriod, ".");
}

export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const chunks = protectSentenceInternalPeriods(trimmed).split(sentenceBoundaryRegex);
  return chunks
    .map((chunk) => normalizeSentence(restoreProtectedPeriods(chunk)))
    .filter((chunk) => chunk.length > 0);
}

function parseLocalizedNumber(raw: string): number | null {
  let normalized = raw.replace(/\s/g, "");
  const negative = normalized.startsWith("-");
  if (negative) {
    normalized = normalized.slice(1);
  }

  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  } else if (normalized.includes(".")) {
    const parts = normalized.split(".");
    const last = parts[parts.length - 1] ?? "";
    if (parts.length > 2 || last.length === 3) {
      normalized = parts.join("");
    }
  }

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return null;
  }
  return negative ? -value : value;
}

function extractNumbers(text: string): number[] {
  const matches = text.match(
    /-?\d{1,3}(?:[ .]\d{3})*(?:[,.]\d+)?|-?\d+(?:[,.]\d+)?/g
  );
  return (matches ?? [])
    .map((match) => parseLocalizedNumber(match))
    .filter((value): value is number => value != null);
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function roughlyEqual(left: number, right: number): boolean {
  const tolerance = Math.max(1, Math.abs(right) * 0.002);
  return Math.abs(left - right) <= tolerance;
}

function isSimpleTradeArithmeticClaim(item: ReferenceCoverageItem): boolean {
  const sentence = item.sentence;
  const evidence = item.sourceEvidence;
  if (!evidence) {
    return false;
  }

  const combined = `${sentence}\n${evidence}`;
  if (
    !hasAnyPattern(combined, TRADE_ARITHMETIC_CONTEXT_PATTERNS) ||
    !hasAnyPattern(combined, MONEY_CONTEXT_PATTERNS)
  ) {
    return false;
  }

  const sentenceNumbers = extractNumbers(sentence).filter((value) => value >= 1000);
  const evidenceNumbers = extractNumbers(evidence).filter((value) => value > 0);
  for (const target of sentenceNumbers) {
    for (let leftIndex = 0; leftIndex < evidenceNumbers.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < evidenceNumbers.length;
        rightIndex += 1
      ) {
        const left = evidenceNumbers[leftIndex] ?? 0;
        const right = evidenceNumbers[rightIndex] ?? 0;
        const larger = Math.max(left, right);
        const smaller = Math.min(left, right);
        if (larger < 100 || smaller <= 0 || smaller > 10_000) {
          continue;
        }
        if (roughlyEqual(larger * smaller, target)) {
          return true;
        }
      }
    }
  }

  return false;
}

export function collectVisibleDraftSentences(rewrite: RewriteOutput): string[] {
  const sections = [rewrite.lead, ...rewrite.body];
  return sections.flatMap(splitIntoSentences);
}

export function collectDraftSentences(rewrite: RewriteOutput): string[] {
  return [
    ...collectVisibleDraftSentences(rewrite),
    ...splitIntoSentences(rewrite.company_sentence)
  ];
}

export function emptyReferenceCoverageReport(): ReferenceCoverageReport {
  return {
    totalSentences: 0,
    visibleArticleSentenceCount: 0,
    groundedSentences: 0,
    coveragePercent: 100,
    items: [],
    unsupportedSentences: []
  };
}

export function buildReferenceCheckPrompt(
  payload: PromptPayload,
  draftRewrite: RewriteOutput
): ReferenceCheckPrompt {
  const visibleDraftSentences = collectVisibleDraftSentences(draftRewrite);
  const draftSentences = collectDraftSentences(draftRewrite);
  const referenceText = [
    payload.bodyText || "ikke oppgitt",
    payload.pdfSupplementText ?? "",
    ...(payload.supplementalMaterials ?? []).map((material) =>
      [
        `[${material.sourceId}] ${material.title}`,
        material.url ?? "",
        material.text
      ].join("\n")
    )
  ].filter((part) => part.trim()).join("\n\n");
  const systemPrompt =
    "Du er en streng referansesjekker som kun vurderer dekning mot oppgitt referansetekst.";
  const developerPrompt = [
    "Vurder hver setning i utkastet separat.",
    "Sett grounded=true kun hvis setningen har eksplisitt dekning i referanseteksten.",
    "En naturlig norsk oversettelse eller gjengivelse av en formulering som står på engelsk i referanseteksten, regnes som eksplisitt dekning når mening, styrkegrad, forbehold og avsender er uendret. Dette gjelder også sitater med sitatstrek eller «...».",
    "At utkastet omtaler kilden som børsmelding eller melding, er kildeattribusjon og skal ikke gi grounded=false.",
    "Enkle regnestykker er dekket hvis alle inputtallene finnes eksplisitt i referanseteksten, for eksempel antall aksjer multiplisert med pris per aksje.",
    "Ikke bruk bakgrunnskunnskap utenfor referanseteksten.",
    "Hvis en setning inneholder subjektive vurderinger eller verdisprak (f.eks. 'milepael', 'styrker posisjon', 'betydelig') uten tydelig attribusjon til kilden/selskapet, skal grounded settes til false.",
    "Paatander om effekt, betydning eller kommersiell verdi ma enten ha direkte dekning i kilden og attribusjon, eller markeres som ikke dekket.",
    "interpretation skal kort forklare hvorfor setningen er dekket eller ikke.",
    "sourceEvidence skal inneholde et kort tekstutdrag fra referansen; tom streng hvis ingenting dekker setningen."
  ].join("\n");

  const userPrompt = [
    "REFERANSETEKST:",
    "<<<",
    referenceText,
    ">>>",
    "",
    "SETNINGER SOM SKAL SJEKKES (indeks + tekst):",
    JSON.stringify(
      draftSentences.map((sentence, index) => ({
        index,
        sentence
      }))
    )
  ].join("\n");

  return {
    systemPrompt,
    developerPrompt,
    userPrompt,
    draftSentences,
    visibleDraftSentences
  };
}

export function buildCoverageReport(
  draftSentences: string[],
  raw: ReferenceCheckResult,
  options?: { visibleArticleSentenceCount?: number }
): ReferenceCoverageReport {
  const byIndex = new Map(raw.sentences.map((item) => [item.index, item]));

  const items = draftSentences.map((sentence, index) => {
    const source = byIndex.get(index);
    if (!source) {
      return {
        index,
        sentence,
        grounded: false,
        interpretation: "Ingen referansesjekk ble returnert for setningen.",
        sourceEvidence: ""
      };
    }

    return {
      index,
      sentence,
      grounded: source.grounded,
      interpretation: source.interpretation.trim(),
      sourceEvidence: source.sourceEvidence.trim()
    };
  });

  const groundedSentences = items.filter((item) => item.grounded).length;
  const totalSentences = items.length;
  const coveragePercent =
    totalSentences === 0
      ? 100
      : Math.round((groundedSentences / totalSentences) * 100);
  const unsupportedSentences = items.filter((item) => !item.grounded);

  return {
    totalSentences,
    visibleArticleSentenceCount:
      options?.visibleArticleSentenceCount ?? totalSentences,
    groundedSentences,
    coveragePercent,
    items,
    unsupportedSentences
  };
}

export function assessReferenceCheckGate(
  report: ReferenceCoverageReport | null
): ReferenceCheckGateResult {
  if (!report || report.unsupportedSentences.length === 0) {
    return {
      blocking: false,
      reason: null,
      highRiskUnsupportedSentences: []
    };
  }

  const highRiskUnsupportedSentences = report.unsupportedSentences.filter(
    (item) =>
      !isSimpleTradeArithmeticClaim(item) &&
      HIGH_RISK_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(item.sentence))
  );

  if (highRiskUnsupportedSentences.length > 0) {
    return {
      blocking: true,
      reason: "Reference check found unsupported high-risk factual claims.",
      highRiskUnsupportedSentences
    };
  }

  if (
    report.visibleArticleSentenceCount > 0 &&
    report.visibleArticleSentenceCount <= 3
  ) {
    const unsupportedVisibleSentences = report.unsupportedSentences.filter(
      (item) =>
        item.index < report.visibleArticleSentenceCount &&
        !isSimpleTradeArithmeticClaim(item)
    );
    if (unsupportedVisibleSentences.length > 0) {
      return {
        blocking: true,
        reason:
          "Reference check found unsupported visible sentence in short article.",
        highRiskUnsupportedSentences: unsupportedVisibleSentences
      };
    }
  }

  if (report.coveragePercent < 75 && report.unsupportedSentences.length >= 2) {
    return {
      blocking: true,
      reason: "Reference check coverage is below 75 percent after correction.",
      highRiskUnsupportedSentences
    };
  }

  return {
    blocking: false,
    reason: null,
    highRiskUnsupportedSentences
  };
}

export function buildCorrectionInstruction(
  report: ReferenceCoverageReport,
  options: { attempt?: number; maxAttempts?: number } = {}
): string | null {
  if (report.unsupportedSentences.length === 0) {
    return null;
  }

  const unsupportedList = report.unsupportedSentences.map((item) => {
    const evidence = item.sourceEvidence || "Ingen dekkende tekst funnet i kilden.";
    return [
      `Setning ${item.index + 1}: ${item.sentence}`,
      `Hvorfor mangler dekning: ${item.interpretation}`,
      `Hva som finnes i kilden: ${evidence}`
    ].join("\n");
  });

  const attempt =
    options.attempt && options.maxAttempts
      ? `Referansereparasjon ${options.attempt} av ${options.maxAttempts}.`
      : "Referansereparasjon.";
  const isFinalAttempt = Boolean(
    options.attempt && options.maxAttempts && options.attempt >= options.maxAttempts
  );

  return [
    attempt,
    "Lag et nytt korrigert utkast basert på samme kildetekst.",
    "Reparasjonsinstruksjonen kan ikke overstyre kildekravet, JSON-skjemaet, lengdegrensen eller forbudet mot kurskommentar/investeringslogikk.",
    "Referansesjekkerens tilbakemelding under er fasit for hva som mangler dekning.",
    "Setninger som ikke er listet under, er dekket — behold dem uendret.",
    "Dette gjelder særlig sitater: sitatstrek-avsnitt, «...»-formuleringer og personattribuerte parafraser som ikke er listet under, skal beholdes ordrett i det korrigerte utkastet.",
    "Alle setninger i lead, body og company_sentence må ha tydelig dekning i kilden.",
    "For hver setning uten dekning: slett faktaen helt, eller omskriv den kun med tekst/fakta som finnes i feltet 'Hva som finnes i kilden'.",
    "Ikke bytt til en nær synonym formulering hvis dekningen fortsatt er indirekte.",
    "Ikke forklar generelle begreper, bransjer eller konsekvenser med mindre dette står eksplisitt i kilden.",
    "Hvis company_sentence er vanskelig å dekke nøyaktig, gjør den kortere eller mer generell, eller fjern den hvis skjemaet tillater det.",
    "Ikke legg til nye fakta.",
    ...(isFinalAttempt
      ? [
          "Dette er siste reparasjonsforsøk: stryk udekkede påstander i stedet for å omformulere dem. Sitater og personuttalelser som har dekning i kilden, skal beholdes."
        ]
      : []),
    "",
    "Setninger uten dekning i forrige utkast:",
    unsupportedList.join("\n\n")
  ].join("\n");
}

// P4 checker outcome model. The legacy path collapses every checker failure
// into one string and evaluates the gate on `null`, which reads as a clean
// pass — the fail-open that published runs with unsupported references. The
// outcome model classifies failures, accumulates them per repair pass, and
// always evaluates the gate on the last successfully completed coverage
// result, so gate evidence is never erased by a later checker error.

export type ReferenceCheckerErrorKind =
  | "checker_transport"
  | "checker_empty_output"
  | "checker_parse"
  | "checker_schema"
  | "repair_rewrite_failed"
  | "unknown";

export type ReferenceCheckerErrorEntry = {
  // 1-based repair-pass number within the generation run, across stages.
  stage: number;
  kind: ReferenceCheckerErrorKind;
  message: string;
  // Checker-kind failures only: true when a successful correction rewrite
  // preceded this failure in the same repair call, meaning the last
  // successful coverage describes a draft that has since been repaired.
  afterCorrection?: boolean;
};

export type ReferenceCheckOutcomeState =
  | "pass"
  | "repaired_pass"
  | "residual_unsupported"
  | "unavailable_error"
  | "malformed_result";

export type ReferenceCheckOutcome = {
  state: ReferenceCheckOutcomeState;
  evaluatedCoverage: "final" | "initial" | "none";
  degraded: boolean;
  // True when the evaluated coverage predates a successful repair (the
  // verifying check errored): the gate verdict describes a superseded draft,
  // so enforcement must fall back to retry rather than block on it.
  evidenceStale: boolean;
  checkerErrors: ReferenceCheckerErrorEntry[];
  gate: ReferenceCheckGateResult;
  correctionAttempts: number;
  wouldBlock: boolean;
  wouldRetry: boolean;
};

export function classifyCheckerErrorKind(
  error: unknown
): ReferenceCheckerErrorKind {
  if (error instanceof z.ZodError) {
    return "checker_schema";
  }
  if (error instanceof SyntaxError) {
    return "checker_parse";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    /returned no output_text|response incomplete \(max_output_tokens\)/.test(
      message
    )
  ) {
    return "checker_empty_output";
  }
  if (/OpenAI request failed/.test(message)) {
    return "checker_transport";
  }
  return "unknown";
}

// Message-only classification for stored legacy `checkerError` strings, used
// by fixture replay. The embedded schema name recovers the phase: repair
// rewrites fail "for rewrite_output", checker calls "for
// reference_check_result". Bare JSON parse messages carry no schema name and
// can only come from the checker-content parse.
export function classifyLegacyCheckerErrorMessage(message: string): {
  kind: ReferenceCheckerErrorKind;
  phase: "checker" | "repair_rewrite" | "unknown";
} {
  // Schema-name branches first: a transport failure whose diagnostics embed
  // JSON-parse wording (gateway HTML -> "Unexpected token <") must classify
  // by its schema name, not the embedded parse text.
  if (/\bfor rewrite_output\b/.test(message)) {
    return { kind: "repair_rewrite_failed", phase: "repair_rewrite" };
  }
  if (/\bfor reference_check_result\b/.test(message)) {
    if (
      /returned no output_text|response incomplete \(max_output_tokens\)/.test(
        message
      )
    ) {
      return { kind: "checker_empty_output", phase: "checker" };
    }
    if (/OpenAI request failed/.test(message)) {
      return { kind: "checker_transport", phase: "checker" };
    }
    return { kind: "unknown", phase: "checker" };
  }
  // Bare JSON-parse messages carry no schema name; the phase cannot be
  // proven from the string alone (the rewrite calls also JSON.parse bare).
  if (
    /in JSON at position|Unexpected end of JSON input|Unexpected token/.test(
      message
    )
  ) {
    return { kind: "checker_parse", phase: "unknown" };
  }
  return { kind: "unknown", phase: "unknown" };
}

export function resolveReferenceCheckOutcome(input: {
  checkerErrors: ReferenceCheckerErrorEntry[];
  initialCoverage: ReferenceCoverageReport | null;
  finalCoverage: ReferenceCoverageReport | null;
  correctionAttempts: number;
  // Total successful checks in the run (repairHistory length). Used to tell
  // whether the last checker failure happened after the last success — a
  // later successful check refreshes the evidence.
  completedCheckCount?: number;
}): ReferenceCheckOutcome {
  const evaluated = input.finalCoverage ?? input.initialCoverage;
  const evaluatedCoverage: ReferenceCheckOutcome["evaluatedCoverage"] =
    input.finalCoverage ? "final" : input.initialCoverage ? "initial" : "none";
  const degraded = input.checkerErrors.length > 0;
  const gate = assessReferenceCheckGate(evaluated);
  // A repair-rewrite failure cannot be the reason coverage is missing or
  // stale (a checker success always precedes a repair call, and a failed
  // repair leaves the checked draft unchanged), so both classifications key
  // off the last checker-stage failure.
  const lastCheckerFailure = [...input.checkerErrors]
    .reverse()
    .find((entry) => entry.kind !== "repair_rewrite_failed");
  const evidenceStale =
    evaluated != null &&
    lastCheckerFailure?.afterCorrection === true &&
    (input.completedCheckCount == null ||
      lastCheckerFailure.stage > input.completedCheckCount);

  let state: ReferenceCheckOutcomeState;
  if (evaluated) {
    state = gate.blocking
      ? "residual_unsupported"
      : input.correctionAttempts > 0
        ? "repaired_pass"
        : "pass";
  } else {
    state =
      lastCheckerFailure?.kind === "checker_parse" ||
      lastCheckerFailure?.kind === "checker_schema"
        ? "malformed_result"
        : "unavailable_error";
  }

  return {
    state,
    evaluatedCoverage,
    degraded,
    evidenceStale,
    checkerErrors: input.checkerErrors,
    gate,
    correctionAttempts: input.correctionAttempts,
    // Stale blocking evidence describes a draft a repair already replaced:
    // never a block signal, but grounds for a retry (current coverage is
    // unknown).
    wouldBlock: gate.blocking && !evidenceStale,
    wouldRetry:
      degraded &&
      (evaluatedCoverage === "none" || (evidenceStale && gate.blocking))
  };
}

/**
 * True only when the current draft has usable source-coverage evidence and
 * the reference gate found no unsupported high-risk visible claim. Numeric
 * publication policy uses this to adjudicate conservative token-matcher
 * misses; unavailable or stale checks never qualify.
 */
export function hasFreshPassingReferenceCoverage(
  outcome: ReferenceCheckOutcome
): boolean {
  return (
    outcome.evaluatedCoverage !== "none" &&
    !outcome.evidenceStale &&
    !outcome.gate.blocking
  );
}

export type ReferenceCheckEnforcementConfig = {
  // Degraded run with evaluated coverage: enforce the coverage gate instead
  // of the legacy vacuous pass.
  blockOnResidualUnsupported: boolean;
  // Degraded run with no valid coverage at all: force status needs_retry so
  // the next attempt re-runs the checker instead of publishing unchecked.
  retryOnUnavailable: boolean;
};

// The production default. CI safety gates replay the outcome functions bare,
// so this constant — not env — is what the release flip changes; the
// REFERENCE_CHECK_ENFORCEMENT env is the emergency kill-switch only.
// Promoted 2026-08-18 (owner decision): degraded runs with blocking coverage
// evidence block, and checker-unavailable runs retry, instead of the legacy
// fail-open. Evidence: the four adjudicated checker_error_published fixtures
// (675348 pinned as residual_unsupported/wouldBlock) — checker errors are too
// rare for a shadow window to add signal beyond the corpus record.
export const defaultReferenceCheckEnforcement: ReferenceCheckEnforcementConfig =
  {
    blockOnResidualUnsupported: true,
    retryOnUnavailable: true
  };

// Under the shadow defaults this reproduces today's enforced behavior
// byte-identically: the legacy overwrite-semantics `checkerError` decides
// whether the gate saw `null` (vacuous pass) or the evaluated coverage.
export function applyReferenceCheckEnforcement(
  outcome: ReferenceCheckOutcome,
  options: { legacyCheckerError: string | null },
  enforcement: ReferenceCheckEnforcementConfig = defaultReferenceCheckEnforcement
): { gate: ReferenceCheckGateResult; forceNeedsRetry: boolean } {
  const vacuousGate: ReferenceCheckGateResult = {
    blocking: false,
    reason: null,
    highRiskUnsupportedSentences: []
  };
  // Stale evidence never blocks even when promoted — the verdict describes a
  // superseded draft; those runs fall through to the retry arm instead.
  const gate = enforcement.blockOnResidualUnsupported
    ? outcome.evidenceStale
      ? vacuousGate
      : outcome.gate
    : options.legacyCheckerError
      ? vacuousGate
      : outcome.gate;
  return {
    gate,
    forceNeedsRetry: enforcement.retryOnUnavailable && outcome.wouldRetry
  };
}
