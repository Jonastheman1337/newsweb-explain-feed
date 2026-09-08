import { feedItemSchema } from "../../packages/shared/dist/api.js";

export function fixtureItem(id, issuer, title, lead, body, overrides = {}) {
  return feedItemSchema.parse({
    messageId: id,
    publishedAt: `2026-09-07T07:${id === 900001 ? "42" : "18"}:00.000Z`,
    visibilityStatus: "published",
    rewriteVersion: 1,
    rewriteId: `fixture-${id}-1`,
    publicationRevision: 1,
    contentHash: `fixture-${id}-1`,
    finalizedAt: "2026-09-07T07:43:00.000Z",
    isFinal: true,
    title,
    issuerName: issuer,
    issuerSign: issuer.split(" ")[0].toUpperCase(),
    lead,
    body,
    keyFacts: ["Fiktivt eksempel for lokal visning."],
    negativeOrSurprising: [],
    sourceLimitations: [],
    confidence: "high",
    importance: "medium",
    hasAttachments: false,
    attachments: [],
    sourceTitle: title,
    sourceBodyText: `${lead}\n\n${body.join("\n\n")}`,
    categories: ["Selskapsmeldinger"],
    ...overrides
  });
}

// Fictional PDF text "read by the model" for the preview's PDF-tekst tab.
export const fixtureModelSources = new Map([
  [
    900001,
    {
      pageCount: 2,
      attachmentId: 1,
      text: [
        "KEY METRICS (fiktivt eksempel)",
        "Kontraktsverdi: 420 millioner kroner. Varighet: tre år med opsjon på to år.",
        "",
        "---",
        "",
        "[PDF page 1]",
        "Nordvik Energy AS – Melding om kontrakt",
        "",
        "Nordvik Energy AS har i dag inngått en avtale med en operatør på norsk sokkel om vedlikehold av to plattformer i Nordsjøen. Avtalen har en varighet på tre år fra 1. januar 2027, med opsjon for operatøren på ytterligere to år.",
        "",
        "Kontrakten har en estimert verdi på 420 millioner kroner over den faste perioden. Arbeidet omfatter planlagt vedlikehold, inspeksjon og mindre modifikasjoner, og vil bli utført av selskapets eksisterende organisasjon i Stavanger og Bergen.",
        "",
        "– Dette er en viktig avtale som gir oss forutsigbarhet i tre år fremover, sier administrerende direktør Kari Nordvik.",
        "",
        "[PDF page 2]",
        "Om Nordvik Energy",
        "",
        "Nordvik Energy AS leverer vedlikeholds- og modifikasjonstjenester til olje- og gassindustrien. Selskapet har rundt 640 ansatte og hadde en omsetning på 1,9 milliarder kroner i 2025. Dette dokumentet er et fiktivt eksempel laget for lokal forhåndsvisning og beskriver ikke et reelt selskap.",
        "",
        "Kontakt: ir@nordvik-energy.example"
      ].join("\n")
    }
  ]
]);

export function initialFixtures() {
  return [
    fixtureItem(
      900001,
      "Nordvik Energy",
      "Nordvik sikrer kontrakt på 420 millioner",
      "Nordvik Energy har inngått en treårig avtale om vedlikehold av to plattformer i Nordsjøen. Kontrakten har en verdi på 420 millioner kroner, ifølge en børsmelding.",
      [
        "Arbeidet starter i januar. Avtalen omfatter en opsjon på ytterligere to år.",
        "Nordvik Energy leverer tjenester til olje- og gassindustrien."
      ],
      {
        importance: "viktig",
        hasAttachments: true,
        attachments: [
          {
            id: 1,
            fileName: "Nordvik_kontraktsmelding_2026.pdf",
            fileType: "application/pdf",
            fileSize: 184320
          }
        ]
      }
    ),
    fixtureItem(
      900002,
      "Fjord Seafood",
      "Fjord Seafood øker slaktevolumet",
      "Fjord Seafood slaktet 18.400 tonn laks i august. Det er opp fra 16.900 tonn i samme måned i fjor, opplyser selskapet.",
      [
        "Gjennomsnittlig salgspris var 76 kroner per kilo. Selskapet legger frem kvartalsrapporten i oktober."
      ]
    ),
    fixtureItem(900003, "Solheim Industri", "Solheim Industri: Endring i styret", "", [], {
      rewriteVersion: null,
      rewriteId: null,
      publicationRevision: 0,
      contentHash: null,
      finalizedAt: null,
      isFinal: false,
      notGenerated: true,
      skipped: true,
      sourceBodyText:
        "Solheim Industri melder at et styremedlem fratrer. Dette er et fiktivt eksempel."
    })
  ];
}
