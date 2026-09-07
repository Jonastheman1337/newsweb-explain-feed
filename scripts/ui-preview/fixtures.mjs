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
      { importance: "viktig" }
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
