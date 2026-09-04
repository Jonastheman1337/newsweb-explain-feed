import {
  assessNumbersInText,
  formatNorwegianNoticeDate,
  sakLengthBand,
  type NumberAssessment,
  type SakPromptPayload
} from "@newsweb/prompt-kit";
import {
  SAK_LINK_MARKER_PATTERN,
  SAK_SUBHEADING_MAX_CHARS,
  SAK_TITLE_MAX_WORDS,
  countSakVisibleChars,
  ensureSitatstrek,
  sakBlockDisplayText,
  sakBlockPlainText,
  type RewriteOutput,
  type SakArticle
} from "@newsweb/shared";
import { findAttributionRisks } from "./claim-precautions.js";
import {
  validateRevisionInstructionCompliance,
  type RevisionInstructionCompliance
} from "./revision-instructions.js";
import {
  VISIBLE_ATTACHMENT_REFERENCE_PATTERNS,
  countWords,
  detectMarkerLeaks,
  type MarkerLeakMatch
} from "./rewrite-validation.js";

/**
 * Deterministic checks on a /sak article. Never throws: fixes what it can
 * (unknown links → anchor text, missing sitatstrek, forced change_note),
 * records the rest as issues. Blocking issues trigger one repair call in the
 * worker and, if they survive it, the version lands as needs_review rather
 * than ready. Messages are Norwegian because they reach both the repair
 * prompt and the desk.
 */

export const SAK_FIRST_DRAFT_CHANGE_NOTE = "Første utkast";
export const SAK_REVISION_CHANGE_NOTE_FALLBACK = "Revidert versjon";
export const SAK_MAX_LEAD_SENTENCES = 2;
const MAX_ATTRIBUTION_RISK_ISSUES = 5;

export type SakValidationSeverity = "blocking" | "warning";

export type SakValidationIssue = {
  code: string;
  severity: SakValidationSeverity;
  message: string;
};

export type SakValidationContext = {
  titleOverride?: string | null;
  targetChars: number;
  previousArticle?: SakArticle | null;
  instruction?: string | null;
  isFirstDraft: boolean;
};

export type SakValidationResult = {
  article: SakArticle;
  issues: SakValidationIssue[];
  blockingErrors: string[];
  warnings: string[];
  visibleChars: number;
  lengthBand: { min: number; max: number };
  numberAssessments: NumberAssessment[];
  unexpectedNumbers: string[];
  markerLeaks: MarkerLeakMatch[];
  revisionCompliance: RevisionInstructionCompliance | null;
};

const WEEKDAY_OR_MONTH_SOURCE =
  "(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)";
const BODY_OPENS_WITH_NUMBER_PATTERNS = [
  /^\s*[-–]?\s*\d/,
  new RegExp(`^\\s*(?:i\\s+)?${WEEKDAY_OR_MONTH_SOURCE}\\s+\\d`, "i")
];

// A sentence ends at . ! ? followed by whitespace and a capital letter, an
// opening quote or dash, or the end of the text. "24. september" and
// "3. juni" therefore do not split; "SSB. Det" does.
const SENTENCE_END_PATTERN = /[.!?]+(?=\s+[A-ZÆØÅ«"“(–]|\s*$)/g;

export function countSakSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const matches = trimmed.match(SENTENCE_END_PATTERN);
  return matches && matches.length > 0 ? matches.length : 1;
}

function cloneArticle(article: SakArticle): SakArticle {
  return JSON.parse(JSON.stringify(article)) as SakArticle;
}

function addIssue(
  issues: SakValidationIssue[],
  code: string,
  severity: SakValidationSeverity,
  message: string
): void {
  issues.push({ code, severity, message });
}

/**
 * The notice validators read title/lead/body only; the ledger fields are
 * filled with sak equivalents or left empty. Zod never runs on this shape.
 */
export function sakArticleAsRewriteShape(article: SakArticle): RewriteOutput {
  return {
    title: sakBlockPlainText(article.title),
    lead: sakBlockPlainText(article.lead),
    body: article.blocks.map(sakBlockDisplayText).filter((text) => text.length > 0),
    company_sentence: "",
    key_facts: [],
    negative_or_surprising: [],
    excluded_hype: article.excluded_hype.map((entry) => entry.quote),
    source_limitations: article.desk_notes,
    confidence: "medium",
    importance: "medium",
    source_spans: article.source_spans
  };
}

/** Visible article text (title, lead, blocks) without link markers. */
export function sakVisibleText(article: SakArticle): string {
  return [
    sakBlockPlainText(article.title).trim(),
    sakBlockPlainText(article.lead).trim(),
    ...article.blocks.map(sakBlockDisplayText)
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

/**
 * Numeric-gate source: every ready material (title, url, text) plus today's
 * date in both forms, so "torsdag" datelines and the publishing year pass.
 * Failed materials contribute nothing: they cannot supply facts.
 */
export function buildSakNumericSourceText(
  payload: SakPromptPayload,
  extra: { titleOverride?: string | null } = {}
): string {
  const parts = payload.materials
    .filter((material) => material.status === "ready")
    .map((material) =>
      [`[${material.sourceId}] ${material.title}`, material.url ?? "", material.text].join("\n")
    );
  parts.push(payload.todayIso, formatNorwegianNoticeDate(payload.todayIso));
  if (extra.titleOverride?.trim()) {
    parts.push(extra.titleOverride.trim());
  }
  return parts.join("\n");
}

const MALFORMED_MARKER_PATTERN = /\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/g;
const STRAY_BRACKET_PATTERN = /\[\[|\]\]/g;

function normalizeLinks(
  text: string,
  knownIds: Set<string>,
  stats: { unknown: Set<string>; malformed: boolean }
): string {
  // Walk the well-formed markers; everything between them is plain text
  // where a broken marker or a stray bracket pair can only be debris.
  const cleanPlain = (segment: string): string => {
    const cleaned = segment
      .replace(MALFORMED_MARKER_PATTERN, (_match, anchor: string) => anchor.trim())
      .replace(STRAY_BRACKET_PATTERN, "");
    if (cleaned !== segment) stats.malformed = true;
    return cleaned;
  };

  const pattern = new RegExp(SAK_LINK_MARKER_PATTERN.source, "g");
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    result += cleanPlain(text.slice(lastIndex, match.index));
    const [full, anchor, materialId] = match;
    if (knownIds.has(materialId)) {
      result += full;
    } else {
      stats.unknown.add(materialId);
      result += anchor;
    }
    lastIndex = match.index + full.length;
  }
  result += cleanPlain(text.slice(lastIndex));
  return result;
}

function normalizeChangeNote(note: string): string {
  return note.replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeForOverlap(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9æøå]+/gi, " ")
    .split(" ")
    .filter((token) => token.length >= 5);
}

function quoteHasSourceSpan(quote: string, spans: string[]): boolean {
  const quoteTokens = new Set(normalizeForOverlap(quote));
  if (quoteTokens.size === 0) return true;
  const spanTokens = new Set(spans.flatMap(normalizeForOverlap));
  let hits = 0;
  for (const token of quoteTokens) {
    if (spanTokens.has(token)) hits += 1;
    if (hits >= 2) return true;
  }
  return hits >= Math.min(2, quoteTokens.size);
}

export function validateSakArticle(
  input: SakArticle,
  payload: SakPromptPayload,
  ctx: SakValidationContext
): SakValidationResult {
  const article = cloneArticle(input);
  const issues: SakValidationIssue[] = [];
  const knownIds = new Set(payload.materials.map((material) => material.sourceId));

  // (1) Title: owner override wins verbatim; otherwise the 8-word rule.
  const titleOverride = ctx.titleOverride?.trim();
  if (titleOverride) {
    article.title = titleOverride;
  } else {
    const plainTitle = sakBlockPlainText(article.title).trim();
    if (plainTitle !== article.title.trim()) {
      addIssue(
        issues,
        "SAK_LINK_IN_HEADING",
        "warning",
        "Tittelen inneholdt en lenkemarkør; den er fjernet."
      );
    }
    article.title = plainTitle;
    if (countWords(article.title) > SAK_TITLE_MAX_WORDS) {
      addIssue(
        issues,
        "SAK_TITLE_TOO_LONG",
        "blocking",
        `Tittelen har ${countWords(article.title)} ord; maks ${SAK_TITLE_MAX_WORDS}.`
      );
    }
  }

  // (2) Links: only supplied materials may be linked; broken markers are stripped.
  const linkStats = { unknown: new Set<string>(), malformed: false };
  article.lead = normalizeLinks(article.lead, knownIds, linkStats);
  for (const block of article.blocks) {
    if (block.kind === "subheading") {
      const plain = sakBlockPlainText(block.text).replace(STRAY_BRACKET_PATTERN, "").trim();
      if (plain !== block.text.trim()) {
        addIssue(
          issues,
          "SAK_LINK_IN_HEADING",
          "warning",
          "En mellomtittel inneholdt en lenkemarkør; den er fjernet."
        );
      }
      block.text = plain;
      continue;
    }
    block.text = normalizeLinks(block.text, knownIds, linkStats);
  }
  // A block that held only a stripped link is dropped rather than stored empty.
  const nonEmptyBlocks = article.blocks.filter((block) => block.text.trim().length > 0);
  if (nonEmptyBlocks.length !== article.blocks.length) {
    addIssue(issues, "SAK_EMPTY_BLOCK_DROPPED", "warning", "Tomme blokker er fjernet.");
    article.blocks = nonEmptyBlocks;
  }
  if (linkStats.unknown.size > 0) {
    addIssue(
      issues,
      "SAK_LINK_UNKNOWN_MATERIAL",
      "warning",
      `Lenker til ukjent materiale er gjort om til vanlig tekst: ${[...linkStats.unknown].join(", ")}.`
    );
  }
  if (linkStats.malformed) {
    addIssue(
      issues,
      "SAK_LINK_MALFORMED",
      "warning",
      "Ufullstendige lenkemarkører er fjernet fra teksten."
    );
  }

  // (4) Shape: quotes carry a sitatstrek, subheadings stay short, the lead is
  // one or two sentences, the body does not open on a figure.
  let quotesWithoutDash = 0;
  for (const block of article.blocks) {
    if (block.kind === "quote") {
      if (!/^\s*[–—-]/.test(block.text)) {
        quotesWithoutDash += 1;
        block.text = ensureSitatstrek(block.text);
      }
    }
    if (block.kind === "subheading" && block.text.length > SAK_SUBHEADING_MAX_CHARS) {
      addIssue(
        issues,
        "SAK_SUBHEADING_TOO_LONG",
        "warning",
        `Mellomtittelen «${block.text}» er lengre enn ${SAK_SUBHEADING_MAX_CHARS} tegn.`
      );
    }
  }
  if (quotesWithoutDash > 0) {
    addIssue(
      issues,
      "SAK_QUOTE_BLOCK_NO_DASH",
      "warning",
      `${quotesWithoutDash} sitatblokk(er) manglet sitatstrek; den er lagt til.`
    );
  }

  const leadSentences = countSakSentences(sakBlockPlainText(article.lead));
  if (leadSentences > SAK_MAX_LEAD_SENTENCES) {
    addIssue(
      issues,
      "SAK_LEAD_TOO_MANY_SENTENCES",
      "warning",
      `Leaden har ${leadSentences} setninger; maks ${SAK_MAX_LEAD_SENTENCES}.`
    );
  }

  const firstBlock = article.blocks[0];
  if (firstBlock?.kind === "subheading") {
    addIssue(
      issues,
      "SAK_SUBHEADING_AFTER_LEAD",
      "warning",
      "Første blokk etter leaden er en mellomtittel; skriv et avsnitt først."
    );
  }
  const firstParagraph = article.blocks.find((block) => block.kind === "paragraph");
  if (firstParagraph) {
    const plain = sakBlockPlainText(firstParagraph.text);
    if (BODY_OPENS_WITH_NUMBER_PATTERNS.some((pattern) => pattern.test(plain))) {
      addIssue(
        issues,
        "SAK_BODY_OPENS_WITH_NUMBER",
        "warning",
        "Første avsnitt i brødteksten åpner med et tall eller en dato; skriv betydningen først."
      );
    }
  }

  // (3) Length band.
  const visibleChars = countSakVisibleChars(article);
  const lengthBand = sakLengthBand(ctx.targetChars);
  if (visibleChars < lengthBand.min || visibleChars > lengthBand.max) {
    addIssue(
      issues,
      "SAK_LENGTH_OUT_OF_BAND",
      "warning",
      `Synlig tekst er ${visibleChars} tegn; målet er ${lengthBand.min}–${lengthBand.max}.`
    );
  }

  // (5) Numeric gate on title + lead + blocks against the ready materials.
  const visibleText = sakVisibleText(article);
  const numericSourceText = buildSakNumericSourceText(payload, {
    titleOverride: ctx.titleOverride
  });
  const numberAssessments = assessNumbersInText(visibleText, numericSourceText);
  const hardUnexpected = new Set<string>();
  const softUnexpected = new Set<string>();
  for (const assessment of numberAssessments) {
    if (assessment.disposition !== "unexpected") continue;
    if (assessment.candidateRuleId) {
      softUnexpected.add(assessment.display);
    } else {
      hardUnexpected.add(assessment.display);
    }
  }
  const unexpectedNumbers = [...hardUnexpected, ...softUnexpected];
  if (hardUnexpected.size > 0) {
    addIssue(
      issues,
      "SAK_UNEXPECTED_NUMBERS",
      "blocking",
      `Tall uten dekning i lest kildemateriale: ${[...hardUnexpected].join(", ")}. Fjern dem eller bruk tallet slik det står i kilden.`
    );
  }
  if (softUnexpected.size > 0) {
    addIssue(
      issues,
      "SAK_UNEXPECTED_NUMBERS_CANDIDATE",
      "warning",
      `Tall som bare kan utledes fra kildene: ${[...softUnexpected].join(", ")}.`
    );
  }

  // (6) Meta-source language in the copy.
  if (VISIBLE_ATTACHMENT_REFERENCE_PATTERNS.some((pattern) => pattern.test(visibleText))) {
    addIssue(
      issues,
      "VISIBLE_META_SOURCE_LANGUAGE",
      "blocking",
      "Teksten omtaler PDF, vedlegg, analysert materiale eller opplysninger som «ikke oppgitt»; slikt hører hjemme i desk_notes, ikke i saken."
    );
  }

  // (7) Model scaffolding leaking into the copy.
  const markerLeaks = detectMarkerLeaks(visibleText);
  if (markerLeaks.length > 0) {
    addIssue(
      issues,
      "MARKER_LEAK",
      "blocking",
      `Teksten inneholder interne markører: ${markerLeaks
        .map((match) => `${match.category}(${match.id})`)
        .join(", ")}.`
    );
  }

  // (8) Effect claims without attribution or hedging. A sitatstrek sentence
  // is attributed by form, so quote openers are left alone.
  const rewriteShape = sakArticleAsRewriteShape(article);
  const attributionRisks = findAttributionRisks(rewriteShape).filter(
    (risk) => !/^\s*[–—-]\s/.test(risk.sentence)
  );
  for (const risk of attributionRisks.slice(0, MAX_ATTRIBUTION_RISK_ISSUES)) {
    addIssue(
      issues,
      "ATTRIBUTION_RISK",
      "warning",
      `${risk.reason} Setning: «${risk.sentence.slice(0, 160)}»`
    );
  }

  // (9) Ledger: every quote has a span, every read material has a sources row.
  const quotesWithoutSpan = article.blocks.filter(
    (block) =>
      block.kind === "quote" &&
      !quoteHasSourceSpan(sakBlockPlainText(block.text), article.source_spans)
  ).length;
  if (quotesWithoutSpan > 0) {
    addIssue(
      issues,
      "SAK_QUOTE_WITHOUT_SOURCE_SPAN",
      "warning",
      `${quotesWithoutSpan} sitat(er) mangler original ordlyd i source_spans.`
    );
  }
  const listedSources = new Set(article.sources.map((source) => source.materialId));
  const readyIds = payload.materials
    .filter((material) => material.status === "ready")
    .map((material) => material.sourceId);
  const missingSources = readyIds.filter((sourceId) => !listedSources.has(sourceId));
  const unknownSources = [...listedSources].filter((sourceId) => !knownIds.has(sourceId));
  if (missingSources.length > 0 || unknownSources.length > 0) {
    const parts: string[] = [];
    if (missingSources.length > 0) {
      parts.push(`mangler innslag for ${missingSources.join(", ")}`);
    }
    if (unknownSources.length > 0) {
      parts.push(`viser til ukjent materiale ${unknownSources.join(", ")}`);
    }
    addIssue(issues, "SAK_SOURCE_LEDGER_INCOMPLETE", "warning", `sources ${parts.join("; ")}.`);
  }

  // (10) change_note: one line; the first draft always says so.
  if (ctx.isFirstDraft) {
    article.change_note = SAK_FIRST_DRAFT_CHANGE_NOTE;
  } else {
    article.change_note =
      normalizeChangeNote(article.change_note) || SAK_REVISION_CHANGE_NOTE_FALLBACK;
  }

  // (11) Revision instruction compliance against the previous version.
  let revisionCompliance: RevisionInstructionCompliance | null = null;
  if (!ctx.isFirstDraft && ctx.instruction?.trim()) {
    revisionCompliance = validateRevisionInstructionCompliance(rewriteShape, {
      instruction: ctx.instruction,
      previousOutput: ctx.previousArticle
        ? sakArticleAsRewriteShape(ctx.previousArticle)
        : undefined
    });
    for (const check of revisionCompliance?.checks ?? []) {
      if (check.passed) continue;
      // A remove_text target that is still in the copy is the one failure the
      // desk cannot accept silently; the other intents are judgement calls.
      const stillPresent = check.type === "remove_text" && /fortsatt/.test(check.message);
      addIssue(
        issues,
        "REVISION_INSTRUCTION_COMPLIANCE",
        stillPresent ? "blocking" : "warning",
        check.message
      );
    }
  }

  const blockingErrors = issues
    .filter((issue) => issue.severity === "blocking")
    .map((issue) => issue.message);
  const warnings = issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.message);

  return {
    article,
    issues,
    blockingErrors,
    warnings,
    visibleChars,
    lengthBand,
    numberAssessments,
    unexpectedNumbers,
    markerLeaks,
    revisionCompliance
  };
}

/**
 * Instruction for the single repair pass: the blocking messages, nothing
 * else, so the model changes only what the validator objected to.
 */
export function buildSakRepairInstruction(issues: SakValidationIssue[]): string {
  const lines = issues
    .filter((issue) => issue.severity === "blocking")
    .map((issue) => `- ${issue.message}`);
  return [
    "KORRIGERINGSMODUS: Rett bare feilene under. Behold alt annet uendret: vinkel, rekkefølge, lenker, sitater, sources, excluded_hype og desk_notes.",
    ...lines,
    "Returner hele JSON-strukturen. change_note: «Korrigert etter validering»."
  ].join("\n");
}

export function sakValidationJson(
  result: SakValidationResult,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    valid: result.issues.length === 0,
    errorCode:
      result.blockingErrors.length > 0
        ? "BLOCKING_VALIDATION_ERRORS"
        : result.issues.length > 0
          ? "NON_BLOCKING_VALIDATION_WARNINGS"
          : null,
    issues: result.issues,
    blockingErrors: result.blockingErrors,
    warnings: result.warnings,
    visibleChars: result.visibleChars,
    lengthBand: result.lengthBand,
    unexpectedNumbers: result.unexpectedNumbers,
    numberAssessments: result.numberAssessments.filter(
      (assessment) => assessment.disposition === "unexpected"
    ),
    markerLeaks: result.markerLeaks,
    revisionCompliance: result.revisionCompliance,
    ...extra
  };
}
