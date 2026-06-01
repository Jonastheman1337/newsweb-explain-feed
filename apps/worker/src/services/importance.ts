import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { normalizeGuardrailText } from "./text-normalization.js";

const SEVERE_EVENT_KEYWORDS = [
  "profit warning",
  "resultatvarsel",
  "results warning",
  "guidance cut",
  "guidingkutt",
  "kutter guiding",
  "guidance withdrawn",
  "trekker guiding",
  "bankruptcy",
  "konkurs",
  "insolvency",
  "insolvens",
  "restructuring",
  "rekonstruksjon",
  "default",
  "mislighold",
  "liquidity crisis",
  "likviditetskrise",
  "chapter 11",
  "emission",
  "emisjon",
  "rights issue",
  "fortrinnsrettsemisjon",
  "private placement",
  "rettet emisjon",
  "kapitalinnhenting",
  "acquisition",
  "oppkjop",
  "merger",
  "fusjon",
  "takeover bid",
  "oppkjopstilbud",
  "bid received",
  "bud mottatt",
  "ceo resigns",
  "toppsjef gar av",
  "cfo resigns",
  "finansdirektor gar av",
  "police",
  "politi",
  "investigation",
  "gransking",
  "etterforskning",
  "fraud",
  "svindel",
  "material contract",
  "vesentlig kontrakt"
];

const HIGH_READER_INTEREST_KEYWORDS = [
  "died",
  "dodde",
  "killed",
  "drept",
  "explosion",
  "eksplosjon",
  "fire",
  "brann",
  "accident",
  "ulykke",
  "grounded fleet",
  "setter flaten pa bakken",
  "cyber attack",
  "cyberangrep",
  "hacked",
  "hacket",
  "unusual",
  "uvanlig",
  "surprising",
  "overraskende"
];

const ROUTINE_KEYWORDS = [
  "interim financial report",
  "delarsrapport",
  "quarterly report",
  "kvartalsrapport",
  "share repurchases",
  "tilbakekjop av aksjer",
  "mandatory notification of trade",
  "meldepliktig handel",
  "new share capital registered",
  "ny aksjekapital registrert",
  "annual report published",
  "arsrapport publisert",
  "invitation to presentation",
  "invitasjon til presentasjon",
  "notice of annual general meeting",
  "innkalling til generalforsamling"
];

const WELL_KNOWN_ISSUERS = new Set([
  "EQNR",
  "NHY",
  "DNB",
  "TEL",
  "ORK",
  "MOWI",
  "YAR",
  "AKERBP",
  "SALM",
  "TOM"
]);

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(normalizeGuardrailText(keyword)));
}

export function applyImportanceHighBar(
  rewrite: RewriteOutput,
  payload: PromptPayload
): { rewrite: RewriteOutput; adjusted: boolean; reason: string | null } {
  const sourceText = normalizeGuardrailText(`${payload.title}\n${payload.bodyText}`);
  const issuer = payload.issuerSign.toUpperCase();

  const hasSevereSignal = includesAny(sourceText, SEVERE_EVENT_KEYWORDS);
  const hasHighReaderInterestSignal = includesAny(
    sourceText,
    HIGH_READER_INTEREST_KEYWORDS
  );
  const isRoutine = includesAny(sourceText, ROUTINE_KEYWORDS);
  const isWellKnownIssuer = WELL_KNOWN_ISSUERS.has(issuer);

  if (rewrite.importance === "viktig") {
    const keepImportant =
      hasSevereSignal ||
      hasHighReaderInterestSignal ||
      (hasSevereSignal && isWellKnownIssuer);

    if (!keepImportant) {
      return {
        rewrite: { ...rewrite, importance: "medium" },
        adjusted: true,
        reason: "downgraded_viktig_requires_stronger_signals"
      };
    }
    return { rewrite, adjusted: false, reason: null };
  }

  if (rewrite.importance === "medium" && isRoutine && !hasSevereSignal) {
    return {
      rewrite: { ...rewrite, importance: "uviktig" },
      adjusted: true,
      reason: "downgraded_medium_routine_notice"
    };
  }

  return { rewrite, adjusted: false, reason: null };
}
