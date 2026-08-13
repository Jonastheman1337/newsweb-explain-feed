import { createHash } from "node:crypto";
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
  sourceSha256?: string;
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
  errorText?: string | null;
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
  challengerSide: "A" | "B";
  presentationPosition: number;
};

export type ReviewProtocol = {
  assignmentAlgorithmVersion: "balanced_sha256_v1" | "legacy_reviews_v1";
  orderingAlgorithmVersion: "sha256_order_v1" | "legacy_reviews_v1";
  assignmentSeed: string | null;
  orderingSeed: string | null;
  assignments: ReviewAssignment[];
};

export type EditorialEvalOrderBand = {
  band: number;
  startPosition: number;
  endPosition: number;
  caseCount: number;
  reviewed: number;
  decided: number;
  aWins: number;
  bWins: number;
  challengerWins: number;
};

export type EditorialEvalIntegrityDiagnostics = {
  promotionEligible: boolean;
  reasons: string[];
  warnings: string[];
  assignmentCount: number;
  reviewCount: number;
  missingReviewCaseIds: string[];
  invalidReviewCaseIds: string[];
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
  challengerPlacement: { A: number; B: number; difference: number };
  displayedSidePreference: {
    A: number;
    B: number;
    tie: number;
    bothBad: number;
  };
  challengerResultsBySide: Record<
    "A" | "B",
    { decided: number; wins: number; losses: number }
  >;
  categoryBySide: Record<string, { challengerOnA: number; challengerOnB: number }>;
  orderBands: EditorialEvalOrderBand[];
  generationFailures: { control: number; challenger: number };
  integrity: EditorialEvalIntegrityDiagnostics;
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

type GenerationPair = {
  caseId: string;
  control: EvalGenerationSummary;
  challenger: EvalGenerationSummary;
};

function protocolDigest(domain: string, seed: string, caseId: string): string {
  return createHash("sha256")
    .update(`${domain}\0${seed}\0${caseId}`)
    .digest("hex");
}

function generationPairs(
  generations: EvalGenerationSummary[],
  controlVariant: RegularPromptVariantId,
  challengerVariant: RegularPromptVariantId
): GenerationPair[] {
  const byCase = new Map<string, EvalGenerationSummary[]>();
  const generationIds = new Set<string>();
  for (const generation of generations) {
    if (generationIds.has(generation.id)) {
      throw new Error(`Duplicate evaluation generation id: ${generation.id}`);
    }
    generationIds.add(generation.id);
    const existing = byCase.get(generation.caseId) ?? [];
    existing.push(generation);
    byCase.set(generation.caseId, existing);
  }

  return [...byCase.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([caseId, caseGenerations]) => {
      const controls = caseGenerations.filter(
        (generation) =>
          generation.arm === "control" ||
          (!generation.arm &&
            controlVariant !== challengerVariant &&
            generation.variantId === controlVariant)
      );
      const challengers = caseGenerations.filter(
        (generation) =>
          generation.arm === "challenger" ||
          (!generation.arm &&
            controlVariant !== challengerVariant &&
            generation.variantId === challengerVariant)
      );
      if (controls.length !== 1 || challengers.length !== 1) {
        throw new Error(
          `Case ${caseId} must have exactly one control and one challenger generation; found ${controls.length}/${challengers.length}`
        );
      }
      return { caseId, control: controls[0]!, challenger: challengers[0]! };
    });
}

export function createReviewProtocol(
  generations: EvalGenerationSummary[],
  controlVariant: RegularPromptVariantId,
  challengerVariant: RegularPromptVariantId,
  options: { assignmentSeed: string; orderingSeed: string }
): ReviewProtocol {
  const pairs = generationPairs(generations, controlVariant, challengerVariant);
  const extraChallengerOnA =
    pairs.length % 2 === 1 &&
    Number.parseInt(
      protocolDigest("balanced_sha256_v1_extra", options.assignmentSeed, "").slice(
        0,
        2
      ),
      16
    ) %
      2 ===
      0;
  const challengerOnATarget =
    Math.floor(pairs.length / 2) + (extraChallengerOnA ? 1 : 0);
  const assignmentRank = [...pairs].sort((left, right) => {
    const leftDigest = protocolDigest(
      "balanced_sha256_v1",
      options.assignmentSeed,
      left.caseId
    );
    const rightDigest = protocolDigest(
      "balanced_sha256_v1",
      options.assignmentSeed,
      right.caseId
    );
    return leftDigest.localeCompare(rightDigest) || left.caseId.localeCompare(right.caseId);
  });
  const challengerOnA = new Set(
    assignmentRank.slice(0, challengerOnATarget).map((item) => item.caseId)
  );
  const presentationOrder = [...pairs].sort((left, right) => {
    const leftDigest = protocolDigest(
      "sha256_order_v1",
      options.orderingSeed,
      left.caseId
    );
    const rightDigest = protocolDigest(
      "sha256_order_v1",
      options.orderingSeed,
      right.caseId
    );
    return leftDigest.localeCompare(rightDigest) || left.caseId.localeCompare(right.caseId);
  });

  const protocol: ReviewProtocol = {
    assignmentAlgorithmVersion: "balanced_sha256_v1",
    orderingAlgorithmVersion: "sha256_order_v1",
    assignmentSeed: options.assignmentSeed,
    orderingSeed: options.orderingSeed,
    assignments: presentationOrder.map((pair, index) => {
      const challengerSide = challengerOnA.has(pair.caseId) ? "A" : "B";
      return {
        caseId: pair.caseId,
        aGenerationId:
          challengerSide === "A" ? pair.challenger.id : pair.control.id,
        bGenerationId:
          challengerSide === "A" ? pair.control.id : pair.challenger.id,
        challengerSide,
        presentationPosition: index + 1
      };
    })
  };
  assertReviewProtocolIntegrity(
    protocol,
    generations,
    controlVariant,
    challengerVariant
  );
  return protocol;
}

export function createLegacyReviewProtocol(
  generations: EvalGenerationSummary[],
  reviews: EvalReview[],
  controlVariant: RegularPromptVariantId,
  challengerVariant: RegularPromptVariantId
): ReviewProtocol {
  const pairs = generationPairs(generations, controlVariant, challengerVariant);
  const pairByCase = new Map(pairs.map((item) => [item.caseId, item]));
  const reviewedCases = new Set<string>();
  const assignments = reviews.map((review, index) => {
    if (reviewedCases.has(review.caseId)) {
      throw new Error(`Duplicate legacy review case: ${review.caseId}`);
    }
    reviewedCases.add(review.caseId);
    const pair = pairByCase.get(review.caseId);
    if (!pair) throw new Error(`Legacy review references unknown case: ${review.caseId}`);
    const ids = new Set([review.aGenerationId, review.bGenerationId]);
    if (!ids.has(pair.control.id) || !ids.has(pair.challenger.id)) {
      throw new Error(`Legacy review assignment does not match case ${review.caseId}`);
    }
    return {
      caseId: review.caseId,
      aGenerationId: review.aGenerationId,
      bGenerationId: review.bGenerationId,
      challengerSide:
        review.aGenerationId === pair.challenger.id ? ("A" as const) : ("B" as const),
      presentationPosition: index + 1
    };
  });
  if (assignments.length !== pairs.length) {
    throw new Error(
      `Legacy review reconstruction requires all ${pairs.length} cases; received ${assignments.length}`
    );
  }
  const protocol: ReviewProtocol = {
    assignmentAlgorithmVersion: "legacy_reviews_v1",
    orderingAlgorithmVersion: "legacy_reviews_v1",
    assignmentSeed: null,
    orderingSeed: null,
    assignments
  };
  assertReviewProtocolIntegrity(
    protocol,
    generations,
    controlVariant,
    challengerVariant
  );
  return protocol;
}

export function assertReviewProtocolIntegrity(
  protocol: ReviewProtocol,
  generations: EvalGenerationSummary[],
  controlVariant: RegularPromptVariantId,
  challengerVariant: RegularPromptVariantId
): void {
  const pairs = generationPairs(generations, controlVariant, challengerVariant);
  if (protocol.assignments.length !== pairs.length) {
    throw new Error(
      `Review protocol has ${protocol.assignments.length} assignments for ${pairs.length} generation pairs`
    );
  }
  const pairByCase = new Map(pairs.map((item) => [item.caseId, item]));
  const seenCases = new Set<string>();
  const seenPositions = new Set<number>();
  let challengerOnA = 0;
  for (const assignment of protocol.assignments) {
    if (seenCases.has(assignment.caseId)) {
      throw new Error(`Duplicate review protocol case: ${assignment.caseId}`);
    }
    if (seenPositions.has(assignment.presentationPosition)) {
      throw new Error(
        `Duplicate review protocol position: ${assignment.presentationPosition}`
      );
    }
    seenCases.add(assignment.caseId);
    seenPositions.add(assignment.presentationPosition);
    const pair = pairByCase.get(assignment.caseId);
    if (!pair) {
      throw new Error(`Review protocol references unknown case: ${assignment.caseId}`);
    }
    const expectedA =
      assignment.challengerSide === "A" ? pair.challenger.id : pair.control.id;
    const expectedB =
      assignment.challengerSide === "A" ? pair.control.id : pair.challenger.id;
    if (
      assignment.aGenerationId !== expectedA ||
      assignment.bGenerationId !== expectedB
    ) {
      throw new Error(`Review protocol assignment mismatch for ${assignment.caseId}`);
    }
    if (assignment.challengerSide === "A") challengerOnA += 1;
  }
  const expectedPositions = Array.from(
    { length: pairs.length },
    (_, index) => index + 1
  );
  if (
    [...seenPositions].sort((left, right) => left - right).join(",") !==
    expectedPositions.join(",")
  ) {
    throw new Error("Review protocol positions must be contiguous and one-based");
  }
  if (protocol.assignmentAlgorithmVersion === "balanced_sha256_v1") {
    if (!protocol.assignmentSeed || !protocol.orderingSeed) {
      throw new Error("Seeded review protocols must persist both seeds");
    }
    const challengerOnB = pairs.length - challengerOnA;
    if (Math.abs(challengerOnA - challengerOnB) > 1) {
      throw new Error(
        `Seeded review protocol is imbalanced (${challengerOnA}/${challengerOnB})`
      );
    }
  }
}

export function summarizeEditorialEval(
  run: EvalRunSummaryInput,
  reviews: EvalReview[],
  options: {
    controlVariant: RegularPromptVariantId;
    challengerVariant: RegularPromptVariantId;
    reviewProtocol?: ReviewProtocol;
    artifactIntegrity?: {
      promotionEligible: boolean;
      reasons: string[];
      warnings?: string[];
    };
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

  const inferredAssignments: ReviewAssignment[] = reviews.map((review, index) => {
    const a = generationsById.get(review.aGenerationId);
    const challengerOnA = a
      ? a.arm === "challenger" ||
        (!a.arm && a.variantId === options.challengerVariant)
      : false;
    return {
      caseId: review.caseId,
      aGenerationId: review.aGenerationId,
      bGenerationId: review.bGenerationId,
      challengerSide: challengerOnA ? "A" : "B",
      presentationPosition: index + 1
    };
  });
  const assignments = options.reviewProtocol?.assignments ?? inferredAssignments;
  const assignmentByCase = new Map(
    assignments.map((assignment) => [assignment.caseId, assignment])
  );
  const duplicateReviewCases = new Set<string>();
  const reviewByCase = new Map<string, EvalReview>();
  for (const review of reviews) {
    if (reviewByCase.has(review.caseId)) duplicateReviewCases.add(review.caseId);
    reviewByCase.set(review.caseId, review);
  }
  const invalidReviewCaseIds = new Set<string>(duplicateReviewCases);
  for (const review of reviews) {
    const assignment = assignmentByCase.get(review.caseId);
    if (
      !assignment ||
      assignment.aGenerationId !== review.aGenerationId ||
      assignment.bGenerationId !== review.bGenerationId ||
      !generationsById.has(review.aGenerationId) ||
      !generationsById.has(review.bGenerationId)
    ) {
      invalidReviewCaseIds.add(review.caseId);
    }
  }
  const missingReviewCaseIds = assignments
    .filter((assignment) => !reviewByCase.has(assignment.caseId))
    .map((assignment) => assignment.caseId);
  const validReviews = reviews.filter(
    (review) => !invalidReviewCaseIds.has(review.caseId)
  );

  const challengerPlacement = { A: 0, B: 0, difference: 0 };
  const categoryBySide: Record<
    string,
    { challengerOnA: number; challengerOnB: number }
  > = {};
  for (const assignment of assignments) {
    challengerPlacement[assignment.challengerSide] += 1;
    const challengerId =
      assignment.challengerSide === "A"
        ? assignment.aGenerationId
        : assignment.bGenerationId;
    const challenger = generationsById.get(challengerId);
    if (!challenger) continue;
    const category = (categoryBySide[challenger.category] ??= {
      challengerOnA: 0,
      challengerOnB: 0
    });
    if (assignment.challengerSide === "A") category.challengerOnA += 1;
    else category.challengerOnB += 1;
  }
  challengerPlacement.difference = Math.abs(
    challengerPlacement.A - challengerPlacement.B
  );

  const displayedSidePreference = { A: 0, B: 0, tie: 0, bothBad: 0 };
  const challengerResultsBySide = {
    A: { decided: 0, wins: 0, losses: 0 },
    B: { decided: 0, wins: 0, losses: 0 }
  };
  const bandCount = Math.min(5, Math.max(assignments.length, 1));
  const orderBands: EditorialEvalOrderBand[] = Array.from(
    { length: bandCount },
    (_, index) => ({
      band: index + 1,
      startPosition: Math.floor((index * assignments.length) / bandCount) + 1,
      endPosition: Math.floor(((index + 1) * assignments.length) / bandCount),
      caseCount: 0,
      reviewed: 0,
      decided: 0,
      aWins: 0,
      bWins: 0,
      challengerWins: 0
    })
  );
  for (const assignment of assignments) {
    const bandIndex = Math.min(
      bandCount - 1,
      Math.floor(
        ((assignment.presentationPosition - 1) * bandCount) /
          Math.max(assignments.length, 1)
      )
    );
    const band = orderBands[bandIndex]!;
    band.caseCount += 1;
    const review = reviewByCase.get(assignment.caseId);
    if (!review || invalidReviewCaseIds.has(review.caseId)) continue;
    band.reviewed += 1;
    if (review.winner === "both_bad") displayedSidePreference.bothBad += 1;
    else displayedSidePreference[review.winner] += 1;
    if (review.winner === "A" || review.winner === "B") {
      band.decided += 1;
      if (review.winner === "A") band.aWins += 1;
      else band.bWins += 1;
      const sideResults = challengerResultsBySide[assignment.challengerSide];
      sideResults.decided += 1;
      if (review.winner === assignment.challengerSide) {
        sideResults.wins += 1;
        band.challengerWins += 1;
      } else {
        sideResults.losses += 1;
      }
    }
  }

  const generationFailures = { control: 0, challenger: 0 };
  for (const generation of run.generations) {
    if (!generation.errorText) continue;
    const arm = generation.arm;
    if (arm) generationFailures[arm] += 1;
  }

  let controlWins = 0;
  let challengerWins = 0;
  let ties = 0;
  let bothBad = 0;
  const categoryNetWins: Record<string, number> = {};

  for (const review of validReviews) {
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

  const integrityReasons = [...(options.artifactIntegrity?.reasons ?? [])];
  const integrityWarnings = [...(options.artifactIntegrity?.warnings ?? [])];
  if (challengerPlacement.difference > 1) {
    integrityReasons.push(
      `Challenger placement is imbalanced (${challengerPlacement.A}/${challengerPlacement.B}).`
    );
  }
  if (missingReviewCaseIds.length > 0) {
    integrityReasons.push(`${missingReviewCaseIds.length} review cases are missing.`);
  }
  if (invalidReviewCaseIds.size > 0) {
    integrityReasons.push(`${invalidReviewCaseIds.size} reviews do not match assignments.`);
  }
  const promotionEligible =
    (options.artifactIntegrity?.promotionEligible ?? true) &&
    integrityReasons.length === 0;
  const integrity: EditorialEvalIntegrityDiagnostics = {
    promotionEligible,
    reasons: [...new Set(integrityReasons)],
    warnings: [...new Set(integrityWarnings)],
    assignmentCount: assignments.length,
    reviewCount: validReviews.length,
    missingReviewCaseIds,
    invalidReviewCaseIds: [...invalidReviewCaseIds]
  };

  const reasons: string[] = [];
  if (!promotionEligible) reasons.push("Evaluation integrity is not promotion-eligible.");
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
    !hardCategoryRegression &&
    promotionEligible
  ) {
    recommendation = "ship_candidate";
  } else if (challengerWinRate >= 0.5 && !fatalRegression && promotionEligible) {
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
    challengerPlacement,
    displayedSidePreference,
    challengerResultsBySide,
    categoryBySide,
    orderBands,
    generationFailures,
    integrity,
    recommendation,
    reasons
  };
}
