import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";

const SEVERE_EVENT_KEYWORDS = [
  "profit warning",
  "results warning",
  "guidance cut",
  "guidance withdrawn",
  "bankruptcy",
  "insolvency",
  "restructuring",
  "default",
  "liquidity crisis",
  "chapter 11",
  "emission",
  "rights issue",
  "private placement",
  "acquisition",
  "merger",
  "takeover bid",
  "bid received",
  "ceo resigns",
  "cfo resigns",
  "police",
  "investigation",
  "fraud",
  "material contract"
];

const HIGH_READER_INTEREST_KEYWORDS = [
  "died",
  "killed",
  "explosion",
  "fire",
  "accident",
  "grounded fleet",
  "cyber attack",
  "hacked",
  "unusual",
  "surprising"
];

const ROUTINE_KEYWORDS = [
  "interim financial report",
  "quarterly report",
  "share repurchases",
  "mandatory notification of trade",
  "new share capital registered",
  "annual report published",
  "invitation to presentation",
  "notice of annual general meeting"
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
  return keywords.some((keyword) => text.includes(keyword));
}

export function applyImportanceHighBar(
  rewrite: RewriteOutput,
  payload: PromptPayload
): { rewrite: RewriteOutput; adjusted: boolean; reason: string | null } {
  const sourceText = `${payload.title}\n${payload.bodyText}`.toLowerCase();
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
