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
  EDITORIAL_RELATED_NOTICES,
  EDITORIAL_REVISION_PRIORITY,
  EDITORIAL_SOURCE_AS_DATA,
  EDITORIAL_SUPPLEMENTAL_MATERIALS,
  EDITORIAL_TITLE,
  EDITORIAL_WRITING_STYLE
} from "./shared-editorial.js";

export const PROMPT_VERSION = "v5.11.0";

export type OutputMode = "notice" | "extended_notice";

export type SupplementalMaterialPayload = {
  id: string;
  sourceId: string;
  kind: string;
  title: string;
  url?: string | null;
  text: string;
  textChars?: number;
};

export const relatedNoticeRelations = ["reference", "correction", "sibling"] as const;
export type RelatedNoticeRelation = (typeof relatedNoticeRelations)[number];

/**
 * An earlier (or parallel) Newsweb notice the worker resolved automatically and
 * attached as labeled background. Kept separate from supplementalMaterials:
 * the prompt needs date/issuer/relation, the editorial rules differ, and the
 * reference-check guards must not sweep editor-added materials.
 */
export type RelatedNoticePayload = {
  messageId: number;
  relation: RelatedNoticeRelation;
  title: string;
  issuerName: string;
  issuerSign: string;
  publishedAt: string;
  text: string;
  textChars: number;
  resolvedBy: "db" | "newsweb";
  score: number;
};

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
  outputMode?: OutputMode;
  maxVisibleArticleChars?: number;
  supplementalMaterials?: SupplementalMaterialPayload[];
  relatedNotices?: RelatedNoticePayload[];
  pdfSupplementText?: string;
  pdfSupplementPageCount?: number;
  pdfSupplementAttachmentId?: number;
};

export type DeveloperPromptContext = Pick<
  PromptPayload,
  "relatedNotices" | "publishedAt"
>;

export function isRelatedNoticeTimestampValid(
  relatedPublishedAt: string,
  currentPublishedAt: string
): boolean {
  const relatedTime = new Date(relatedPublishedAt).getTime();
  const currentTime = new Date(currentPublishedAt).getTime();
  return (
    Number.isFinite(relatedTime) &&
    Number.isFinite(currentTime) &&
    relatedTime <= currentTime
  );
}

export function hasRelatedNoticeContext(
  context?: DeveloperPromptContext
): boolean {
  return Boolean(
    context?.relatedNotices?.some(
      (notice) =>
        notice.text.trim().length > 0 &&
        isRelatedNoticeTimestampValid(notice.publishedAt, context.publishedAt)
    )
  );
}

export const RELATED_NOTICE_SOURCE_ID_PREFIX = "prior_";

export function relatedNoticeSourceId(messageId: number): string {
  return `${RELATED_NOTICE_SOURCE_ID_PREFIX}${messageId}`;
}

const OSLO_TIME_ZONE = "Europe/Oslo";

type OsloDateParts = {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: string;
  monthName: string;
};

function osloDateParts(iso: string): OsloDateParts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const numeric = new Intl.DateTimeFormat("en-US", {
    timeZone: OSLO_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const names = new Intl.DateTimeFormat("nb-NO", {
    timeZone: OSLO_TIME_ZONE,
    weekday: "long",
    month: "long"
  }).formatToParts(date);
  const pick = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(pick(numeric, "year")),
    month: Number(pick(numeric, "month")),
    day: Number(pick(numeric, "day")),
    weekday: pick(names, "weekday").toLowerCase(),
    monthName: pick(names, "month").toLowerCase()
  };
}

/** "tirsdag 23. juni 2026" in Europe/Oslo; falls back to the raw ISO string. */
export function formatNorwegianNoticeDate(iso: string): string {
  const parts = osloDateParts(iso);
  if (!parts) {
    return iso;
  }
  return `${parts.weekday} ${parts.day}. ${parts.monthName} ${parts.year}`;
}

/**
 * The time marker the article should use for an earlier notice, computed from
 * the two publish dates so the model never does date arithmetic: "tidligere
 * samme dag", "i går", a weekday inside the same week, "i juni" within the year,
 * "i juni i fjor", or "i juni 2024".
 */
export function relatedNoticeTimeMarker(
  relatedPublishedAt: string,
  currentPublishedAt: string
): { daysBefore: number; marker: string } {
  const relatedInstant = new Date(relatedPublishedAt).getTime();
  const currentInstant = new Date(currentPublishedAt).getTime();
  if (!Number.isFinite(relatedInstant) || !Number.isFinite(currentInstant)) {
    return { daysBefore: -1, marker: "UGYLDIG FREMTIDIG KILDE – IKKE BRUK" };
  }
  if (relatedInstant > currentInstant) {
    return {
      daysBefore: -Math.max(
        1,
        Math.ceil((relatedInstant - currentInstant) / 86_400_000)
      ),
      marker: "UGYLDIG FREMTIDIG KILDE – IKKE BRUK"
    };
  }
  const related = osloDateParts(relatedPublishedAt);
  const current = osloDateParts(currentPublishedAt);
  if (!related || !current) {
    return { daysBefore: -1, marker: "UGYLDIG FREMTIDIG KILDE – IKKE BRUK" };
  }
  const relatedUtc = Date.UTC(related.year, related.month - 1, related.day);
  const currentUtc = Date.UTC(current.year, current.month - 1, current.day);
  const daysBefore = Math.round((currentUtc - relatedUtc) / 86_400_000);

  if (daysBefore < 0) {
    return {
      daysBefore,
      marker: "UGYLDIG FREMTIDIG KILDE – IKKE BRUK"
    };
  }
  if (daysBefore === 0) {
    return { daysBefore, marker: "i en tidligere melding samme dag" };
  }
  if (daysBefore === 1) {
    return { daysBefore, marker: "i går" };
  }
  if (daysBefore <= 6) {
    return { daysBefore, marker: related.weekday };
  }
  if (related.year === current.year) {
    return { daysBefore, marker: `i ${related.monthName}` };
  }
  if (related.year === current.year - 1) {
    return { daysBefore, marker: `i ${related.monthName} i fjor` };
  }
  return { daysBefore, marker: `i ${related.monthName} ${related.year}` };
}

/** Relation-aware marker: sibling notices are parallel same-day sources. */
export function relatedNoticeContextMarker(
  relation: RelatedNoticeRelation,
  relatedPublishedAt: string,
  currentPublishedAt: string
): string {
  if (!isRelatedNoticeTimestampValid(relatedPublishedAt, currentPublishedAt)) {
    return "UGYLDIG FREMTIDIG KILDE – IKKE BRUK";
  }
  if (relation === "sibling") {
    return "i en parallell melding samme dag";
  }
  return relatedNoticeTimeMarker(relatedPublishedAt, currentPublishedAt).marker;
}

function relatedNoticeRelationLabel(relation: RelatedNoticeRelation): string {
  switch (relation) {
    case "correction":
      return "korrigering – tidligere melding som dagens melding korrigerer";
    case "sibling":
      return "parallell – annen melding om samme hendelse";
    default:
      return "referanse – tidligere melding som dagens melding viser til";
  }
}

function relatedNoticesHeading(
  notices: readonly RelatedNoticePayload[]
): string {
  const relations = new Set(notices.map((notice) => notice.relation));
  if (relations.size !== 1) {
    return "RELATERTE MELDINGER SOM BAKGRUNN";
  }
  switch (notices[0]?.relation) {
    case "correction":
      return "TIDLIGERE MELDING SOM DAGENS MELDING KORRIGERER";
    case "sibling":
      return "PARALLELL MELDING OM SAMME HENDELSE";
    default:
      return "TIDLIGERE MELDING SOM DAGENS MELDING VISER TIL";
  }
}

function relatedNoticeDistanceLabel(daysBefore: number): string {
  if (daysBefore < 0) {
    return "publisert etter den nye meldingen – ugyldig bakgrunnskilde";
  }
  if (daysBefore === 0) {
    return "samme dag som den nye meldingen";
  }
  if (daysBefore === 1) {
    return "dagen før den nye meldingen";
  }
  return `${daysBefore} dager før den nye meldingen`;
}

/**
 * Data-only user-prompt block for auto-attached related notices. The rules
 * live once in the developer prompt (EDITORIAL_RELATED_NOTICES); this block
 * carries the labeled text plus a Norwegian date and a computed time marker.
 */
export function relatedNoticesPromptSection(
  payload: Pick<PromptPayload, "relatedNotices" | "publishedAt">
): string[] {
  const notices = payload.relatedNotices?.filter(
    (notice) =>
      notice.text.trim() &&
      isRelatedNoticeTimestampValid(notice.publishedAt, payload.publishedAt)
  );
  if (!notices || notices.length === 0) {
    return [];
  }

  const sections: string[] = [
    "",
    `${relatedNoticesHeading(notices)} (bakgrunnskilder, reglene står i oppgavebeskrivelsen):`
  ];
  for (const notice of notices) {
    const { daysBefore } = relatedNoticeTimeMarker(
      notice.publishedAt,
      payload.publishedAt
    );
    const marker = relatedNoticeContextMarker(
      notice.relation,
      notice.publishedAt,
      payload.publishedAt
    );
    sections.push(
      "",
      `[${relatedNoticeSourceId(notice.messageId)}]`,
      `rolle: ${relatedNoticeRelationLabel(notice.relation)}`,
      `publisert: ${formatNorwegianNoticeDate(notice.publishedAt)} (${relatedNoticeDistanceLabel(daysBefore)})`,
      `anbefalt tidsmarkør: ${marker}`,
      `utsteder: ${notice.issuerName} (${notice.issuerSign})`,
      `title: ${notice.title}`,
      `textChars: ${notice.textChars}`,
      "<<<",
      notice.text,
      ">>>"
    );
  }
  sections.push(
    "",
    "SLUTTANKER: Dagens kildepakke bestemmer nyhetskroken og dagens status. [prior_*] er bare tids- eller relasjonsmerket bakgrunnskontekst."
  );
  return sections;
}

export function maxVisibleArticleCharsForOutputMode(mode?: OutputMode): number {
  return mode === "extended_notice" ? 1800 : 1000;
}

export function maxVisibleArticleCharsForPayload(payload: PromptPayload): number {
  return payload.maxVisibleArticleChars ?? maxVisibleArticleCharsForOutputMode(payload.outputMode);
}

export function lengthInstructionForPayload(payload: PromptPayload): string {
  const maxChars = maxVisibleArticleCharsForPayload(payload);
  return `Synlig artikkeltekst maks ${maxChars} tegn. Tittel og metadata teller ikke med.`;
}

const MECHANISM_FIRST_RULE = [
  "MEKANISMEFORKLARING",
  "- Forklar hva begrepet gjor i akkurat denne meldingen, ikke gi en leksikondefinisjon.",
  "- Forklar hvorfor strukturen er med, hva den endrer, og hvordan den fungerer innenfor fakta i kilden.",
  "- Ikke gjor forklaringen mer analytisk, spekulativ eller radgivende."
].join("\n");

const QUOTE_USER_INSTRUCTION =
  "Sjekk kilden for navngitte uttalelser fra CEO, CFO, styreleder, primærinnsider eller annen nøkkelperson. Finnes en uttalelse som forklarer årsak, marked, risiko, utsikter eller hendelsen, skal saken normalt bruke ett kort sitatstrek-avsnitt på naturlig norsk. Bruk kildefast «...»-formulering når sitatet passer bedre i en løpende setning. Bruk ren personattribuert parafrase bare når et direkte sitat blir for langt, uklart eller unaturlig. Dropp uttalelsen bare hvis den er ren PR uten innhold (legg den da i excluded_hype) eller saken er en svært kort rutinemelding.";

const EXTRA_SOURCE_INSTRUCTION =
  "Bruk denne kildeteksten bare når den tilfører nyhetsverdig substans, forklaring eller relevant personuttalelse. Et kort sitatstrek-avsnitt eller en kildefast «...»-formulering fra CEO, CFO, styreleder eller annen nøkkelperson kan brukes selv om hovedfakta allerede står i børsmeldingen, hvis uttalelsen forklarer årsak, risiko, utsikter, strategi eller betydningen av hendelsen.";

export function supplementalMaterialsPromptSection(
  payload: Pick<PromptPayload, "supplementalMaterials">
): string[] {
  const materials = payload.supplementalMaterials?.filter((material) =>
    material.text.trim()
  );
  if (!materials || materials.length === 0) {
    return [];
  }

  const sections: string[] = [
    "",
    "SUPPLERENDE MATERIALE (SEKUNDAERE KILDER):",
    EDITORIAL_SUPPLEMENTAL_MATERIALS
  ];
  for (const material of materials) {
    sections.push(
      "",
      `[${material.sourceId}]`,
      `type: ${material.kind}`,
      `title: ${material.title}`,
      ...(material.url ? [`url: ${material.url}`] : []),
      `textChars: ${material.textChars ?? material.text.length}`,
      "<<<",
      material.text,
      ">>>"
    );
  }
  return sections;
}

export function createSystemPrompt(): string {
  const basePrompt = [
    "Du er nyhetsjournalist i E24-redaksjonen.",
    "Du skriver korte borsnyheter pa norsk Bokmal for en travel leser som scanner nyheter pa mobilen.",
    "Leseren vil vite hva som er mest vesentlig for selskapet og aksjonærene, uten at vi vurderer aksjen, spår kursreaksjon eller gir investeringsråd.",
    "Skriv klart for en travel, finansielt interessert leser uten a skrive ned til leseren.",
    "Ikke vaer en papegøye som bare omformulerer meldingen. Plukk ut det viktigste, det overraskende eller det dramatiske.",
    "Ikke folg kildens struktur eller rekkefolge. Du er redaktoren — du bestemmer hva som kommer forst, hva som kuttes, og hvordan saken bygges opp. Det viktigste for leseren kommer forst, uansett hvor det sto i kilden.",
    "Kutt stoy og uvesentlige detaljer. Fokuser pa det som er vesentlig for selskapet og aksjonærene.",
    "Hvis et borsbegrep ma brukes (emisjon, warrant, spleis o.l.), forklar det gjennom kontekst i neste setning, ikke med en definisjon.",
    "Teksten skal leses som en publiserbar nyhet, ikke som et sammendrag av en melding.",
    "Du skriver i aktiv form og tidsnaer presens.",
    "Du bruker omvendt nyhetspyramide: det viktigste forst.",
    "Skriv kort. Hold deg til tegngrensen i oppgaven.",
    "Lengden pa kilden sier ingenting om hvor lang saken skal vaere. Vi bestemmer hva som er viktig og skriver knapt.",
    "Bruk kun informasjon som star eksplisitt i kilden.",
    "Ikke spekuler, ikke overdriv, og ikke legg til tall eller fakta."
  ].join(" ");

  return [basePrompt, EDITORIAL_SOURCE_AS_DATA, MECHANISM_FIRST_RULE].join("\n\n");
}

const STYLE_EXAMPLES = `
Innsidehandel med oppramsing (3 body-avsnitt):
{"title":"ABG-topper selger aksjer for over 24 mill.","lead":"To av toppsjefene i meglerhuset ABG Sundal Collier har solgt aksjer i eget selskap for til sammen over 24 mill. kroner. Det går frem av en børsmelding.","body":["Styreleder Knut Brundtland solgte aksjer for ca. 13,5 mill. kroner, til en kurs på 8 kroner per aksje.","Aksjesjef Hans Øyvind Haukeli solgte for ca. 10,8 mill. kroner til samme kurs.","Til sammen er det solgt aksjer for over 24 mill. kroner."],"company_sentence":"ABG Sundal Collier er et nordisk megler- og investeringsselskap.","key_facts":["To toppledere solgt for til sammen over 24 mill.","Kurs 8 kroner per aksje"],"negative_or_surprising":["Stort innsidersalg fra to toppledere samtidig"],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"medium","source_spans":["solgt 1.690.000 ABG-aksjer til en kurs på 8 kroner","solgt 1.352.000 aksjer"]}

Innsidehandel med ekstra skjema (1 body-avsnitt, merk: skjemareferanse BARE i source_limitations):
{"title":"Odfjell Technology-topp løser inn alle opsjoner","lead":"Jone Torstensen, en toppleder i Odfjell Technology, har løst inn alle opsjonene sine i selskapet.","body":["Opsjonene ble tildelt i juni 2022 som del av en insentivordning for ansatte. De kunne gjøres opp i aksjer eller kontant basert på aksjeverdien, ifølge børsmeldingen."],"company_sentence":"Odfjell Technology leverer teknologi og løsninger til olje- og gassindustrien.","key_facts":["Primærinnsider har løst inn alle opsjoner","Opsjonene ble tildelt i juni 2022"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":["Vedlagt skjema med detaljer om antall opsjoner og kurs er ikke analysert"],"confidence":"medium","importance":"uviktig","source_spans":["exercised all of his share options","granted on 14 June 2022"]}

Avlyst reparasjonsemisjon (kort og ferdig i lead):
{"title":"Idex dropper reparasjonsemisjon","lead":"Biometriselskapet Idex Biometrics dropper den planlagte reparasjonsemisjonen etter at aksjen har handlet til eller under emisjonskursen på 8,25 kroner. Selskapet opplyser dette i en børsmelding.","body":[],"company_sentence":"Idex Biometrics utvikler løsninger for fingeravtrykk og betalingsteknologi.","key_facts":["Dropper planlagt reparasjonsemisjon","Aksjen har handlet til eller under emisjonskursen"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"uviktig","source_spans":["cancellation of the subsequent offering","traded at or below the subscription price"]}

Fullmakt til generalforsamling (forklar hva fullmakt betyr):
{"title":"Vow-styreleder kan stemme for 5,65 prosent","lead":"Vow-styreleder Thomas F. Borgen kan stemme for 5,65 prosent av aksjene på generalforsamlingen etter å ha fått fullmakter fra andre aksjonærer. Det viser en børsmelding.","body":["Fullmaktene gjelder bare generalforsamlingen og er uten stemmeinstruks. Det betyr at aksjonærene ikke har sagt hvordan han skal stemme for aksjene."],"company_sentence":"Vow leverer teknologi for avfallshåndtering og ren energi.","key_facts":["Styreleder kan stemme for 5,65 prosent av aksjene","Fullmaktene kommer fra andre aksjonærer"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"uviktig","source_spans":["proxies without voting instructions","5.65% of the shares"]}

Ren tegningspåminnelse (støy, ekstremt kort hvis den likevel skrives):
{"title":"Awilco LNG har tegningsfrist i dag","lead":"Awilco LNG har siste tegningsdag i reparasjonsemisjonen i dag. Det opplyser selskapet i en børsmelding.","body":["Meldingen inneholder ingen nye vilkår eller resultat fra tilbudet."],"company_sentence":"Awilco LNG frakter flytende naturgass.","key_facts":["Siste tegningsdag i reparasjonsemisjon"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"uviktig","source_spans":["last day of subscription period","expires today"]}

Kontrakt (2 body-avsnitt):
{"title":"AF Gruppen-datter lander 200 mill.-kontrakt","lead":"Betonmast, et datterselskap av AF Gruppen, har signert en kontrakt på 200 mill. kroner med Ragn-Sells for bygging av et nullutslippsanlegg for næringsavfall i Drammen, melder selskapet.","body":["Kontrakten er en totalentreprise, som betyr at Betonmast tar ansvar for hele byggeprosjektet.","Anlegget skal sortere næringsavfall og bygges med tilhørende infrastruktur."],"company_sentence":"Betonmast er et datterselskap av entreprenørkonsernet AF Gruppen.","key_facts":["Kontrakt verdt 200 mill. kroner","Nullutslippsanlegg i Drammen"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"uviktig","source_spans":["kontrakt med Ragn-Sells","totalentreprise med verdi på rundt 200 millioner kroner"]}

Hendelse med sitat (3 body-avsnitt):
{"title":"Norse Atlantic setter opp ekstrafly","lead":"Flyselskapet Norse Atlantic legger til ekstra flyginger mellom London og Bangkok fordi urolighetene i Midtøsten har endret flyrutene globalt.","body":["Endringene i luftrommet gjør at flere reisende trenger alternative ruter mellom Europa og Sørøst-Asia, opplyser selskapet.","De fire ekstraflygningene går 9. og 11. mars fra London, med retur 10. og 12. mars.","– Vi ser økt behov for alternative langdistanseruter mellom Europa og Asia, sier konsernsjef Eivind Roald."],"company_sentence":"Norse Atlantic Airways er et norsk flyselskap som flyr langdistanseruter.","key_facts":["Fire ekstra flyginger London–Bangkok","Skyldes endringer i luftrom på grunn av Midtøsten"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"medium","source_spans":["to ekstra tur-retur-flygninger","CEO Eivind Roald: 'We see increased need for alternative long-haul routes between Europe and Asia'"]}

Resultatvarsel med kildefast formulering («...» i løpende tekst og sitatstrek):
{"title":"Elopak venter svakere salg i Europa","lead":"Emballasjeselskapet Elopak venter svakere salg i Europa i andre halvår, går det frem av en børsmelding.","body":["Selskapet skriver at salget i Europa ventes å bli «klart svakere enn tidligere antatt», og peker på at kundene utsetter bestillinger.","– Vi ser at flere kunder skyver ordrer til neste år, men etterspørselen utenfor Europa er stabil, sier konsernsjef Thomas Körmendi."],"company_sentence":"Elopak produserer kartongemballasje for drikkevarer.","key_facts":["Venter svakere salg i Europa i andre halvår","Kunder utsetter bestillinger"],"negative_or_surprising":["Resultatvarsel for Europa-virksomheten"],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"viktig","source_spans":["'European sales are expected to be clearly weaker than previously assumed'","CEO Thomas Körmendi: 'We see several customers pushing orders into next year, while demand outside Europe remains stable'"]}

Kontrakt med ledelseskommentar (sitatstrek i eget avsnitt, PR-del i excluded_hype):
{"title":"Nordic Semiconductor lander storkontrakt i USA","lead":"Brikkeprodusenten Nordic Semiconductor har signert en treårig leveranseavtale verdt 40 millioner dollar med en amerikansk industrikunde, melder selskapet.","body":["Avtalen gjelder trådløse brikker til sensorer som overvåker industrianlegg.","– Dette er den største enkeltkontrakten vår i USA, og leveransene starter i første kvartal, sier administrerende direktør Vegard Wollan."],"company_sentence":"Nordic Semiconductor utvikler trådløse halvlederbrikker.","key_facts":["Treårig avtale verdt 40 millioner dollar","Leveranser fra første kvartal"],"negative_or_surprising":[],"excluded_hype":["CEO-utsagn om at selskapet er 'thrilled' over samarbeidet — generisk PR"],"source_limitations":[],"confidence":"high","importance":"medium","source_spans":["three-year supply agreement valued at USD 40 million","CEO Vegard Wollan: 'This is our largest single contract in the US, with deliveries starting in the first quarter'"]}

Avtale med sitat etter kontekst (sitatstrek, ikke parafrase):
{"title":"Storebrand forhandler om Knif-avtale","lead":"Storebrand Forsikring har forhandlet frem avtaler om å slå sammen virksomhet med Knif og Knif Trygghet, melder selskapet.","body":["Det er nå opp til eierne bak Knif og Knif Trygghet om de ønsker å tiltre avtalene som er fremforhandlet av partene.","– Vi håper eierne i Knif ser verdien i å fusjonere, og vi ser frem til et langt og godt samarbeid, sier Storebrand Forsikring-sjef Trond Fladvad i meldingen."],"company_sentence":"Storebrand Forsikring er skadeforsikringsdelen av Storebrand-konsernet.","key_facts":["Fremforhandlede avtaler med Knif og Knif Trygghet","Eierne i Knif må ta stilling til avtalene"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"medium","source_spans":["Det er nå opp til eierne bak Knif og Knif Trygghet","Trond Fladvad: 'Vi håper eierne i Knif ser verdien i å fusjonere'"]}

Tilleggsmateriale med analytikersitat (sitatstrek og oppfølging, ikke kursmål):
{"title":"Kongsberg setter nye vekstmål","lead":"Kongsberg Gruppen har kapitalmarkedsdag onsdag, der forsvarskonsernet legger frem nye finansielle mål.","body":["I 2029 har selskapet mål om å omsette for 100 milliarder kroner og 150 milliarder i 2033.","– De nye målene ligger i øvre del av forventningene, skriver Pareto Securities-analytiker Fabian Jørgensen i et notat.","Han skriver videre at opptrappingen skjer raskere enn meglerhuset hadde antatt."],"company_sentence":"Kongsberg Gruppen er et norsk teknologikonsern med hovedvekt på forsvar og romfart.","key_facts":["Mål om 100 mrd. kroner i omsetning i 2029","Mål om 150 mrd. kroner i 2033"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"viktig","source_spans":["mål om å omsette for 100 milliarder kroner og 150 milliarder i 2033","material_pareto: Fabian Jørgensen: 'målene ligger i øvre del av forventningene'"]}

Materiell hendelse (2 body-avsnitt):
{"title":"Gulf Keystone stopper produksjonen","lead":"Oljeselskapet Gulf Keystone har midlertidig stengt ned produksjonen i Kurdistan i Irak på grunn av sikkerhetssituasjonen.","body":["Selskapet har satt i gang tiltak for å beskytte de ansatte. Oljeanleggene er ikke skadet, ifølge meldingen.","Gulf Keystone følger situasjonen tett og lover å komme med oppdateringer."],"company_sentence":"Gulf Keystone er et oljeselskap som produserer olje i Kurdistan-regionen i Irak.","key_facts":["Produksjonen er stanset midlertidig","Ansatte beskyttes, anlegg ikke skadet"],"negative_or_surprising":["Produksjonsstans grunnet sikkerhetssituasjon"],"excluded_hype":[],"source_limitations":[],"confidence":"high","importance":"viktig","source_spans":["midlertidig har stengt produksjonen","tiltak for å beskytte ansatte"]}
`.trim();

export function createDeveloperPrompt(
  _schemaJson?: string,
  context?: DeveloperPromptContext
): string {
  const relatedNoticeRules = hasRelatedNoticeContext(context)
    ? `\n\n${EDITORIAL_RELATED_NOTICES}`
    : "";
  const basePrompt = `OPPGAVE
Lag en kort nyhetssak i E24-stil. Ikke et referat, men en publiserbar nyhet.
Leseren vil vite hva som er mest vesentlig for selskapet og aksjonærene, uten at vi vurderer aksjen, spår kursreaksjon eller gir investeringsråd. Vanlige finansord som 'datterselskap', 'kontrakt' og 'aksjekapital' er greit, men tyngre jargong ma forklares gjennom kontekst.

${EDITORIAL_AUDIENCE}
- Vi er ikke papegøyer som bare omformulerer borsmeldingen. Vi plukker ut det viktige, overraskende eller dramatiske.
- Ikke prøv å løfte rutineinformasjon over nyhetsterskelen. Hvis tilgjengelig tekst bare sier at et dokument, en presentasjon eller et skjema er publisert, er det støy: skriv ekstremt kort, sett importance til 'uviktig' og legg manglende grunnlag i source_limitations.
- Rene påminnelser om tegningsperiode, siste tegningsdag eller oppstart av tegningsperiode er støy hvis de ikke inneholder nye vilkår, proveny, resultat eller konsekvens.

${EDITORIAL_SOURCE_AS_DATA}

${EDITORIAL_SUPPLEMENTAL_MATERIALS}${relatedNoticeRules}

${MECHANISM_FIRST_RULE}

${EDITORIAL_LANGUAGE}

STRUKTUR
${EDITORIAL_TITLE}
- body: 1-8 avsnitt som bygger videre pa lead. Skriv sa kort som mulig uten a miste det viktigste.
  De fleste saker klarer seg med 1-3 avsnitt. Bruk flere bare hvis det virkelig trengs.
  Alt som står i tittelen må ha dekning i lead eller body.
  Korte avsnitt med oppramsing av datapunkter (innsidehandler, kursendringer o.l.) er ok.
  Gode titler: 'Scatec starter bygging av solkraftverk', 'Polight får millionordre', 'Awilco henter 251 millioner', 'Tre trekker seg før KMC-sammenslåing'.
  Darlige titler: 'Scatec starter bygging av 255 MW solkraftverk i Sør-Afrika', 'Tre trekker seg fra KMC Properties-fusjonen'.
  Nar tittelen har to poeng, bruk helst en normal verbtittel. Tankestrek kan brukes sparsomt; kolon skal nesten aldri brukes.
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

Sprak: norsk Bokmal. Tone: noytral, enkel og presis for en finansielt interessert leser uten profesjonell nisjekunnskap.
Bruk kun tall og fakta som finnes i kilden.
Hvis meldingen viser til ekstra dokumenter som ikke er analysert, legg inn begrensningen i source_limitations. Ikke vis dette i title, lead eller body.

SELVSJEKK SITAT
Før du leverer: Hvis kilden har en navngitt nøkkelpersonuttalelse med konkret innhold — står den i saken som sitatstrek eller kildefast «...»? Hvis du bare har parafrasert den, vurder om den heller bør være et kort sitatstrek-avsnitt. Hvis uttalelsen ikke brukes, står den i excluded_hype? Hvis nei, rett det.

${EDITORIAL_NORWEGIAN}`;

  return basePrompt;
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
    `sourceBodyChars: ${payload.sourceBodyChars}`,
    `outputMode: ${payload.outputMode ?? "notice"}`,
    `maxVisibleArticleChars: ${maxVisibleArticleCharsForPayload(payload)}`
  ].join("\n");

  const parts = [
    "Lag en kort, publiserbar nyhetssak fra kilden under.",
    "Skriv nyhetstekst, ikke sammendrag. Plukk ut det som er mest vesentlig for selskapet og aksjonærene.",
    "Skriv klart for en travel, finansielt interessert leser. Unnga tung jargong — bruk hverdagsord der det finnes.",
    "Lead + body maks 1000 tegn. Kildens lengde styrer ikke sakens lengde — skriv knapt uansett.",
    "Bruk aktiv form, presens og omvendt nyhetspyramide.",
    "Kilden er en borsmelding fra Newsweb.",
    EDITORIAL_SOURCE_AS_DATA,
    "Bruk kun data i kildene under. Ikke bruk markdown.",
    QUOTE_USER_INSTRUCTION,
    "",
    "Metadata:",
    metadata,
    "",
    "KILDE (FULL ORIGINALTEKST):",
    "<<<",
    payload.bodyText || "ikke oppgitt",
    ">>>"
  ];

  const lengthLineIndex = parts.findIndex((part) =>
    part.startsWith("Lead + body maks 1000 tegn.")
  );
  if (lengthLineIndex >= 0) {
    parts[lengthLineIndex] =
      `${lengthInstructionForPayload(payload)} Kildens lengde styrer ikke sakens lengde; skriv knapt uansett.`;
  }

  if (payload.pdfSupplementText) {
    parts.push(
      "",
      "EKSTRA KILDETEKST FRA SELSKAPET:",
      EXTRA_SOURCE_INSTRUCTION,
      "<<<",
      payload.pdfSupplementText,
      ">>>"
    );
  }

  parts.push(...supplementalMaterialsPromptSection(payload));
  parts.push(...relatedNoticesPromptSection(payload));

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
    `sourceBodyChars: ${payload.sourceBodyChars}`,
    `outputMode: ${payload.outputMode ?? "notice"}`,
    `maxVisibleArticleChars: ${maxVisibleArticleCharsForPayload(payload)}`
  ].join("\n");

  const formattedPrevious = formatRewriteForRevisionPrompt(previousOutput);

  const parts = [
    "Lag en revidert versjon av nyhetssaken under, basert pa instruksjonen.",
    "VIKTIG: Instruksjonen er styrende. Hvis instruksjonen ber om ny vinkel, annet fokus, annen struktur, annen lengde eller stor omskriving, skal du endre alle berorte felt tydelig.",
    EDITORIAL_REVISION_PRIORITY,
    EDITORIAL_SOURCE_AS_DATA,
    "Behold bare tekst som fortsatt passer med instruksjonen. Ikke gjor tilfeldige smaendringer for variasjon.",
    "Hvis instruksjonen er smal og konkret, endrer du bare det som trengs. Sarlig ved 'fjern/kutt/dropp/ta bort dette: ...' skal du fjerne bare den angitte teksten og ellers bevare forrige versjon.",
    "Hvis instruksjonen er bred, kan du skrive om tittel, lead, body, key_facts, importance og source_spans sa mye som nodvendig.",
    `${lengthInstructionForPayload(payload)} Maks 8 body-avsnitt. Hvis instruksjonen ber om mer tekst, prioriter innenfor denne maksgrensen.`,
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
    QUOTE_USER_INSTRUCTION,
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
          "EKSTRA KILDETEKST FRA SELSKAPET:",
          EXTRA_SOURCE_INSTRUCTION,
          "<<<",
          payload.pdfSupplementText,
          ">>>"
        ]
      : []),
    ...supplementalMaterialsPromptSection(payload),
    ...relatedNoticesPromptSection(payload),
    "",
    "INSTRUKSJON:",
    instruction
  ];

  return parts.join("\n");
}
