import {
  assessNumbers,
  assessNumbersInText,
  formatNorwegianNoticeDate,
  isRelatedNoticeTimestampValid,
  unexpectedNumberDisplays,
  type AssessNumbersOptions,
  type NumberAssessment,
  type NumberDerivationRuleId,
  type PromptPayload
} from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { normalizeNoticeNumericRanges } from "./notice-numeric-ranges.js";

const MAX_ALLOWED_UNEXPECTED_NUMBERS = 0;
export const MAX_TITLE_WORDS = 8;
const MAX_SUMMARY_SENTENCES = 15;
const MAX_VISIBLE_ARTICLE_CHARS = 1000;

export const VISIBLE_ATTACHMENT_REFERENCE_PATTERNS = [
  /\bpdf(?:-en)?\b/i,
  /\bvedlegg(?:et|ene)?\b/i,
  /\bvedlagt(?:e)?\s+skjema\b/i,
  /\bi vedlegget\b/i,
  /\brapportkontekst(?:en)?\b/i,
  /\banalysert(?:e)?\s+(?:tekst(?:en)?|materiale(?:t)?|rapportkontekst(?:en)?)\b/i,
  /\bden\s+analyserte\s+(?:teksten|rapportkonteksten|materialet)\b/i,
  /\bikke\s+(?:er\s+)?oppgitt\b/i,
  /\bikke\s+opplyst\b/i
];

const CRITICISM_PATTERNS = [
  /\banklag/i,
  /\bbeskyld/i,
  /\bkritiser/i,
  /\bgransk/i,
  /\bs[øo]ksm[åa]l/i,
  /\bstraffbar/i,
  /\btiltal/i,
  /\baccus/i,
  /\balleg/i,
  /\binvestigat/i,
  /\bfraud/i,
  /\bbribery/i,
  /\bcorruption/i,
  /\blawsuit/i,
  /\bcriminal/i
];

const REPLY_PATTERNS = [
  /\bavvis/i,
  /\bbestrid/i,
  /\buenig/i,
  /\bnekter/i,
  /\bbenekt/i,
  /\buskyldig/i,
  /\bdeni(?:es|ed|al)?\b/i,
  /\bdisput(?:e|es|ed|ing)\b/i,
  /\breject(?:s|ed|ing)?\b/i,
  /\bcontest(?:s|ed|ing)?\b/i,
  /\brefut(?:e|es|ed|ing)\b/i,
  /\bnot guilty\b/i
];

const REVENUE_PATTERNS = [
  /\binntekter?\b/i,
  /\bomsetning(?:en)?\b/i,
  /\brevenues?\b/i,
  /\bturnover\b/i,
  /\bsales\b/i
];

const RESULT_PATTERNS = [
  /\bresultat(?:et|er|ene)?\b/i,
  /\boverskudd(?:et)?\b/i,
  /\btap(?:et|ene)?\b/i,
  /\bprofits?\b/i,
  /\bloss(?:es)?\b/i,
  /\bearnings\b/i,
  /\bnet income\b/i,
  /\boperating income\b/i,
  /\bebit(?:da)?\b/i
];

const REPORT_NOTICE_PATTERNS = [
  /\b(?:annual|interim|quarterly|financial)\s+report\b/i,
  /\bq[1-4]\s+(?:fy)?\d{2,4}\s+(?:report|presentation)\b/i,
  /\b(?:årsrapport|arsrapport|årsmelding|arsmelding|kvartalsrapport|delårsrapport|halvårsrapport)\b/i,
  /\u00e5rsrapport|\u00e5rsmelding|del\u00e5rsrapport|halv\u00e5rsrapport/i
];

const GENERIC_REPORT_PUBLICATION_PATTERNS = [
  /\b(?:publiserer|publisert|offentliggjort|released|published)\b.{0,90}\b(?:rapport|årsrapport|årsmelding|annual report|interim report|quarterly report)\b/i,
  /\b(?:rapport|årsrapport|årsmelding|annual report|interim report|quarterly report)\b.{0,90}\b(?:publiserer|publisert|offentliggjort|released|published)\b/i,
  /\b(?:publiserer|publisert|offentliggjort|released|published)\b.{0,90}(?:\u00e5rsrapport|\u00e5rsmelding)/i,
  /(?:\u00e5rsrapport|\u00e5rsmelding).{0,90}\b(?:publiserer|publisert|offentliggjort|released|published)\b/i,
  /\b(?:har|med|sender|legger frem|lagt frem)\b.{0,70}\b(?:rapport|arsrapport|annual report|interim report|quarterly report)\b/i,
  /\b(?:rapport|arsrapport|annual report|interim report|quarterly report)\b.{0,70}\b(?:folger|vedlagt|omtales|tilgjengelig|available)\b/i,
  /\b(?:viser til|omtaler)\b.{0,80}\b(?:rapport|arsrapport|annual report|interim report|quarterly report)\b/i,
  /\b(?:har|med|sender|legger frem|lagt frem)\b.{0,70}(?:\u00e5rsrapport|\u00e5rsmelding|del\u00e5rsrapport|halv\u00e5rsrapport)\b/i,
  /(?:\u00e5rsrapport|\u00e5rsmelding|del\u00e5rsrapport|halv\u00e5rsrapport).{0,70}\b(?:f\u00f8lger|folger|vedlagt|omtales|tilgjengelig|available)\b/i
];

const CONCRETE_REPORT_FACT_PATTERNS = [
  /\b(?:inntekter|omsetning|revenue|revenues|sales)\b.{0,90}\d/i,
  /\b(?:resultat|overskudd|tap|profit|loss|earnings|ebit|ebitda)\b.{0,90}\d/i,
  /\b(?:kontantstrøm|kontantstrom|cash flow|guiding|utsikter|outlook|utbytte|dividend)\b.{0,90}\d/i,
  /\d.{0,50}\b(?:million|millioner|milliard|milliarder|kroner|dollar|euro|prosent|percent)\b/i
];

const VISIBLE_NUMBER_PATTERN =
  /\b\d{1,3}(?:[ .]\d{3})*(?:,\d+)?\b|\b\d+(?:,\d+)?\b/g;

const REPORT_LIMITATION_PATTERNS = [
  /\b(?:utdrag|avkortet|begrenset|bare deler|ikke fullstendig)\b/i,
  /\b(?:analysert|analysegrunnlag|kildegrunnlag|ekstra kildetekst)\b/i,
  /\b(?:ikke oppgitt|ikke funnet|mangler|uklar|uklart|ikke inkludert)\b/i
];

const DEFAULT_REPORT_SOURCE_LIMITATION =
  "Ekstra kildetekst er analysert som begrenset kildegrunnlag.";

const DATE_MONTH_PATTERN =
  /^\.\s*(?:jan(?:uar)?|feb(?:ruar)?|mars|apr(?:il)?|mai|jun(?:i)?|jul(?:i)?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

const JARGON_GUARDRAILS: Array<{
  code: string;
  pattern: RegExp;
  explanationPattern?: RegExp;
  explanationWindowChars?: number;
  message: string;
}> = [
  {
    code: "UNEXPLAINED_PROFORMA",
    pattern: /\bpro[\s-]?forma\b/i,
    explanationPattern: /\b(?:som om|justert|sammenlign|hypotetisk)\b/i,
    message: "Visible article text uses proforma/pro forma without reader context."
  },
  {
    code: "UNEXPLAINED_EBITDA",
    pattern: /\bebitda\b/i,
    explanationPattern: /\b(?:før|for)\s+renter,\s*skatt,\s*av- og nedskrivninger\b/i,
    message: "Visible article text uses ebitda without the full result-measure context."
  },
  {
    code: "UNEXPLAINED_LOAN_CHANGES",
    pattern: /\bl[åa]neendringer\b/i,
    explanationPattern: /\b(?:utsetter|forfall|vilkår|vilkar|gjeld|frist|likviditet)\b/i,
    message: "Visible article text uses låneendringer without saying concretely what changes."
  },
  {
    code: "UNEXPLAINED_NAMED_TRANSACTION",
    pattern:
      /\b[A-ZÆØÅ][A-Za-zÆØÅæøå0-9-]+-(?:transaksjonen|plattformen|avtalen|prosjektet|programmet|løsningen)\b/,
    explanationPattern:
      /\b(?:gjelder|handler om|knyttet til|er|var|som)\b.{0,80}\b(?:kj[oø]p(?:et)?|salg(?:et)?|transaksjon(?:en)?|handel(?:en)?|oppkj[oø]p(?:et)?|programvare(?:plattform)?|plattform|produkt|prosjekt|avtale|l[oø]sning|system|teknologi|tjeneste|anlegg|samarbeid)\b/i,
    explanationWindowChars: 160,
    message:
      "Visible article text names a transaction, platform, project, or other source-specific label without explaining what it is."
  }
];

// P4 marker-leak detector (shadow-first). Seeded by message 675713, whose
// published-challenger body leaked raw model scaffolding into visible
// Norwegian copy. Patterns deliberately tolerate glued tokens (the real leak
// read "numerusformassistant to=system?"), and only category + pattern id
// ever reach issue messages or logs — never the matched text.
export type MarkerLeakCategory =
  | "role_marker"
  | "reasoning_spill"
  | "instruction_echo"
  | "serialization_fragment"
  | "foreign_script_spam";

export type MarkerLeakMatch = { category: MarkerLeakCategory; id: string };

const MARKER_LEAK_GUARDRAILS: Array<{
  category: MarkerLeakCategory;
  id: string;
  pattern: RegExp;
}> = [
  // No leading \b: leaks arrive glued to preceding text. "assistant" alone
  // never fires (Norwegian is "assistent"; English quotes lack the =).
  { category: "role_marker", id: "assistant_to_role", pattern: /assistant\s+to=\w+/i },
  {
    category: "role_marker",
    id: "chatml_token",
    pattern: /<\|(?:im_start|im_end|assistant|system|user|end)\|>/i
  },
  {
    category: "role_marker",
    id: "assistant_channel",
    pattern: /assistant(?:final|analysis|commentary)/i
  },
  // Case-sensitive English planning voice, anchored to generation machinery
  // nouns only: quoted executive English ("We need to identify further cost
  // reductions") must never fire, so business verbs stay out of the list.
  {
    category: "reasoning_spill",
    id: "we_need_meta",
    pattern:
      /\b(?:We|I)\s+(?:need|should|must)\b[^.!?]{0,80}\b(?:JSON|schema|prompt|malformed)\b/
  },
  {
    category: "reasoning_spill",
    id: "last_assistant_answer",
    pattern: /\b(?:last|previous)\s+assistant\s+(?:answer|message|response)\b/i
  },
  {
    category: "instruction_echo",
    id: "ensure_field_max",
    pattern: /\bEnsure\s+(?:title|lead|body)\s+max\s+\d+\b/i
  },
  {
    category: "instruction_echo",
    id: "field_word_budget",
    pattern: /\b(?:title|lead|body)\s*(?:max|<=)\s*\d+\s*(?:words?|ord)?\s*:/i
  },
  {
    category: "serialization_fragment",
    id: "schema_key_kv",
    pattern: /"?(?:confidence|importance|source_spans|key_facts|company_sentence)"\s*:\s*"/
  },
  // The quote after the key is mandatory: plain prose "confidence: high"
  // in quoted English must not fire.
  {
    category: "serialization_fragment",
    id: "confidence_level_kv",
    pattern: /confidence"\s*:\s*"?(?:high|medium|low)\b/i
  },
  // 4+ for both scripts so a short quoted brand name (华为, 삼성, 네이버)
  // does not trip on its own; bracket debris must be an adjacent pair, since
  // a single 【 can appear in a legitimately quoted Asian press-release title.
  {
    category: "foreign_script_spam",
    id: "cjk_run",
    pattern: /[一-鿿㐀-䶿]{4,}/
  },
  {
    category: "foreign_script_spam",
    id: "hangul_run",
    pattern: /[가-힯]{4,}/
  },
  {
    category: "foreign_script_spam",
    id: "fullwidth_bracket",
    pattern: /[【】]{2,}/
  }
];

export function detectMarkerLeaks(visibleText: string): MarkerLeakMatch[] {
  return MARKER_LEAK_GUARDRAILS.filter((guardrail) =>
    guardrail.pattern.test(visibleText)
  ).map((guardrail) => ({ category: guardrail.category, id: guardrail.id }));
}

// The release surface for the marker detector. While severity is "warning"
// the detector is fully shadow: matches persist only as the markerLeaks
// telemetry field and NO issue is added, so valid/errorCode series are
// untouched (mirrors the P2 candidateRuleId pattern). Promotion = flip to
// { code: "MARKER_LEAK", severity: "blocking" } + refresh fixture
// expectations in the same commit. Deliberately NOT routed through the
// high-risk repair ladder: a marker leak means the generation went off the
// rails, so enforcement is an immediate block (owner decision 2026-08-17).
export type MarkerLeakEnforcement = {
  code: "MARKER_LEAK_SHADOW" | "MARKER_LEAK";
  severity: RewriteValidationSeverity;
};

export const markerLeakEnforcement: MarkerLeakEnforcement = {
  code: "MARKER_LEAK_SHADOW",
  severity: "warning"
};

const CURRENCY_MARKER_GROUPS: Array<{
  label: string;
  patterns: RegExp[];
}> = [
  {
    label: "NOK/kroner",
    patterns: [
      /\bNOK\b/,
      /\bnok\s+(?=\d)/,
      /\d\s+nok\b/,
      /\b(?:tnok|knok|mnok|bnok)\b/i,
      /\bkr\b/i,
      /\bnorske kroner\b/i,
      /(?<!svenske )(?<!danske )\bkron(?:e|er)\b/i
    ]
  },
  {
    label: "USD/dollar",
    patterns: [
      /\busd\b/i,
      /\b(?:tusd|kusd|musd|busd)\b/i,
      /\bdollars?\b/i,
      /\$|＄/i
    ]
  },
  {
    label: "EUR/euro",
    patterns: [
      /\beur\b/i,
      /\b(?:teur|keur|meur|beur)\b/i,
      /\beuros?\b/i,
      /€/i
    ]
  },
  {
    label: "GBP/pund",
    patterns: [
      /\bgbp\b/i,
      /\b(?:tgbp|kgbp|mgbp|bgbp)\b/i,
      /\bpund\b/i,
      /\bpounds?\b/i,
      /£/i
    ]
  },
  {
    label: "SEK/svenske kroner",
    patterns: [
      /\bsek\b/i,
      /\b(?:tsek|ksek|msek|bsek)\b/i,
      /\bsvenske kroner\b/i,
      /\bswedish kronor\b/i
    ]
  },
  {
    label: "DKK/danske kroner",
    patterns: [
      /\bdkk\b/i,
      /\b(?:tdkk|kdkk|mdkk|bdkk)\b/i,
      /\bdanske kroner\b/i,
      /\bdanish kroner\b/i
    ]
  }
];

const KEY_PERSON_ROLE_SOURCE =
  "(?:CEO|CFO|chief executive|konsernsjef|toppsjef|finansdirekt(?:ør|or|Ã¸r)|styreleder|prim(?:ær|aer|Ã¦r)innsider|administrerende\\s+direkt(?:ør|or|Ã¸r))";
const ATTRIBUTION_VERB_SOURCE =
  "(?:sier|skriver|opplyser|uttaler|mener|peker\\s+p(?:å|a|Ã¥)|says?|said|comments?|commented|states?|stated)";
const SOURCE_QUOTE_MARK_SOURCE =
  "(?:\"[^\"]{8,}\"|'[^']{8,}'|“[^”]{8,}”|«[^»]{8,}»|Â«[^Â»]{8,}Â»)";

const KEY_PERSON_ROLE_PATTERN = new RegExp(KEY_PERSON_ROLE_SOURCE, "i");
const DRAFT_STANDALONE_DASH_QUOTE_PATTERN = new RegExp(
  `(?:^|\\n)\\s*–\\s+[\\s\\S]{8,}?\\b${ATTRIBUTION_VERB_SOURCE}\\b`,
  "i"
);
const INLINE_GUILLEMETS_PATTERN = /«[^»]{8,}»|Â«[^Â»]{8,}Â»/;
const INLINE_GUILLEMETS_GLOBAL_PATTERN = /«([^»]{8,})»|Â«([^Â»]{8,})Â»/g;
const DRAFT_NAMED_PERSON_ATTRIBUTION_PATTERNS = [
  new RegExp(
    `${KEY_PERSON_ROLE_SOURCE}[\\s\\S]{0,120}\\b${ATTRIBUTION_VERB_SOURCE}\\b`,
    "i"
  ),
  new RegExp(
    `\\b${ATTRIBUTION_VERB_SOURCE}\\b[\\s\\S]{0,120}${KEY_PERSON_ROLE_SOURCE}`,
    "i"
  )
];
const SOURCE_NAMED_QUOTE_LIKE_PATTERNS = [
  new RegExp(
    `${KEY_PERSON_ROLE_SOURCE}[\\s\\S]{0,180}(?:${ATTRIBUTION_VERB_SOURCE}|${SOURCE_QUOTE_MARK_SOURCE})`,
    "i"
  ),
  new RegExp(
    `(?:${ATTRIBUTION_VERB_SOURCE}|${SOURCE_QUOTE_MARK_SOURCE})[\\s\\S]{0,180}${KEY_PERSON_ROLE_SOURCE}`,
    "i"
  )
];

export type RewriteValidationSeverity = "blocking" | "warning";

export type RewriteValidationIssue = {
  code: string;
  severity: RewriteValidationSeverity;
  message: string;
};

export type QuoteTelemetry = {
  sourceContainsNamedQuoteLikePattern: boolean;
  draftContainsStandaloneDashQuote: boolean;
  draftContainsInlineGuillemets: boolean;
  draftContainsNamedPersonAttribution: boolean;
  draftSourceSpansMentionQuoteSpeaker: boolean;
};

export type ReportExtractionValidationContext = {
  metrics?: unknown[];
  metricCandidates?: unknown[];
  diagnostics?: {
    fallbackUsed?: boolean;
    incomeStatementFound?: boolean;
    openAIPdfFallback?: boolean;
  };
};

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  const matches = trimmed.match(/[.!?](?=\s|$)/g);
  if (!matches || matches.length === 0) {
    return 1;
  }

  return matches.length;
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean).length;
}

export function countSummarySentences(rewrite: RewriteOutput): number {
  return [rewrite.lead, ...rewrite.body].reduce(
    (total, part) => total + countSentences(part),
    0
  );
}

export function collectVisibleArticleFields(rewrite: RewriteOutput): string[] {
  return [rewrite.title, rewrite.lead, ...rewrite.body];
}

export function visibleArticleText(rewrite: RewriteOutput): string {
  return collectVisibleArticleFields(rewrite).join("\n");
}

export function countVisibleArticleChars(rewrite: RewriteOutput): number {
  return [rewrite.lead, ...rewrite.body].join("\n\n").length;
}

export function buildValidationSourceText(payload: PromptPayload): string {
  return [
    payload.title,
    payload.issuerName,
    payload.issuerSign,
    payload.publishedAt,
    payload.categories.join(", "),
    payload.markets.join(", "),
    payload.bodyText,
    payload.pdfSupplementText ?? "",
    ...(payload.supplementalMaterials ?? []).map((material) =>
      [
        `[${material.sourceId}] ${material.title}`,
        material.url ?? "",
        material.text
      ].join("\n")
    )
  ].join("\n");
}

/** Text of auto-attached related notices only (empty when none). */
export function buildRelatedNoticesSourceText(payload: PromptPayload): string {
  return (payload.relatedNotices ?? [])
    .map((notice) =>
      [`[prior_${notice.messageId}] ${notice.title}`, notice.text].join("\n")
    )
    .join("\n");
}

/**
 * Source text for the numeric and currency gates only. Related notices are
 * legitimate sources for figures the article labels as background, but they
 * must stay out of buildValidationSourceText: that string also drives quote
 * opportunities, right-of-reply and revenue/result checks, which would then
 * demand content from the old notice.
 */
export function buildNumericValidationSourceText(payload: PromptPayload): string {
  return [buildValidationSourceText(payload), buildRelatedNoticesSourceText(payload)]
    .filter(Boolean)
    .join("\n");
}

type NumericSourceDate = { sourceId: string; date: string };

function noticeNumericSourceDates(payload: PromptPayload): NumericSourceDate[] {
  return [
    { sourceId: "primary", publishedAt: payload.publishedAt },
    ...(payload.relatedNotices ?? [])
      .filter(notice => notice.text.trim() && isRelatedNoticeTimestampValid(notice.publishedAt, payload.publishedAt))
      .map(notice => ({ sourceId: `prior_${notice.messageId}`, publishedAt: notice.publishedAt }))
  ].filter(source => Number.isFinite(new Date(source.publishedAt).getTime()))
    .map(source => ({ sourceId: source.sourceId, date: formatNorwegianNoticeDate(source.publishedAt).replace(/^\S+\s+/, "") }));
}

function assessNoticeNumbersInText(
  text: string,
  sourceText: string,
  dates: readonly NumericSourceDate[],
  options?: AssessNumbersOptions
): NumberAssessment[] {
  const dateAssessments: NumberAssessment[] = [];
  let nonDateText = text;
  for (const source of dates) {
    const phrase = source.date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ \\t]+");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}.,+\\-−])${phrase}(?![\\p{L}\\p{N}]|[.,]\\d)`, "giu");
    nonDateText = nonDateText.replace(pattern, match => {
      // Only this complete source-bound date is backed by the timestamp.
      // Its day/year never enter the general source pool: an unrelated
      // amount using the same number must still be checked independently.
      dateAssessments.push(...assessNumbersInText(source.date, source.date, options).map(assessment => ({
        ...assessment, provenance: { ...assessment.provenance, sourceId: source.sourceId, sourceDate: source.date }
      })));
      return match.replace(/\d/g, " ");
    });
  }
  return [
    ...assessNumbersInText(normalizeNoticeNumericRanges(nonDateText), normalizeNoticeNumericRanges(sourceText), options),
    ...dateAssessments
  ];
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function matchingPatterns(text: string, patterns: RegExp[]): string[] {
  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
}

function addIssue(
  issues: RewriteValidationIssue[],
  code: string,
  severity: RewriteValidationSeverity,
  message: string
): void {
  issues.push({ code, severity, message });
}

function normalizeQuoteEvidenceText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøåÃ¦Ã¸Ã¥]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inlineGuillemetsTexts(text: string): string[] {
  return [...text.matchAll(INLINE_GUILLEMETS_GLOBAL_PATTERN)]
    .map((match) => match[1] ?? match[2] ?? "")
    .map((value) => value.trim())
    .filter((value) => value.length >= 8);
}

function sourceSpansContainInlineQuoteEvidence(
  rewrite: RewriteOutput,
  visibleText: string
): boolean {
  const sourceSpansText = rewrite.source_spans.join("\n");
  if (INLINE_GUILLEMETS_PATTERN.test(sourceSpansText)) {
    return true;
  }

  const normalizedSpans = normalizeQuoteEvidenceText(sourceSpansText);
  for (const quoted of inlineGuillemetsTexts(visibleText)) {
    const normalizedQuote = normalizeQuoteEvidenceText(quoted);
    if (normalizedQuote.length >= 8 && normalizedSpans.includes(normalizedQuote)) {
      return true;
    }

    const quoteTokens = normalizedQuote
      .split(" ")
      .filter((token) => token.length >= 4);
    if (
      quoteTokens.length >= 2 &&
      quoteTokens.filter((token) => normalizedSpans.includes(token)).length >= 2
    ) {
      return true;
    }
  }

  return false;
}

function sourceSpansContainQuoteEvidence(
  rewrite: RewriteOutput,
  visibleText: string,
  telemetry: QuoteTelemetry
): boolean {
  const sourceSpansText = rewrite.source_spans.join("\n");
  return (
    telemetry.draftSourceSpansMentionQuoteSpeaker ||
    DRAFT_STANDALONE_DASH_QUOTE_PATTERN.test(sourceSpansText) ||
    sourceSpansContainInlineQuoteEvidence(rewrite, visibleText)
  );
}

export function collectQuoteTelemetry(
  rewrite: RewriteOutput,
  payload: PromptPayload
): QuoteTelemetry {
  const sourceText = buildValidationSourceText(payload);
  const visibleText = visibleArticleText(rewrite);
  const sourceSpansText = rewrite.source_spans.join("\n");

  return {
    sourceContainsNamedQuoteLikePattern: hasAnyPattern(
      sourceText,
      SOURCE_NAMED_QUOTE_LIKE_PATTERNS
    ),
    draftContainsStandaloneDashQuote:
      DRAFT_STANDALONE_DASH_QUOTE_PATTERN.test(visibleText),
    draftContainsInlineGuillemets: INLINE_GUILLEMETS_PATTERN.test(visibleText),
    draftContainsNamedPersonAttribution: hasAnyPattern(
      visibleText,
      DRAFT_NAMED_PERSON_ATTRIBUTION_PATTERNS
    ),
    draftSourceSpansMentionQuoteSpeaker:
      KEY_PERSON_ROLE_PATTERN.test(sourceSpansText)
  };
}

function findUnexpectedCurrencyMarkers(
  rewrite: RewriteOutput,
  sourceText: string
): string[] {
  const visibleText = visibleArticleText(rewrite);
  return CURRENCY_MARKER_GROUPS.filter(
    (group) =>
      hasAnyPattern(visibleText, group.patterns) &&
      !hasAnyPattern(sourceText, group.patterns)
  ).map((group) => group.label);
}

function sourceRequiresRightOfReply(sourceText: string): boolean {
  return (
    hasAnyPattern(sourceText, CRITICISM_PATTERNS) &&
    hasAnyPattern(sourceText, REPLY_PATTERNS)
  );
}

function visibleArticleIncludesRightOfReply(rewrite: RewriteOutput): boolean {
  return hasAnyPattern(visibleArticleText(rewrite), REPLY_PATTERNS);
}

function hasRevenueResultMixupRisk(
  rewrite: RewriteOutput,
  sourceText: string
): boolean {
  return (
    hasAnyPattern(sourceText, REVENUE_PATTERNS) &&
    !hasAnyPattern(sourceText, RESULT_PATTERNS) &&
    hasAnyPattern(visibleArticleText(rewrite), RESULT_PATTERNS)
  );
}

function isReportLikePayload(payload: PromptPayload): boolean {
  return hasAnyPattern(
    [payload.title, payload.categories.join(" "), payload.bodyText].join("\n"),
    REPORT_NOTICE_PATTERNS
  );
}

function isGenericReportPublicationRewrite(
  rewrite: RewriteOutput,
  payload: PromptPayload
): boolean {
  if (!isReportLikePayload(payload)) {
    return false;
  }

  const titleAndLead = [rewrite.title, rewrite.lead].join("\n");
  if (!hasAnyPattern(titleAndLead, GENERIC_REPORT_PUBLICATION_PATTERNS)) {
    return false;
  }

  const visibleBody = [rewrite.lead, ...rewrite.body].join("\n");
  return !hasAnyPattern(visibleBody, CONCRETE_REPORT_FACT_PATTERNS);
}

function hasReportContext(
  payload: PromptPayload,
  reportExtraction?: ReportExtractionValidationContext
): boolean {
  return (
    reportExtraction != null ||
    Boolean(payload.pdfSupplementText?.trim()) ||
    (payload.hasAttachments && isReportLikePayload(payload))
  );
}

function hasReportSourceLimitation(rewrite: RewriteOutput): boolean {
  const limitationText = rewrite.source_limitations.join("\n");
  return (
    limitationText.trim().length > 0 &&
    hasAnyPattern(limitationText, REPORT_LIMITATION_PATTERNS)
  );
}

export function ensureReportSourceLimitation(
  rewrite: RewriteOutput,
  payload: PromptPayload,
  reportExtraction?: ReportExtractionValidationContext
): RewriteOutput {
  if (!hasReportContext(payload, reportExtraction) || hasReportSourceLimitation(rewrite)) {
    return rewrite;
  }

  return {
    ...rewrite,
    source_limitations: [
      ...rewrite.source_limitations,
      DEFAULT_REPORT_SOURCE_LIMITATION
    ]
  };
}

function isWeakReportExtraction(
  reportExtraction?: ReportExtractionValidationContext
): boolean {
  if (!reportExtraction) {
    return false;
  }

  const metricCount =
    reportExtraction.metricCandidates?.length ??
    reportExtraction.metrics?.length ??
    0;
  const diagnostics = reportExtraction.diagnostics;
  return (
    metricCount === 0 &&
    diagnostics?.incomeStatementFound !== true &&
    (diagnostics?.fallbackUsed === true ||
      diagnostics?.openAIPdfFallback === true)
  );
}

function normalizeVisibleNumberToken(token: string): string | null {
  const normalized = token.replace(/[ .]/g, "").replace(",", ".");
  if (!/\d/.test(normalized)) return null;
  if (/^(?:19|20)\d{2}$/.test(normalized)) return null;
  return normalized;
}

function isDateDayNumber(field: string, index: number, rawToken: string): boolean {
  if (!/^\d{1,2}$/.test(rawToken.trim())) {
    return false;
  }
  return DATE_MONTH_PATTERN.test(field.slice(index + rawToken.length));
}

function repeatedVisibleNumbers(rewrite: RewriteOutput): string[] {
  const counts = new Map<string, number>();
  for (const field of [rewrite.lead, ...rewrite.body]) {
    for (const match of field.matchAll(VISIBLE_NUMBER_PATTERN)) {
      if (match.index != null && isDateDayNumber(field, match.index, match[0])) {
        continue;
      }
      const normalized = normalizeVisibleNumberToken(match[0]);
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([value]) => value)
    .sort();
}

function jargonGuardrailIssues(rewrite: RewriteOutput): Array<{
  code: string;
  message: string;
}> {
  const visibleText = visibleArticleText(rewrite);
  return JARGON_GUARDRAILS.filter((guardrail) => {
    const flags = guardrail.pattern.flags.includes("g")
      ? guardrail.pattern.flags
      : `${guardrail.pattern.flags}g`;
    const matcher = new RegExp(guardrail.pattern.source, flags);

    for (const match of visibleText.matchAll(matcher)) {
      if (!guardrail.explanationPattern) {
        return true;
      }
      const matchIndex = match.index ?? 0;
      const explanationScope =
        guardrail.explanationWindowChars == null
          ? visibleText
          : visibleText.slice(
              matchIndex,
              matchIndex + guardrail.explanationWindowChars
            );
      if (!guardrail.explanationPattern.test(explanationScope)) {
        return true;
      }
    }
    return false;
  }).map((guardrail) => ({
    code: guardrail.code,
    message: guardrail.message
  }));
}

export function validateRewriteOutput(
  rewrite: RewriteOutput,
  payload: PromptPayload,
  options?: {
    // Comparison-only opt-in; legacy and Sak numeric behavior is unchanged.
    noticeSemantics?: boolean;
    maxVisibleArticleChars?: number;
    reportExtraction?: ReportExtractionValidationContext;
    // Kill-switch passthrough only; when absent the engine uses the code
    // default (defaultEnabledDerivationRules), which is what CI gates replay.
    enabledDerivationRules?: readonly NumberDerivationRuleId[];
    // Same passthrough pattern for the marker detector; absent = the code
    // default (markerLeakEnforcement).
    markerLeakEnforcement?: MarkerLeakEnforcement;
  }
): {
  valid: boolean;
  errors: string[];
  issues: RewriteValidationIssue[];
  blockingErrors: string[];
  warnings: string[];
  quoteTelemetry: QuoteTelemetry;
  numberAssessments: NumberAssessment[];
  publicationNumberAssessments: NumberAssessment[];
  markerLeaks: MarkerLeakMatch[];
} {
  const issues: RewriteValidationIssue[] = [];
  const validationSourceText = buildValidationSourceText(payload);
  const numericValidationSourceText = buildNumericValidationSourceText(payload);
  const visibleText = visibleArticleText(rewrite);
  const quoteTelemetry = collectQuoteTelemetry(rewrite, payload);
  const maxVisibleArticleChars =
    options?.maxVisibleArticleChars ?? MAX_VISIBLE_ARTICLE_CHARS;

  const numberAssessmentOptions = options?.enabledDerivationRules
    ? { enabledDerivationRules: options.enabledDerivationRules }
    : undefined;
  const sourceDates = options?.noticeSemantics ? noticeNumericSourceDates(payload) : [];
  const assessNumericText = (text: string, source: string, dates: readonly NumericSourceDate[] = sourceDates) =>
    options?.noticeSemantics
      ? assessNoticeNumbersInText(text, source, dates, numberAssessmentOptions)
      : assessNumbersInText(text, source, numberAssessmentOptions);
  // Keep the full-output assessment for telemetry, but only publication
  // fields may stop publication. Hidden planning/provenance fields are model
  // metadata and are neither rendered nor an editorial claim to the reader.
  const numberAssessments = options?.noticeSemantics
    ? assessNumericText(JSON.stringify(rewrite), numericValidationSourceText)
    : assessNumbers(rewrite, numericValidationSourceText, numberAssessmentOptions);
  // Dates and arithmetic context must belong to the actual visible field.
  // Joining paragraphs can invent a source-backed date from an amount at
  // one paragraph's end and a month/year at the next paragraph's start.
  const publicationNumberAssessments = options?.noticeSemantics
    ? collectVisibleArticleFields(rewrite).flatMap(field => assessNumericText(field, numericValidationSourceText))
    : assessNumericText(visibleText, numericValidationSourceText);
  const numberErrors = unexpectedNumberDisplays(
    publicationNumberAssessments
  );
  if (numberErrors.length > MAX_ALLOWED_UNEXPECTED_NUMBERS) {
    addIssue(
      issues,
      "UNEXPECTED_NUMBERS",
      "warning",
      `Unexpected numbers: ${numberErrors.join(", ")}`
    );
  }

  if (collectVisibleArticleFields(rewrite).some((field) => field.includes("%"))) {
    addIssue(
      issues,
      "VISIBLE_PERCENT_SIGN",
      "warning",
      "Visible article text uses %, write prosent instead."
    );
  }

  const visibleMetaPatterns = matchingPatterns(
    visibleText,
    VISIBLE_ATTACHMENT_REFERENCE_PATTERNS
  );
  if (visibleMetaPatterns.length > 0) {
    addIssue(
      issues,
      "VISIBLE_META_SOURCE_LANGUAGE",
      "blocking",
      "Visible article text refers to PDF/attachments, analyzed material, or missing source data; move limitations to source_limitations."
    );
  }

  const activeMarkerEnforcement =
    options?.markerLeakEnforcement ?? markerLeakEnforcement;
  const markerLeaks = detectMarkerLeaks(visibleText);
  // Shadow neutrality: while the detector is at warning severity, matches
  // reach only the markerLeaks result field — adding even a warning issue
  // would flip valid/errorCode for otherwise-clean runs and contaminate the
  // series the promotion decision reads.
  if (markerLeaks.length > 0 && activeMarkerEnforcement.severity === "blocking") {
    addIssue(
      issues,
      activeMarkerEnforcement.code,
      activeMarkerEnforcement.severity,
      `Visible article text contains internal marker leakage: ${markerLeaks
        .map((match) => `${match.category}(${match.id})`)
        .join(", ")}.`
    );
  }

  if (isGenericReportPublicationRewrite(rewrite, payload)) {
    addIssue(
      issues,
      "GENERIC_REPORT_PUBLICATION",
      "blocking",
      "Report notice was rewritten as a generic report-publication story without concrete report facts."
    );
  }

  const reportContext = hasReportContext(payload, options?.reportExtraction);
  const reportSourceLimitation = hasReportSourceLimitation(rewrite);
  if (reportContext && !reportSourceLimitation) {
    addIssue(
      issues,
      "MISSING_REPORT_SOURCE_LIMITATION",
      "warning",
      "Report/PDF-based rewrite must include a source_limitations note that explains the excerpted or limited source basis."
    );
  }

  if (
    isWeakReportExtraction(options?.reportExtraction) &&
    rewrite.source_limitations.length > 0 &&
    !reportSourceLimitation
  ) {
    addIssue(
      issues,
      "WEAK_REPORT_EXTRACTION_LIMITATION",
      "warning",
      "Weak report/PDF extraction without structured metrics needs an explicit limitation about the limited or uncertain report basis."
    );
  }

  if (!reportContext && payload.hasAttachments && rewrite.source_limitations.length === 0) {
    addIssue(
      issues,
      "MISSING_ATTACHMENT_LIMITATION",
      "warning",
      "Attachment exists but source_limitations is empty."
    );
  }

  if (payload.bodyText.trim().length < 80 && rewrite.source_limitations.length === 0) {
    addIssue(
      issues,
      "SHORT_SOURCE_WITHOUT_LIMITATION",
      "warning",
      "Short source body without limitation note."
    );
  }

  if (countSummarySentences(rewrite) > MAX_SUMMARY_SENTENCES) {
    addIssue(
      issues,
      "SUMMARY_TOO_LONG",
      "warning",
      `Summary exceeds ${MAX_SUMMARY_SENTENCES} sentences.`
    );
  }

  if (countVisibleArticleChars(rewrite) > maxVisibleArticleChars) {
    addIssue(
      issues,
      "VISIBLE_ARTICLE_TOO_LONG",
      "warning",
      `Visible article text exceeds ${maxVisibleArticleChars} chars.`
    );
  }

  if (rewrite.company_sentence.trim() && countSentences(rewrite.company_sentence) !== 1) {
    addIssue(
      issues,
      "COMPANY_SENTENCE_COUNT",
      "warning",
      "company_sentence must contain exactly one sentence."
    );
  }

  if (countWords(rewrite.title) > MAX_TITLE_WORDS) {
    addIssue(
      issues,
      "TITLE_TOO_LONG",
      "warning",
      `Title exceeds ${MAX_TITLE_WORDS} words.`
    );
  }

  if (/:/.test(rewrite.title)) {
    addIssue(
      issues,
      "COLON_HEAVY_TITLE",
      "warning",
      "Title uses a colon; prefer a normal sentence-style headline unless it introduces a list."
    );
  }

  // The title always belongs to the new notice. A figure that only the
  // attached earlier notice contains has no business in it (the reference
  // checker never sees the title, so this is the title's own guard).
  if ((payload.relatedNotices ?? []).length > 0) {
    const relatedSourceText = buildRelatedNoticesSourceText(payload);
    const primaryOnlyMisses = new Set(
      unexpectedNumberDisplays(
        assessNumericText(
          rewrite.title,
          validationSourceText,
          sourceDates.filter(source => source.sourceId === "primary")
        )
      )
    );
    const relatedOnlyTitleNumbers = assessNumericText(
      rewrite.title,
      relatedSourceText,
      sourceDates.filter(source => source.sourceId !== "primary")
    )
      .filter(
        (assessment) =>
          assessment.disposition !== "unexpected" &&
          primaryOnlyMisses.has(assessment.display)
      )
      .map((assessment) => assessment.display);
    if (relatedOnlyTitleNumbers.length > 0) {
      addIssue(
        issues,
        "SECONDARY_ONLY_TITLE_NUMBER",
        "warning",
        `Title uses numbers found only in an earlier notice: ${[...new Set(relatedOnlyTitleNumbers)].join(", ")}.`
      );
    }
  }

  const unexpectedCurrencyMarkers = findUnexpectedCurrencyMarkers(
    rewrite,
    numericValidationSourceText
  );
  if (unexpectedCurrencyMarkers.length > 0) {
    addIssue(
      issues,
      "UNEXPECTED_CURRENCY",
      "warning",
      `Visible article text uses currency not present in source: ${unexpectedCurrencyMarkers.join(", ")}.`
    );
  }

  if (
    sourceRequiresRightOfReply(validationSourceText) &&
    !visibleArticleIncludesRightOfReply(rewrite)
  ) {
    addIssue(
      issues,
      "MISSING_RIGHT_OF_REPLY",
      "warning",
      "Source contains criticism/accusation and a reply, but reply is missing from visible article text."
    );
  }

  if (hasRevenueResultMixupRisk(rewrite, validationSourceText)) {
    addIssue(
      issues,
      "REVENUE_RESULT_MIXUP",
      "warning",
      "Source only appears to mention revenue/income, but visible article text uses result/profit/loss terminology."
    );
  }

  const repeatedNumbers = repeatedVisibleNumbers(rewrite);
  if (repeatedNumbers.length > 0) {
    addIssue(
      issues,
      "REPEATED_VISIBLE_NUMBER",
      "warning",
      `Visible article text repeats the same number three or more times: ${repeatedNumbers.join(", ")}.`
    );
  }

  for (const issue of jargonGuardrailIssues(rewrite)) {
    addIssue(issues, issue.code, "warning", issue.message);
  }

  if (
    (quoteTelemetry.draftContainsStandaloneDashQuote ||
      quoteTelemetry.draftContainsInlineGuillemets ||
      quoteTelemetry.draftContainsNamedPersonAttribution) &&
    !sourceSpansContainQuoteEvidence(rewrite, visibleText, quoteTelemetry)
  ) {
    addIssue(
      issues,
      "MISSING_QUOTE_SOURCE_SPAN",
      "warning",
      "Visible article text uses a quote, source-close wording, or named-person attribution, but source_spans lacks speaker or quote wording evidence."
    );
  }

  if (
    quoteTelemetry.sourceContainsNamedQuoteLikePattern &&
    !quoteTelemetry.draftContainsStandaloneDashQuote &&
    !quoteTelemetry.draftContainsInlineGuillemets &&
    !quoteTelemetry.draftContainsNamedPersonAttribution
  ) {
    addIssue(
      issues,
      "MISSING_QUOTE_OPPORTUNITY",
      "warning",
      "Source contains a named key-person statement, but visible article text has no quote, source-close wording, or named-person attribution."
    );
  }

  const errors = issues.map((issue) => issue.message);
  const blockingErrors = issues
    .filter((issue) => issue.severity === "blocking")
    .map((issue) => issue.message);
  const warnings = issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.message);

  return {
    valid: issues.length === 0,
    errors,
    issues,
    blockingErrors,
    warnings,
    quoteTelemetry,
    numberAssessments,
    publicationNumberAssessments,
    markerLeaks
  };
}
