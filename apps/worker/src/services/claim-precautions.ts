import type { RewriteOutput } from "@newsweb/shared";
import { collectDraftSentences } from "./reference-check.js";

export type AttributionRisk = {
  index: number;
  sentence: string;
  reason: string;
};

const ATTRIBUTION_MARKERS = [
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
  "bidrar til",
  "bidrar",
  "vil bidra",
  "muliggjor",
  "forer til",
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
    const normalized = sentence.toLowerCase();
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
      "Krav: Omskriv med tydelig attribusjon (f.eks. 'ifolge selskapet') og forbehold (f.eks. 'kan', 'hevdes det')."
    ].join("\n")
  );

  return [
    "Lag et nytt korrigert utkast basert pa samme kildetekst.",
    "Bastante effekt- eller verdipastander ma ikke sta som objektive fakta.",
    "Bruk alltid attribusjon og nokternt forbehold: 'ifolge selskapet', 'ifolge borsmeldingen', 'kan', 'hevdes det'.",
    "Behold fakta, tall og struktur, men juster formuleringene.",
    "",
    "Setninger som ma omskrives:",
    lines.join("\n\n")
  ].join("\n");
}
