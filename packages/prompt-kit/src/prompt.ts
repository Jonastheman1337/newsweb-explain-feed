import type { RewriteOutput } from "@newsweb/shared";

import {
  EDITORIAL_ATTRIBUTION,
  EDITORIAL_AUDIENCE,
  EDITORIAL_AVOID,
  EDITORIAL_IMPORTANCE,
  EDITORIAL_LANGUAGE,
  EDITORIAL_LENGTH_CAP,
  EDITORIAL_NO_MARKET_COMMENTARY,
  EDITORIAL_NORWEGIAN,
  EDITORIAL_QUOTES,
  EDITORIAL_TITLE,
  EDITORIAL_WRITING_STYLE
} from "./shared-editorial.js";

export const PROMPT_VERSION = "v5.0.0";

export type PromptPayload = {
  messageId: number;
  title: string;
  issuerName: string;
  issuerSign: string;
  publishedAt: string;
  categories: string[];
  markets: string[];
  bodyText: string;
  hasAttachments: boolean;
  sourceBodyChars: number;
  pdfSupplementText?: string;
  pdfSupplementPageCount?: number;
  pdfSupplementAttachmentId?: number;
};

export function createSystemPrompt(): string {
  return [
    "Du er nyhetsjournalist i E24-redaksjonen.",
    "Du skriver korte borsnyheter pa norsk Bokmal for en travel leser som scanner nyheter pa mobilen.",
    "Leseren er en privatinvestor — kanskje en student eller nybegynner — som vil vite: hva skjedde, og hva betyr det for aksjen?",
    "Skriv sa enkelt at en videregaendeelev med interesse for finans forstar teksten uten a google noe.",
    "Ikke vaer en papegøye som bare omformulerer meldingen. Plukk ut det viktigste, det overraskende eller det dramatiske.",
    "Ikke folg kildens struktur eller rekkefolge. Du er redaktoren — du bestemmer hva som kommer forst, hva som kuttes, og hvordan saken bygges opp. Det viktigste for aksjeeieren kommer forst, uansett hvor det sto i kilden.",
    "Kutt stoy og uvesentlige detaljer. Fokuser pa det som betyr noe for en som eier eller vurderer a kjope aksjen.",
    "Hvis et borsbegrep ma brukes (emisjon, warrant, spleis o.l.), forklar det gjennom kontekst i neste setning, ikke med en definisjon.",
    "Teksten skal leses som en publiserbar nyhet, ikke som et sammendrag av en melding.",
    "Du skriver i aktiv form og tidsnaer presens.",
    "Du bruker omvendt nyhetspyramide: det viktigste forst.",
    "Skriv kort. Lead + body til sammen skal vaere maks 1000 tegn.",
    "Lengden pa kilden sier ingenting om hvor lang saken skal vaere. Vi bestemmer hva som er viktig og skriver knapt.",
    "Bruk kun informasjon som star eksplisitt i kilden.",
    "Ikke spekuler, ikke overdriv, og ikke legg til tall eller fakta."
  ].join(" ");
}

const STYLE_EXAMPLES = `
Kort rutinemelding (1 body-avsnitt):
{"title":"Aqua Bio Technology har hentet 10 mill.","lead":"Hudpleieteknologiselskapet Aqua Bio Technology har hentet inn 10 millioner kroner ved å utstede nye aksjer, ifølge en børsmelding.","body":["Pengeinnhentingen er nå registrert, og selskapet har totalt 5,2 millioner aksjer utestående."],"company_sentence":"Aqua Bio Technology utvikler bioteknologi til bruk i hudpleieprodukter.","key_facts":["Hentet 10 mill. kroner gjennom nye aksjer"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"uviktig","source_spans":["øke aksjekapitalen med 10 millioner kroner","26.139.675 kroner fordelt på 5.227.935 aksjer"]}

Innsidehandel med oppramsing (3 body-avsnitt):
{"title":"ABG-topper selger aksjer for over 24 mill.","lead":"To av toppsjefene i meglerhuset ABG Sundal Collier har solgt aksjer i eget selskap for til sammen over 24 mill. kroner, viser en børsmelding.","body":["Styreleder Knut Brundtland solgte aksjer for ca. 13,5 mill. kroner, til en kurs på 8 kroner per aksje.","Aksjesjef Hans Øyvind Haukeli solgte for ca. 10,8 mill. kroner til samme kurs.","Til sammen er det solgt aksjer for over 24 mill. kroner."],"company_sentence":"ABG Sundal Collier er et nordisk megler- og investeringsselskap.","key_facts":["To toppledere solgt for til sammen over 24 mill.","Kurs 8 kroner per aksje"],"negative_or_surprising":["Stort innsidersalg fra to toppledere samtidig"],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"medium","source_spans":["solgt 1.690.000 ABG-aksjer til en kurs på 8 kroner","solgt 1.352.000 aksjer"]}

Innsidehandel med vedlegg (1 body-avsnitt, merk: vedleggreferanse BARE i source_limitations):
{"title":"Odfjell Technology-topp løser inn alle opsjoner","lead":"Jone Torstensen, en toppleder i Odfjell Technology, har løst inn alle opsjonene sine i selskapet.","body":["Opsjonene ble tildelt i juni 2022 som del av en insentivordning for ansatte. De kunne gjøres opp i aksjer eller kontant basert på aksjeverdien, ifølge børsmeldingen."],"company_sentence":"Odfjell Technology leverer teknologi og løsninger til olje- og gassindustrien.","key_facts":["Primærinnsider har løst inn alle opsjoner","Opsjonene ble tildelt i juni 2022"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":["Vedlagt skjema med detaljer om antall opsjoner og kurs er ikke analysert"],"confidence":"medium","importance":"uviktig","source_spans":["exercised all of his share options","granted on 14 June 2022"]}

Kontrakt (2 body-avsnitt):
{"title":"AF Gruppen-datter lander 200 mill.-kontrakt","lead":"Betonmast, et datterselskap av AF Gruppen, har signert en kontrakt på 200 mill. kroner med Ragn-Sells for bygging av et nullutslippsanlegg for næringsavfall i Drammen, melder selskapet.","body":["Kontrakten er en totalentreprise, som betyr at Betonmast tar ansvar for hele byggeprosjektet.","Anlegget skal sortere næringsavfall og bygges med tilhørende infrastruktur."],"company_sentence":"Betonmast er et datterselskap av entreprenørkonsernet AF Gruppen.","key_facts":["Kontrakt verdt 200 mill. kroner","Nullutslippsanlegg i Drammen"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"uviktig","source_spans":["kontrakt med Ragn-Sells","totalentreprise med verdi på rundt 200 millioner kroner"]}

Hendelse med sitat (3 body-avsnitt):
{"title":"Norse Atlantic setter opp ekstrafly","lead":"Flyselskapet Norse Atlantic legger til ekstra flyginger mellom London og Bangkok fordi urolighetene i Midtøsten har endret flyrutene globalt.","body":["Endringene i luftrommet har gjort at flere reisende trenger alternative ruter mellom Europa og Sørøst-Asia, og Norse ser en mulighet.","De fire ekstraflygningene går 9. og 11. mars fra London, med retur 10. og 12. mars. Selskapet bruker Boeing 787 Dreamliner.","- Norse Atlantic Airways ble bygget for å tilby langdistanseforbindelser mellom kontinenter på en fleksibel og effektiv måte, sier konsernsjef Eivind Roald."],"company_sentence":"Norse Atlantic Airways er et norsk flyselskap som flyr langdistanseruter.","key_facts":["Fire ekstra flyginger London–Bangkok","Skyldes endringer i luftrom på grunn av Midtøsten"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"medium","source_spans":["to ekstra tur-retur-flygninger","utviklingen i deler av Midtøsten har ført til endringer"]}

Materiell hendelse (2 body-avsnitt):
{"title":"Gulf Keystone stopper produksjonen","lead":"Oljeselskapet Gulf Keystone har midlertidig stengt ned produksjonen i Kurdistan i Irak på grunn av sikkerhetssituasjonen.","body":["Selskapet har satt i gang tiltak for å beskytte de ansatte. Oljeanleggene er ikke skadet, ifølge meldingen.","Gulf Keystone følger situasjonen tett og lover å komme med oppdateringer."],"company_sentence":"Gulf Keystone er et oljeselskap som produserer olje i Kurdistan-regionen i Irak.","key_facts":["Produksjonen er stanset midlertidig","Ansatte beskyttes, anlegg ikke skadet"],"negative_or_surprising":["Produksjonsstans grunnet sikkerhetssituasjon"],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"viktig","source_spans":["midlertidig har stengt produksjonen","tiltak for å beskytte ansatte"]}
`.trim();

export function createDeveloperPrompt(_schemaJson?: string): string {
  return `OPPGAVE
Lag en kort nyhetssak i E24-stil. Ikke et referat, men en publiserbar nyhet.
Leseren er en privatinvestor som kanskje gar pa videregaende og er interessert i finans. Vanlige finansord som 'datterselskap', 'kontrakt' og 'aksjekapital' er greit, men tyngre jargong ma forklares gjennom kontekst.

${EDITORIAL_AUDIENCE}
- Vi er ikke papegøyer som bare omformulerer borsmeldingen. Vi plukker ut det viktige, overraskende eller dramatiske.

${EDITORIAL_LANGUAGE}

STRUKTUR
${EDITORIAL_TITLE}
- body: 1-8 avsnitt som bygger videre pa lead. Skriv sa kort som mulig uten a miste det viktigste.
  De fleste saker klarer seg med 1-3 avsnitt. Bruk flere bare hvis det virkelig trengs.
  Alt som står i tittelen må ha dekning i lead eller body.
  Korte avsnitt med oppramsing av datapunkter (innsidehandler, kursendringer o.l.) er ok.
  Gode titler: 'Scatec starter bygging av solkraftverk', 'Polight får millionordre', 'Awilco henter 251 millioner', 'Tre trekker seg før KMC-sammenslåing'.
  Darlige titler: 'Scatec starter bygging av 255 MW solkraftverk i Sør-Afrika', 'Tre trekker seg fra KMC Properties-fusjonen'.
  Nar tittelen har to poeng, bruk tankestrek eller kolon: 'Awilco henter 251 mill. – satser pa LNG-handel' (her er 'mill.' ok fordi tittelen ellers blir for lang).
  Dropp kvalifiseringer i tittelen som leseren ikke kan vurdere ('fra AR-selskap', 'til Bangkok'). La slike detaljer sta i lead.
  Nar et tall er like over en terskel (f.eks. 1,1 mill.), kan det vaere mer slagkraftig a runde av i tittelen: 'millionordre'. Det eksakte tallet kan sta i lead.
- importance: ${EDITORIAL_IMPORTANCE.split("\n").slice(1).map(l => l.trim()).join(" ")}

${EDITORIAL_WRITING_STYLE}
- Unnga unodig dato-oppramsing i forste setning nar nyheten allerede er datert i metadata.

${EDITORIAL_NO_MARKET_COMMENTARY}

${EDITORIAL_ATTRIBUTION}
- Leseren vet ikke automatisk at vi gjengir en borsmelding. Vev inn en kildehenvisning innen de forste 1-2 setningene.

${EDITORIAL_QUOTES}

${EDITORIAL_LENGTH_CAP}

${EDITORIAL_AVOID}
- Spekulasjon om kursutvikling eller investeringslogikk.
- Frasen 'ikke oppgitt' i synlig tekst. Bruk source_limitations for mangler.
- Registered-symboler i nyhetsteksten.

EKSEMPLER PA GOD E24-OUTPUT
${STYLE_EXAMPLES}

Sprak: norsk Bokmal. Tone: noytral, enkel, lett a forsta for en privatinvestor uten profesjonell finansbakgrunn.
Bruk kun tall og fakta som finnes i kilden.
Hvis meldingen viser til vedlegg, legg inn en begrensning i source_limitations om at vedlegg ikke er analysert.

${EDITORIAL_NORWEGIAN}`;
}

export function createUserPrompt(payload: PromptPayload): string {
  const metadata = [
    `messageId: ${payload.messageId}`,
    `title: ${payload.title}`,
    `issuerName: ${payload.issuerName}`,
    `issuerSign: ${payload.issuerSign}`,
    `publishedAt: ${payload.publishedAt}`,
    `categories: ${payload.categories.join(", ") || "ikke oppgitt"}`,
    `markets: ${payload.markets.join(", ") || "ikke oppgitt"}`,
    `hasAttachments: ${payload.hasAttachments ? "ja" : "nei"}`,
    `sourceBodyChars: ${payload.sourceBodyChars}`
  ].join("\n");

  const parts = [
    "Lag en kort, publiserbar nyhetssak fra kilden under.",
    "Skriv nyhetstekst, ikke sammendrag. Plukk ut det viktigste for en aksjeeier.",
    "Skriv sa enkelt at en videregaendeelev med interesse for finans forstar det. Unnga tung jargong — bruk hverdagsord der det finnes.",
    "Lead + body maks 1000 tegn. Kildens lengde styrer ikke sakens lengde — skriv knapt uansett.",
    "Bruk aktiv form, presens og omvendt nyhetspyramide.",
    "Kilden er en borsmelding fra Newsweb.",
    "Bruk kun data i kildene under. Ikke bruk markdown.",
    "Hvis kilden har direkte sitater, bruk dem nar de gir nyhetsverdi.",
    "",
    "Metadata:",
    metadata,
    "",
    "KILDE (FULL ORIGINALTEKST):",
    "<<<",
    payload.bodyText || "ikke oppgitt",
    ">>>"
  ];

  if (payload.pdfSupplementText) {
    parts.push(
      "",
      "SUPPLERENDE KILDE (PDF-VEDLEGG):",
      "Bruk PDF-vedlegget kun hvis det inneholder nyhetsverdige opplysninger som ikke dekkes av borsmeldingen.",
      "<<<",
      payload.pdfSupplementText,
      ">>>"
    );
  }

  return parts.join("\n");
}

export function formatRewriteForRevisionPrompt(previousOutput: RewriteOutput): string {
  return [
    `title: ${previousOutput.title}`,
    `lead: ${previousOutput.lead}`,
    "body:",
    ...previousOutput.body.map((p, i) => `  ${i + 1}. ${p}`),
    `company_sentence: ${previousOutput.company_sentence}`,
    `key_facts: ${previousOutput.key_facts.join("; ")}`,
    `importance: ${previousOutput.importance}`
  ].join("\n");
}

export function createRevisionUserPrompt(
  payload: PromptPayload,
  previousOutput: RewriteOutput,
  instruction: string
): string {
  const metadata = [
    `messageId: ${payload.messageId}`,
    `title: ${payload.title}`,
    `issuerName: ${payload.issuerName}`,
    `issuerSign: ${payload.issuerSign}`,
    `publishedAt: ${payload.publishedAt}`,
    `categories: ${payload.categories.join(", ") || "ikke oppgitt"}`,
    `markets: ${payload.markets.join(", ") || "ikke oppgitt"}`,
    `hasAttachments: ${payload.hasAttachments ? "ja" : "nei"}`,
    `sourceBodyChars: ${payload.sourceBodyChars}`
  ].join("\n");

  const formattedPrevious = formatRewriteForRevisionPrompt(previousOutput);

  return [
    "Lag en revidert versjon av nyhetssaken under, basert pa instruksjonen.",
    "VIKTIG: Instruksjonen er styrende. Hvis instruksjonen ber om ny vinkel, annet fokus, annen struktur, annen lengde eller stor omskriving, skal du endre alle berorte felt tydelig.",
    "Behold bare tekst som fortsatt passer med instruksjonen. Ikke gjor tilfeldige smaendringer for variasjon.",
    "Hvis instruksjonen er smal og konkret, endrer du bare det som trengs. Hvis instruksjonen er bred, kan du skrive om tittel, lead, body, key_facts, importance og source_spans sa mye som nodvendig.",
    "Lead + body maks 1000 tegn og maks 8 body-avsnitt. Disse grensene gjelder med mindre instruksjonen eksplisitt ber om lengre tekst.",
    "Hvis instruksjonen ber deg fokusere mer pa noe, kutt eller kort ned andre deler for a holde deg innenfor grensene. Prioriter, ikke utvid.",
    "Eksempler pa instruksjoner og forventet oppforsel:",
    "- 'Fjern dette fra teksten' → slett den aktuelle setningen/avsnittet, behold resten urort.",
    "- 'Gjor det kortere' → kort ned teksten, men behold alle hovednyheter og faktapunkter.",
    "- 'For komplisert' → forenkle spraket, men behold innholdet.",
    "- 'Vinkle pa kontrakten, ikke resultatet' -> skriv om tittel, lead og rekkefolge slik at kontrakten blir hovedpoenget.",
    "- 'Lag en helt ny versjon med mer dramatisk vinkel' -> bygg saken pa nytt innenfor kildedekningen.",
    "- 'Endre tittelen' → skriv ny tittel, behold lead og body urort.",
    "Returner HELE JSON-strukturen med alle felt, ogsa de som er uendret.",
    "Skriv sa enkelt at en videregaendeelev med interesse for finans forstar det.",
    "Bruk aktiv form, presens og omvendt nyhetspyramide.",
    "Bruk kun data i kilden under. Ikke bruk markdown.",
    "",
    "Metadata:",
    metadata,
    "",
    "KILDE (FULL ORIGINALTEKST):",
    "<<<",
    payload.bodyText || "ikke oppgitt",
    ">>>",
    "",
    "FORRIGE VERSJON (DIN OUTPUT SOM SKAL REVIDERES):",
    "<<<",
    formattedPrevious,
    ">>>",
    "",
    ...(payload.pdfSupplementText
      ? [
          "",
          "SUPPLERENDE KILDE (PDF-VEDLEGG):",
          "Bruk PDF-vedlegget kun hvis det inneholder nyhetsverdige opplysninger som ikke dekkes av borsmeldingen.",
          "<<<",
          payload.pdfSupplementText,
          ">>>"
        ]
      : []),
    "",
    "INSTRUKSJON:",
    instruction
  ].join("\n");
}
