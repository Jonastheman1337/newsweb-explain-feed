import type { RewriteOutput } from "@newsweb/shared";
import type { AttributionRisk } from "./claim-precautions.js";
import { collectDraftSentences } from "./reference-check.js";
import { normalizeGuardrailText } from "./text-normalization.js";

export type NoticeAttributionRisk = AttributionRisk & { clause: string };

// Deliberately target causal explanations and qualitative benefits. Ordinary
// change verbs (øker, reduserer, gir) are also used for reported facts, capital
// changes and completed transactions, so those verbs alone are not evidence of
// a subjective claim. Source support and forecast certainty belong to the
// reference check, which can compare the actual source with the draft.
const EFFECT_CLAIM_PATTERNS = [
  /\b(?:gjor|gjore|gjorde)\s+det\s+mulig\b/,
  /\b(?:bidrar|bidra|bidro|bidratt)\s+til\b/,
  /\b(?:muliggjor|muliggjore|muliggjorde)\b/,
  /\b(?:forer|fore|forte)\s+til\b/,
  /\bdemonstrerer\b/,
  /\b(?:styrker|styrke|styrket)\s+(?:selskapet|konsernet|kundene)\b/,
  /\b(?:markerer|markere|er|blir)\s+(?:en\s+)?(?:(?:viktig|stor|betydelig|strategisk)\s+)?milepael\b/,
  /\b(?:styrker?|styrket|forbedrer?|forbedret|oker?|okte|reduserer?|redusert|sikrer?|sikret)\s+(?:(?:selskapets|selskapet|konsernets|kundenes|kundens|sin|sitt|sine|var|vart|vare|den|det|de|en|et|sterkere|bedre|okt|langsiktig|fremtidig|finansielle|finansiell|strategiske|strategisk|globale|global)\s+){0,4}(?:posisjon\w*|konkurranseevn\w*|lonnsomhet\w*|verdiskap\w*|vekstmulighet\w*|kapitalutnyttelse\w*|effektivitet\w*|produktivitet\w*|driften|baerekraft\w*|kundeopplevelse\w*|robusthet\w*|risiko\w*|miljoavtrykk\w*|attraktivitet\w*)\b/,
  /\b(?:gir|gi|ga|gitt)\s+(?:(?:selskapet|konsernet|kundene|kunden|oss|dem|en|et|den|det|de)\s+){0,3}(?:bedre|sterkere|okt|okt\w*|nye)\s+(?:posisjon\w*|konkurranseevn\w*|lonnsomhet\w*|verdiskap\w*|vekstmulighet\w*|kapitalutnyttelse\w*|effektivitet\w*|baerekraft\w*|kundeopplevelse\w*|robusthet\w*)\b/,
  /\b(?:sikrer|sikre|sikret)\s+(?:selskapets\s+)?(?:(?:langsiktig|fremtidig|videre)\s+)?(?:vekst\w*|fremtid\w*)\b/
];

const SOURCE =
  "(?:selskapet|konsernet|ledelsen|styret|rapporten|borsmeldingen|meldingen|kvartalsrapporten|halvarsrapporten|arsrapporten)";
const REPORTING_VERB =
  "(?:mener|skriver|melder|opplyser|sier|hevder|venter|forventer|anslar|vurderer|beskriver|omtaler|viser|tror)";
const NAMED_REPORTING_VERB = REPORTING_VERB.replace("anslar", "anslår");
const GENERIC_ATTRIBUTION = new RegExp(
  `\\b(?:ifolge\\s+[a-z][a-z0-9-]*|${SOURCE}\\s+(?:(?:selv|ogsa|videre)\\s+)*${REPORTING_VERB}|${REPORTING_VERB}\\s+${SOURCE}|hevdes\\s+det\\s+i\\s+${SOURCE}|gar\\s+det\\s+frem\\s+av\\s+${SOURCE})\\b`
);
const NAMED_SOURCE =
  "(?!(?:Dette|Det|Den|De|Avtalen|Teknologien|Transaksjonen|Oppkjøpet|Investeringen|Prosjektet|Løsningen|Plattformen|Produktet|Samarbeidet|Emisjonen|Tallene|Resultatet|Inntektene|Utviklingen|Fremgangen)\\b)(?:[A-ZÆØÅ][\\p{L}\\d&.'’-]*(?:\\s+[A-ZÆØÅ][\\p{L}\\d&.'’-]*){0,4})";
const SOURCE_ROLE =
  "(?:(?:konsernsjef|administrerende direktør|finansdirektør|styreleder|direktør|sjeføkonom|analytiker)\\s+)?";
const NAMED_ATTRIBUTION = new RegExp(
  `(?:\\b${NAMED_REPORTING_VERB}\\s+${SOURCE_ROLE}${NAMED_SOURCE}|${SOURCE_ROLE}${NAMED_SOURCE}\\s+${NAMED_REPORTING_VERB}\\b)`,
  "u"
);
const LEADING_ATTRIBUTION = new RegExp(
  `^(?:ifolge\\s+[a-z][a-z0-9-]*|${SOURCE}\\s+(?:(?:selv|ogsa|videre)\\s+)*${REPORTING_VERB})\\b`
);
const LEADING_NAMED_ATTRIBUTION = new RegExp(
  `^${SOURCE_ROLE}${NAMED_SOURCE}\\s+${NAMED_REPORTING_VERB}\\b`,
  "u"
);
const TRAILING_ATTRIBUTION = new RegExp(
  `,\\s*(?:ifolge\\s+[a-z][a-z0-9-]*(?:\\s+[a-z][a-z0-9-]*){0,4}|${REPORTING_VERB}\\s+${SOURCE})[.!?«»"”\\s]*$`
);
const TRAILING_NAMED_ATTRIBUTION = new RegExp(
  `,\\s*${NAMED_REPORTING_VERB}\\s+${SOURCE_ROLE}${NAMED_SOURCE}(?:,\\s*[^.;!?]+)?[.!?«»"”\\s]*$`,
  "u"
);

function hasAttribution(clause: string): boolean {
  return (
    GENERIC_ATTRIBUTION.test(normalizeGuardrailText(clause)) ||
    NAMED_ATTRIBUTION.test(clause)
  );
}

function hasSharedAttribution(segment: string): boolean {
  // Attribution at the start scopes over coordinated clauses. A postpositive
  // source tag at the end can do the same. Embedded attribution in one clause
  // does not license the next independent claim; semicolons always reset scope.
  const clean = segment.replace(/^[\s•–—\-«"“]+/, "").trim();
  const normalized = normalizeGuardrailText(clean);
  return (
    LEADING_ATTRIBUTION.test(normalized) ||
    LEADING_NAMED_ATTRIBUTION.test(clean) ||
    TRAILING_ATTRIBUTION.test(normalized) ||
    TRAILING_NAMED_ATTRIBUTION.test(clean)
  );
}

const INDEPENDENT_CLAUSE_BOUNDARY =
  /(?:,\s*|\s+)(?:men|mens|samtidig som)\s+|,\s+og\s+|\s+og\s+(?=(?:dette|det|den|avtalen|teknologien|transaksjonen|oppkjøpet|selskapet|konsernet|prosjektet|investeringen|løsningen|plattformen|produktet|samarbeidet|emisjonen)\b)/i;

export function findNoticeAttributionRisks(
  rewrite: RewriteOutput
): NoticeAttributionRisk[] {
  const risks: NoticeAttributionRisk[] = [];
  for (const [index, sentence] of collectDraftSentences(rewrite).entries()) {
    for (const segment of sentence.split(/\s*;\s*/)) {
      const sharedAttribution = hasSharedAttribution(segment);
      const riskyClause = segment
        .split(INDEPENDENT_CLAUSE_BOUNDARY)
        .map((clause) => clause.trim())
        .find(
          (clause) =>
            EFFECT_CLAIM_PATTERNS.some((pattern) =>
              pattern.test(normalizeGuardrailText(clause))
            ) &&
            !sharedAttribution &&
            !hasAttribution(clause)
        );
      if (riskyClause) {
        risks.push({
          index,
          sentence,
          clause: riskyClause,
          reason:
            "Årsaksforklaring eller kvalitativ effekt-/verdipåstand uten tydelig attribusjon til den som fremsetter den."
        });
        // Preserve sentence-based risk counts used by publication telemetry.
        break;
      }
    }
  }
  return risks;
}

export function buildNoticeAttributionCorrectionInstruction(
  risks: NoticeAttributionRisk[]
): string | null {
  if (risks.length === 0) {
    return null;
  }
  return [
    "Lag et nytt korrigert utkast basert på samme kildetekst.",
    "Reparasjonsinstruksjonen kan ikke overstyre kildekravet, JSON-skjemaet, lengdegrensen eller forbudet mot kurskommentar/investeringslogikk.",
    "Reparer bare de angitte påstandene: knytt vurderingen eller årsaksforklaringen tydelig til kilden som fremsetter den (for eksempel 'ifølge selskapet'), eller fjern den hvis kilden ikke dekker den.",
    "Attribusjon er ikke det samme som usikkerhet. En tydelig attribuert vurdering trenger ikke et ekstra 'kan' når kilden fremsetter vurderingen uten dette forbeholdet.",
    "Bevar kildens styrkegrad, tid og status. Rapporterte tall og bekreftede hendelser skal ikke svekkes til 'kan ha', 'skal ha' eller 'hevdes det'. Prognoser, mål, muligheter og betingede hendelser skal heller ikke gjøres til sikre eller gjennomførte fakta.",
    "Ikke legg til eller fjern forbehold uten dekning i kilden. Behold fakta, tall og struktur, og la faktadeler av samme setning stå uendret.",
    "",
    "Påstander som må kontrolleres mot kilden:",
    ...risks.map((risk) =>
      [
        `Setning ${risk.index + 1}: ${risk.sentence}`,
        `Påstand: ${risk.clause}`,
        `Problem: ${risk.reason}`
      ].join("\n")
    )
  ].join("\n\n");
}
