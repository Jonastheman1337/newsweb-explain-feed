import { createDeveloperPrompt, type DeveloperPromptContext } from "./prompt.js";
import { createReportDeveloperPrompt } from "./report-prompt.js";
import { createYearlyReportDeveloperPrompt } from "./yearly-report-prompt.js";
import { EDITORIAL_ATTRIBUTION, EDITORIAL_QUOTES, EDITORIAL_TITLE } from "./shared-editorial.js";

/** Local candidate built on the frozen v5.11 writer; no brief/coverage pipeline. */
export const EDITORIAL_HYBRID_PROMPT_VERSION = "v5.11.1-hybrid.1";

const attribution = EDITORIAL_ATTRIBUTION.replace(
  "- Effekt- eller verdipastander krever forbehold: 'kan', 'ifolge selskapet'.",
  "- Rapporter målte resultater og gjennomførte hendelser direkte. Kildehenvisning gjør ikke et faktisk forhold usikkert. Attribuer selskapets årsaksforklaringer og vurderinger; behold 'kan', 'venter' og andre forbehold når de finnes i kilden."
);

const quotes = EDITORIAL_QUOTES.replace(
  "Regnskap for uttalelser: hver navngitt nøkkelpersonuttalelse i kilden skal enten gjengis i saken eller stå i excluded_hype. En relevant uttalelse som forsvinner stille er en feil, på samme måte som et oppfunnet sitat er en feil.",
  "Velg den uttalelsen som best forklarer nyheten. Flere personer eller sitater i kilden krever ikke flere i saken. La et kort, konkret sitat tilføre årsak, erfaring eller utsikt; fortellerteksten trenger ikke gjengi poenget først. excluded_hype er bare for PR som faktisk er valgt bort, ikke et regnskap over alt du har utelatt."
).replace(
  "Hvis en CEO, CFO eller styreleder sier noe kildefast om etterspørsel, ordreinngang, booking, kapasitet, markedssituasjon, risiko, guiding eller utsikter, skal den med i saken.",
  "Behold ledelsens mest relevante, kildefaste forklaring på etterspørsel, kapasitet, marked, risiko eller utsikter når den gjør nyheten forståelig."
);

function refineSharedBlocks(prompt: string): string {
  return prompt.replace(EDITORIAL_ATTRIBUTION, attribution).replace(EDITORIAL_QUOTES, quotes).replace(
    EDITORIAL_TITLE,
    `${EDITORIAL_TITLE}\n- Velg hva som gjør akkurat denne hendelsen til en nyhet: en første kontrakt i et nytt marked eller hva pengene skal gjøre kan fortelle mer enn beløpet alene. Bruk det konkrete poenget når kilden bærer det, uten å gjøre en rutinesak større enn den er.`
  );
}

export function createHybridDeveloperPrompt(schemaJson?: string, context?: DeveloperPromptContext): string {
  return refineSharedBlocks(createDeveloperPrompt(schemaJson, context));
}

export function createHybridReportDeveloperPrompt(schemaJson?: string, context?: DeveloperPromptContext): string {
  return refineSharedBlocks(createReportDeveloperPrompt(schemaJson, context)).replace(
    "- Plukk ut 3-4 nokkeltall. Ikke rams opp alt rapporten inneholder.",
    "- Velg tallene som bærer og forklarer hovedpoenget. Tre-fire nøkkeltall er ofte nok, men er ingen kvote. En avgjørende nedleggelse, endret prognose eller separat vesentlig aksjonærutbetaling kan være viktigere enn enda en resultatlinje."
  );
}

export function createHybridYearlyReportDeveloperPrompt(schemaJson?: string): string {
  // Preserve the separate remuneration assignment and all its source boundaries.
  return createYearlyReportDeveloperPrompt(schemaJson);
}
