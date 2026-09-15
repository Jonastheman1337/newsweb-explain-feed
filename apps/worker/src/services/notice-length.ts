import { noticeArticleChars, noticeLengthBand, type RewriteOutput } from "@newsweb/shared";
import { lengthInstructionForPayload, type PromptPayload } from "@newsweb/prompt-kit";

export function noticeRevisionInstruction(payload: PromptPayload, instruction?: string): string | undefined {
  if (!payload.targetVisibleArticleChars) return instruction;
  return [
    instruction?.trim(),
    "Tilpass den viste teksten til gjeldende lengdemål. Behold redaktørens øvrige endringer, hovednyheten, nødvendige forbehold og kildehenvisninger. Ved forkorting: kutt de minst viktige detaljene først. Ved utvidelse: bruk bare relevante, dokumenterte opplysninger fra kildene.",
    lengthInstructionForPayload(payload)
  ].filter(Boolean).join("\n\n");
}

/** One length correction, followed by a fresh source check supplied by the caller. */
export async function repairNoticeLength({
  rewrite, target, correct, verify
}: {
  rewrite: RewriteOutput;
  target?: number;
  correct: (rewrite: RewriteOutput, instruction: string) => Promise<RewriteOutput>;
  verify: (rewrite: RewriteOutput) => Promise<RewriteOutput>;
}) {
  if (!target) return { rewrite, audit: null };
  const band = noticeLengthBand(target);
  const initialChars = noticeArticleChars(rewrite);
  let current = rewrite;
  const applied = initialChars < band.min || initialChars > band.max;
  if (applied) {
    current = await correct(current, [
      `LENGDETILPASNING: Teksten er ${initialChars} tegn. Sikt på omtrent ${target} tegn, innenfor ${band.min}–${band.max} tegn i lead og body, inkludert avsnittsskift. Tittel og metadata teller ikke.`,
      "Dette er én avgrenset lengderevisjon. Behold fakta, attribusjon, nødvendige forbehold og redaktørens øvrige endringer. Kutt svake detaljer hvis teksten er for lang. Utvid bare med relevante opplysninger fra kildene hvis den er for kort. Ikke gjenta poenger eller legg til fyllstoff.",
      "Hvis kildene ikke gir nok relevant stoff, behold en kortere sak og forklar konkret hvorfor i source_limitations, ikke i artikkelteksten."
    ].join("\n"));
    current = await verify(current);
  }
  const finalChars = noticeArticleChars(current);
  return {
    rewrite: current,
    audit: { target, ...band, initialChars, finalChars, applied, outcome: finalChars < band.min ? "shorter" : finalChars > band.max ? "too_long" : "within_target" }
  };
}
