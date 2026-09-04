import type { RewriteOutput } from "@newsweb/shared";
import { collectDraftSentences } from "./reference-check.js";
import { normalizeGuardrailText } from "./text-normalization.js";

// Sak retains its existing attribution contract. Notice generation uses the
// source-certainty-preserving guard without changing the excluded Sak pipeline.
export {
  buildNoticeAttributionCorrectionInstruction,
  findNoticeAttributionRisks,
  type NoticeAttributionRisk
} from "./notice-claim-precautions.js";

export type AttributionRisk = {
  index: number;
  sentence: string;
  reason: string;
};

export const ATTRIBUTION_MARKERS = [
  "ifolge selskapet",
  "ifolge borsmeldingen",
  "ifolge meldingen",
  "melder selskapet",
  "skriver selskapet",
  "opplyser selskapet",
  "hevder selskapet",
  "hevdes det",
  "selskapet mener",
  "selskapet opplyser",
  "selskapet skriver"
];

const ASSERTIVE_EFFECT_PATTERNS = [
  "gjor det mulig",
  "gjore det mulig",
  "bidrar til",
  "bidrar",
  "vil bidra",
  "muliggjor",
  "forer til",
  "fore til",
  "sikrer",
  "styrker",
  "forbedrer",
  "reduserer",
  "oker",
  "gir ",
  "markerer",
  "demonstrerer"
];

const HEDGING_MARKERS = [
  "kan ",
  "kan bidra",
  "kan gi",
  "skal ifolge",
  "hevdes det"
];

function hasAny(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

export function findAttributionRisks(rewrite: RewriteOutput): AttributionRisk[] {
  const sentences = collectDraftSentences(rewrite);
  const risks: AttributionRisk[] = [];

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index] ?? "";
    const normalized = normalizeGuardrailText(sentence);
    const looksLikeEffectClaim = hasAny(normalized, ASSERTIVE_EFFECT_PATTERNS);
    const hasAttribution = hasAny(normalized, ATTRIBUTION_MARKERS);
    const hasHedging = hasAny(normalized, HEDGING_MARKERS);

    if (looksLikeEffectClaim && !hasAttribution) {
      risks.push({
        index,
        sentence,
        reason: "Effekt-/verdipastand uten tydelig attribusjon til kilden/selskapet."
      });
      continue;
    }

    if (looksLikeEffectClaim && !hasHedging) {
      risks.push({
        index,
        sentence,
        reason:
          "Effekt-/verdipastand mangler forbehold (for eksempel 'kan' eller 'hevdes det')."
      });
    }
  }

  return risks;
}

export function buildAttributionCorrectionInstruction(
  risks: AttributionRisk[]
): string | null {
  if (risks.length === 0) {
    return null;
  }

  const lines = risks.map((risk) =>
    [
      `Setning ${risk.index + 1}: ${risk.sentence}`,
      `Problem: ${risk.reason}`,
      "Krav: Omskriv med tydelig attribusjon (f.eks. 'ifølge selskapet') og forbehold (f.eks. 'kan', 'hevdes det')."
    ].join("\n")
  );

  return [
    "Lag et nytt korrigert utkast basert på samme kildetekst.",
    "Reparasjonsinstruksjonen kan ikke overstyre kildekravet, JSON-skjemaet, lengdegrensen eller forbudet mot kurskommentar/investeringslogikk.",
    "Bastante effekt- eller verdipåstander må ikke stå som objektive fakta.",
    "Bruk alltid attribusjon og nøkternt forbehold: 'ifølge selskapet', 'ifølge børsmeldingen', 'kan', 'hevdes det'.",
    "Behold fakta, tall og struktur, men juster formuleringene.",
    "",
    "Setninger som må omskrives:",
    lines.join("\n\n")
  ].join("\n");
}
