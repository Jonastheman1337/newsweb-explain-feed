import type { PromptPayload, RegularPromptVariantId } from "@newsweb/prompt-kit";

import type { QuoteTelemetry } from "./rewrite-validation.js";

export const evalCategoryIds = [
  "results_guidance",
  "financing",
  "warrants_options_convertibles",
  "contracts_orders",
  "ma",
  "governance_insider",
  "short_vague",
  "hard_other"
] as const;

export type EvalCategoryId = (typeof evalCategoryIds)[number];

export const defaultEvalCategoryQuotas: Record<EvalCategoryId, number> = {
  results_guidance: 8,
  financing: 8,
  warrants_options_convertibles: 8,
  contracts_orders: 7,
  ma: 6,
  governance_insider: 6,
  short_vague: 4,
  hard_other: 3
};

const fifteenCaseEvalCategoryQuotas: Record<EvalCategoryId, number> = {
  results_guidance: 1,
  financing: 3,
  warrants_options_convertibles: 3,
  contracts_orders: 2,
  ma: 2,
  governance_insider: 1,
  short_vague: 2,
  hard_other: 1
};

export function evalCategoryQuotasForLimit(
  limit: number
): Record<EvalCategoryId, number> {
  if (limit === 15) return fifteenCaseEvalCategoryQuotas;
  if (limit === 50) return defaultEvalCategoryQuotas;

  const totalDefaultQuota = evalCategoryIds.reduce(
    (sum, category) => sum + defaultEvalCategoryQuotas[category],
    0
  );
  const scaled = evalCategoryIds.map((category) => {
    const exact = (defaultEvalCategoryQuotas[category] / totalDefaultQuota) * limit;
    return {
      category,
      quota: Math.floor(exact),
      remainder: exact - Math.floor(exact)
    };
  });

  let assigned = scaled.reduce((sum, item) => sum + item.quota, 0);
  for (const item of scaled.sort((left, right) => right.remainder - left.remainder)) {
    if (assigned >= limit) break;
    item.quota += 1;
    assigned += 1;
  }

  return Object.fromEntries(
    scaled.map((item) => [item.category, item.quota])
  ) as Record<EvalCategoryId, number>;
}

export type EvalCase = {
  caseId: string;
  messageId: number;
  company: string;
  issuerSign: string;
  sourceTitle: string;
  publishedAt: string;
  category: EvalCategoryId;
  difficultyTags: string[];
  payload: PromptPayload;
};

export type EvalCandidate = Omit<EvalCase, "caseId">;

export type EvalFatalStatus = {
  fatal: boolean;
  reasons: string[];
};

export type EvalGenerationSummary = {
  id: string;
  caseId: string;
  variantId: RegularPromptVariantId;
  arm?: "control" | "challenger";
  category: EvalCategoryId;
  fatalStatus: EvalFatalStatus;
  quoteTelemetry?: QuoteTelemetry;
};

export type EvalQuoteMetrics = {
  generationsWithTelemetry: number;
  quoteOpportunityCount: number;
  quotePresenceCount: number;
  quotePresenceRate: number;
  dashQuoteCount: number;
  guillemetsCount: number;
  attributionOnlyCount: number;
};

export type EvalRunSummaryInput = {
  generations: EvalGenerationSummary[];
};

export type EvalReviewChoice = "A" | "B" | "tie" | "both_bad";

export type EvalReview = {
  caseId: string;
  aGenerationId: string;
  bGenerationId: string;
  winner: EvalReviewChoice;
  issueTags?: string[];
  comment?: string;
  reviewTimeMs?: number;
  reviewedAt?: string;
};

export type ReviewAssignment = {
  caseId: string;
  aGenerationId: string;
  bGenerationId: string;
};

export type EditorialEvalSummary = {
  decidedComparisons: number;
  challengerWinRate: number;
  controlWins: number;
  challengerWins: number;
  ties: number;
  bothBad: number;
  fatalCounts: Record<string, number>;
  categoryNetWins: Record<string, number>;
  quoteMetrics: Record<string, EvalQuoteMetrics>;
  recommendation: "ship_candidate" | "iterate" | "reject";
  reasons: string[];
};

const CATEGORY_PATTERNS: Array<{
  category: EvalCategoryId;
  patterns: RegExp[];
}> = [
  {
    category: "warrants_options_convertibles",
    patterns: [
      /\bwarrants?\b/i,
      /\baksjeopsjoner?\b/i,
      /\bopsjonsprogram\b/i,
      /\bopsjonsrett/i,
      /\bshare options?\b/i,
      /\boption rights?\b/i,
      /\bsubscription rights?\b/i,
      /\bkonvertibl/i,
      /\bconvertible\b/i,
      /\btegningsrett/i,
      /\bdilut/i,
      /\butvann/i
    ]
  },
  {
    category: "financing",
    patterns: [
      /\bemisjon\b/i,
      /\bprivate placement\b/i,
      /\brettet emisjon\b/i,
      /\breparasjonsemisjon\b/i,
      /\bkapitalinnhenting\b/i,
      /\bkapitalforh[oø]yelse\b/i,
      /\bobligasjon/i,
      /\bbonds?\b/i,
      /\bl[åa]n\b/i,
      /\bloans?\b/i,
      /\bfacility\b/i,
      /\bfinansier/i
    ]
  },
  {
    category: "results_guidance",
    patterns: [
      /\bresultat/i,
      /\binntekter?\b/i,
      /\bomsetning\b/i,
      /\brevenue\b/i,
      /\bebit/i,
      /\bguiding\b/i,
      /\butsikter\b/i,
      /\boutlook\b/i,
      /\bquarter\b/i,
      /\bkvartal\b/i
    ]
  },
  {
    category: "contracts_orders",
    patterns: [
      /\bkontrakt/i,
      /\bcontract\b/i,
      /\border\b/i,
      /\bavtale\b/i,
      /\bframework agreement\b/i,
      /\bpartnership\b/i,
      /\bsamarbeid\b/i,
      /\brammeavtale\b/i
    ]
  },
  {
    category: "ma",
    patterns: [
      /\boppkj[oø]p\b/i,
      /\bkj[oø]per\b/i,
      /\bselger\b/i,
      /\bfusjon\b/i,
      /\bmerger\b/i,
      /\bacquisition\b/i,
      /\bacquir/i,
      /\bdisposal\b/i,
      /\bdivest/i,
      /\btransaksjon\b/i
    ]
  },
  {
    category: "governance_insider",
    patterns: [
      /\bprim[æa]rinnsider\b/i,
      /\binnside/i,
      /\bprimary insider\b/i,
      /\bmandatory notification of trade\b/i,
      /\bmeldepliktig handel\b/i,
      /\bstyre/i,
      /\bgeneralforsamling\b/i,
      /\bfullmakt\b/i,
      /\bledelse\b/i,
      /\bmanagement\b/i,
      /\bceo\b/i,
      /\bcfo\b/i,
      /\bevp\b/i,
      /\bappoints?\b/i,
      /\bappointment\b/i,
      /\butnevner\b/i
    ]
  }
];

const categoryPriorityOrder: EvalCategoryId[] = [
  "warrants_options_convertibles",
  "financing",
  "governance_insider",
  "contracts_orders",
  "ma",
  "results_guidance"
];

function normalizedSearchText(payload: PromptPayload): string {
  const text = [
    payload.title,
    payload.issuerName,
    payload.issuerSign,
    payload.categories.join(" "),
    payload.markets.join(" "),
    payload.bodyText
  ].join("\n");
  const asciiText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return `${text}\n${asciiText}`;
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isGenericInsideInformationOnly(text: string): boolean {
  if (!/\b(?:inside information|innsideinformasjon)\b/i.test(text)) return false;
  return !/\b(?:primary insider|primaerinnsider|mandatory notification of trade|meldepliktig handel|styre|generalforsamling|fullmakt|ledelse|management|ceo|cfo|evp|appoints?|appointment|utnevner)\b/i.test(
    text
  );
}

function hasStrongGovernanceSignal(text: string): boolean {
  return /\b(?:primary insider|primaerinnsider|mandatory notification of trade|meldepliktig handel|styre|generalforsamling|fullmakt|ledelse|evp|appoints?|appointment|utnevner)\b/i.test(
    text
  );
}

function isOwnShareBuybackText(text: string): boolean {
  return /\b(?:own shares|issuer's own shares|treasury shares|share buy-?back|buy-?back programme|egne aksjer|tilbakekj[oø]p)\b/i.test(
    text
  );
}

export function categorizeEvalPayload(payload: PromptPayload): EvalCategoryId {
  const text = normalizedSearchText(payload);
  const patternsByCategory = new Map(
    CATEGORY_PATTERNS.map((item) => [item.category, item.patterns])
  );
  for (const category of categoryPriorityOrder) {
    if (category === "ma" && isOwnShareBuybackText(text)) continue;
    if (
      category === "governance_insider" &&
      (!hasStrongGovernanceSignal(text) || isGenericInsideInformationOnly(text))
    ) {
      continue;
    }
    const patterns = patternsByCategory.get(category) ?? [];
    if (hasAnyPattern(text, patterns)) {
      return category;
    }
  }
  if (payload.sourceBodyChars < 300 || payload.bodyText.trim().length < 300) {
    return "short_vague";
  }
  return "hard_other";
}

export function difficultyTagsForPayload(payload: PromptPayload): string[] {
  const tags: string[] = [];
  const text = normalizedSearchText(payload);
  if (payload.hasAttachments) tags.push("has_attachments");
  if (payload.sourceBodyChars < 300 || payload.bodyText.trim().length < 300) {
    tags.push("short_source");
  }
  if (payload.sourceBodyChars > 1800 || payload.bodyText.trim().length > 1800) {
    tags.push("long_source");
  }
  if ((text.match(/\b\d[\d .,%:/-]*/g) ?? []).length >= 12) {
    tags.push("numeric_heavy");
  }
  if (/\b(?:inside information|innsideinformasjon|primary insider|primaerinnsider)\b/i.test(text)) {
    tags.push("inside_information");
  }
  if (payload.categories.length === 0) tags.push("missing_categories");
  if (
    /\b(?:warrant|aksjeopsjon|opsjonsprogram|opsjonsrett|share option|option right|konvertibl|tegningsrett|utvann|dilut)/i.test(
      text
    )
  ) {
    tags.push("dilution_mechanism");
  }
  return tags;
}

export function selectBalancedEvalCases(
  candidates: EvalCandidate[],
  options: {
    limit: number;
    quotas?: Record<EvalCategoryId, number>;
  }
): EvalCase[] {
  const quotas = options.quotas ?? defaultEvalCategoryQuotas;
  const rankedCandidates = [...candidates].sort((left, right) => {
    const scoreDelta = candidatePriorityScore(right) - candidatePriorityScore(left);
    if (scoreDelta !== 0) return scoreDelta;
    return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  });
  const selected: EvalCandidate[] = [];
  const selectedKeys = new Set<number>();
  const counts = new Map<EvalCategoryId, number>();

  for (const category of evalCategoryIds) {
    const quota = quotas[category] ?? 0;
    for (const candidate of rankedCandidates) {
      if (selected.length >= options.limit) break;
      if (selectedKeys.has(candidate.messageId)) continue;
      if (candidate.category !== category) continue;
      if ((counts.get(category) ?? 0) >= quota) break;
      selected.push(candidate);
      selectedKeys.add(candidate.messageId);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }

  for (const candidate of rankedCandidates) {
    if (selected.length >= options.limit) break;
    if (selectedKeys.has(candidate.messageId)) continue;
    selected.push(candidate);
    selectedKeys.add(candidate.messageId);
  }

  return selected.map((candidate, index) => ({
    ...candidate,
    caseId: `case_${String(index + 1).padStart(3, "0")}_${candidate.messageId}`
  }));
}

function candidatePriorityScore(candidate: EvalCandidate): number {
  let score = 0;
  if (
    candidate.category === "warrants_options_convertibles" &&
    candidate.difficultyTags.includes("dilution_mechanism")
  ) {
    score += 20;
  }
  if (candidate.difficultyTags.includes("from_generation_run")) score += 3;
  if (candidate.difficultyTags.includes("numeric_heavy")) score += 2;
  if (candidate.difficultyTags.includes("long_source")) score += 1;
  if (
    candidate.category !== "short_vague" &&
    candidate.difficultyTags.includes("short_source")
  ) {
    score -= 1;
  }
  if (candidate.difficultyTags.includes("source_notice_without_attachment_text")) {
    score -= 2;
  }
  return score;
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createReviewAssignments(
  generations: EvalGenerationSummary[],
  controlVariant: RegularPromptVariantId,
  challengerVariant: RegularPromptVariantId
): ReviewAssignment[] {
  const byCase = new Map<string, EvalGenerationSummary[]>();
  for (const generation of generations) {
    const existing = byCase.get(generation.caseId) ?? [];
    existing.push(generation);
    byCase.set(generation.caseId, existing);
  }

  return [...byCase.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([caseId, caseGenerations]) => {
      const control =
        caseGenerations.find((generation) => generation.arm === "control") ??
        caseGenerations.find((generation) => generation.variantId === controlVariant);
      const challenger =
        caseGenerations.find((generation) => generation.arm === "challenger") ??
        caseGenerations.find((generation) => generation.variantId === challengerVariant);
      if (!control || !challenger) return [];
      const challengerIsA = hashText(`${caseId}:${challenger.id}`) % 2 === 0;
      return [
        {
          caseId,
          aGenerationId: challengerIsA ? challenger.id : control.id,
          bGenerationId: challengerIsA ? control.id : challenger.id
        }
      ];
    });
}

export function summarizeEditorialEval(
  run: EvalRunSummaryInput,
  reviews: EvalReview[],
  options: {
    controlVariant: RegularPromptVariantId;
    challengerVariant: RegularPromptVariantId;
  }
): EditorialEvalSummary {
  const comparisonKey = (generation: EvalGenerationSummary) =>
    generation.arm ?? generation.variantId;
  const generationsById = new Map(run.generations.map((item) => [item.id, item]));
  const fatalCounts: Record<string, number> = {};
  for (const generation of run.generations) {
    if (!generation.fatalStatus.fatal) continue;
    const key = comparisonKey(generation);
    fatalCounts[key] = (fatalCounts[key] ?? 0) + 1;
  }

  const quoteMetrics: Record<string, EvalQuoteMetrics> = {};
  for (const generation of run.generations) {
    const telemetry = generation.quoteTelemetry;
    if (!telemetry) continue;
    const metrics = (quoteMetrics[comparisonKey(generation)] ??= {
      generationsWithTelemetry: 0,
      quoteOpportunityCount: 0,
      quotePresenceCount: 0,
      quotePresenceRate: 0,
      dashQuoteCount: 0,
      guillemetsCount: 0,
      attributionOnlyCount: 0
    });
    metrics.generationsWithTelemetry += 1;
    const hasQuote =
      telemetry.draftContainsStandaloneDashQuote ||
      telemetry.draftContainsInlineGuillemets;
    if (telemetry.draftContainsStandaloneDashQuote) metrics.dashQuoteCount += 1;
    if (telemetry.draftContainsInlineGuillemets) metrics.guillemetsCount += 1;
    if (!hasQuote && telemetry.draftContainsNamedPersonAttribution) {
      metrics.attributionOnlyCount += 1;
    }
    if (telemetry.sourceContainsNamedQuoteLikePattern) {
      metrics.quoteOpportunityCount += 1;
      if (hasQuote) metrics.quotePresenceCount += 1;
    }
  }
  for (const metrics of Object.values(quoteMetrics)) {
    metrics.quotePresenceRate =
      metrics.quoteOpportunityCount > 0
        ? Number(
            (metrics.quotePresenceCount / metrics.quoteOpportunityCount).toFixed(4)
          )
        : 0;
  }

  let controlWins = 0;
  let challengerWins = 0;
  let ties = 0;
  let bothBad = 0;
  const categoryNetWins: Record<string, number> = {};

  for (const review of reviews) {
    if (review.winner === "tie") {
      ties += 1;
      continue;
    }
    if (review.winner === "both_bad") {
      bothBad += 1;
      continue;
    }

    const winningGenerationId =
      review.winner === "A" ? review.aGenerationId : review.bGenerationId;
    const winningGeneration = generationsById.get(winningGenerationId);
    if (!winningGeneration) continue;
    const winningKey = comparisonKey(winningGeneration);
    const winnerIsChallenger = winningGeneration.arm
      ? winningGeneration.arm === "challenger"
      : winningGeneration.variantId === options.challengerVariant;
    const delta = winnerIsChallenger ? 1 : -1;
    categoryNetWins[winningGeneration.category] =
      (categoryNetWins[winningGeneration.category] ?? 0) + delta;
    if (winnerIsChallenger) {
      challengerWins += 1;
    } else if (
      winningKey === "control" ||
      winningGeneration.variantId === options.controlVariant
    ) {
      controlWins += 1;
    }
  }

  const decidedComparisons = controlWins + challengerWins;
  const challengerWinRate =
    decidedComparisons > 0 ? challengerWins / decidedComparisons : 0;
  const challengerFatalCount =
    fatalCounts.challenger ?? fatalCounts[options.challengerVariant] ?? 0;
  const controlFatalCount = fatalCounts.control ?? fatalCounts[options.controlVariant] ?? 0;
  const fatalRegression = challengerFatalCount > controlFatalCount;
  const hardCategoryRegression = [
    "financing",
    "warrants_options_convertibles"
  ].some((category) => (categoryNetWins[category] ?? 0) <= -2);

  const reasons: string[] = [];
  if (decidedComparisons === 0) reasons.push("No decided non-tie comparisons.");
  if (challengerWinRate < 0.65) {
    reasons.push("Challenger win rate is below 65 percent.");
  }
  if (fatalRegression) {
    reasons.push("Challenger has more fatal validation/reference failures.");
  }
  if (hardCategoryRegression) {
    reasons.push("Challenger regresses in financing or dilution hard cases.");
  }

  let recommendation: EditorialEvalSummary["recommendation"] = "reject";
  if (
    decidedComparisons > 0 &&
    challengerWinRate >= 0.65 &&
    !fatalRegression &&
    !hardCategoryRegression
  ) {
    recommendation = "ship_candidate";
  } else if (challengerWinRate >= 0.5 && !fatalRegression) {
    recommendation = "iterate";
  }

  return {
    decidedComparisons,
    challengerWinRate: Number(challengerWinRate.toFixed(4)),
    controlWins,
    challengerWins,
    ties,
    bothBad,
    fatalCounts,
    categoryNetWins,
    quoteMetrics,
    recommendation,
    reasons
  };
}
