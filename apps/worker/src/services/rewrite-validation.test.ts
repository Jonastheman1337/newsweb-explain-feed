import type { PromptPayload } from "@newsweb/prompt-kit";
import {
  rewriteOutputJsonSchema,
  rewriteOutputSchema,
  type RewriteOutput
} from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  countVisibleArticleChars,
  countWords,
  countSentences,
  countSummarySentences,
  validateRewriteOutput
} from "./rewrite-validation.js";

function createPayload(overrides?: Partial<PromptPayload>): PromptPayload {
  const bodyText =
    "Selskapet melder at omsetningen var 100 i kvartalet. Resultatet var 20. Guiding er ikke oppgitt.";
  return {
    messageId: 1,
    title: "Kvartalsrapport",
    issuerName: "Test ASA",
    issuerSign: "TEST",
    publishedAt: "2026-02-27T12:00:00.000Z",
    categories: ["FINANCIAL REPORTS"],
    markets: ["XOSL"],
    bodyText,
    hasAttachments: false,
    sourceBodyChars: bodyText.length,
    ...overrides
  };
}

function createRewrite(overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Kort oppdatering",
    lead: "Selskapet la frem kvartalstall.",
    body: [
      "Omsetningen i kvartalet var 100.",
      "Resultatet i perioden var 20.",
      "Meldingen oppgir ingen ny guiding."
    ],
    company_sentence: "Test ASA er et norsk selskap notert pa Oslo Bors.",
    key_facts: ["Omsetning 100", "Resultat 20", "Guiding ikke oppgitt"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "high",
    importance: "medium",
    source_spans: ["omsetningen var 100", "Resultatet var 20"],
    ...overrides
  };
}

describe("countSentences", () => {
  it("counts punctuation-terminated sentences", () => {
    expect(countSentences("En. To? Tre!")).toBe(3);
  });

  it("treats plain text as one sentence", () => {
    expect(countSentences("Ingen punktum i denne teksten")).toBe(1);
  });
});

describe("countWords", () => {
  it("counts words in headline-like strings", () => {
    expect(countWords("Norsk Titanium inn i forsvar med GA")).toBe(7);
  });
});

describe("countSummarySentences", () => {
  it("sums lead and body sentence counts", () => {
    const rewrite = createRewrite({
      lead: "En setning.",
      body: ["To setninger her. Ja.", "En setning.", "En setning."]
    });
    expect(countSummarySentences(rewrite)).toBe(5);
  });
});

describe("countVisibleArticleChars", () => {
  it("counts lead and body but not title or metadata", () => {
    const rewrite = createRewrite({
      title: "Dette telles ikke",
      lead: "Lead",
      body: ["Body"]
    });
    expect(countVisibleArticleChars(rewrite)).toBe("Lead\n\nBody".length);
  });
});

describe("rewrite output schema", () => {
  it("allows lead-only rewrites with an empty body", () => {
    const parsed = rewriteOutputSchema.safeParse(createRewrite({ body: [] }));

    expect(parsed.success).toBe(true);
    expect(rewriteOutputJsonSchema.properties.body.minItems).toBe(0);
  });
});

describe("validateRewriteOutput", () => {
  it("warns on one unexpected number token", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall med nye detaljer.",
      body: [
        "Omsetningen i kvartalet var 101 i denne omtalen.",
        "Meldingen oppgir ingen ny guiding."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      code: "UNEXPECTED_NUMBERS",
      severity: "warning",
      message: "Unexpected numbers: 101"
    });
  });

  it("warns with all unexpected number tokens", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall med nye detaljer.",
      body: [
        "Omsetningen i kvartalet var 101 i denne omtalen.",
        "Resultatet i perioden var 21 ifolge omtalen.",
        "Kontantbeholdningen var 303 ved periodens slutt."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.errors).toContain("Unexpected numbers: 101, 21, 303");
  });

  it("uses PDF supplement text when validating numbers", () => {
    const payload = createPayload({
      pdfSupplementText:
        "The selected report page shows revenue of 303 and operating profit of 404."
    });
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall med nye detaljer.",
      body: [
        "Omsetningen i kvartalet var 303.",
        "Driftsresultatet i perioden var 404.",
        "Meldingen oppgir ingen ny guiding."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.errors.some((error) => error.startsWith("Unexpected numbers:"))).toBe(
      false
    );
  });

  it("allows simple source-derived insider trade totals", () => {
    const payload = createPayload({
      title: "Mandatory notification of trade",
      bodyText:
        "Lorenz AS has acquired 10.000 shares at an average price of NOK 3,43 per share."
    });
    const rewrite = createRewrite({
      title: "Lorenz kjøper aksjer",
      lead:
        "Lorenz har kjøpt aksjer for 34.300 kroner, ifølge en børsmelding.",
      body: [],
      key_facts: ["Kjøpt for 34.300 kroner"],
      source_spans: ["10.000 shares", "NOK 3,43 per share"]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.issues.some((issue) => issue.code === "UNEXPECTED_NUMBERS")).toBe(
      false
    );
  });

  it("fails when summary exceeds max sentence limit", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "En. To. Tre.",
      body: [
        "Fire. Fem. Seks.",
        "Sju. Atte. Ni.",
        "Ti. Elleve. Tolv.",
        "Tretten. Fjorten. Femten.",
        "Seksten."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Summary exceeds 15 sentences.");
  });

  it("fails when company_sentence has more than one sentence", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      company_sentence: "Test ASA er notert. Selskapet driver industri."
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "company_sentence must contain exactly one sentence."
    );
  });

  it("fails when title exceeds eight words", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      title: "Norsk Titanium med stor milepael i forsvarsmarkedet med Boeing"
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Title exceeds 8 words.");
  });

  it("fails when visible article text uses percent signs", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall.",
      body: ["Omsetningen steg 10% i kvartalet."]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Visible article text uses %, write prosent instead."
    );
  });

  it("fails when visible article text refers to PDF or attachments", () => {
    const payload = createPayload({ hasAttachments: true });
    const rewrite = createRewrite({
      lead: "Selskapet opplyser om nye detaljer i PDF-vedlegget.",
      body: ["Vedlegget viser at avtalen gjelder fra andre kvartal."],
      source_limitations: ["Ekstra dokumenter er bare delvis analysert."]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Visible article text refers to PDF/attachments, analyzed material, or missing source data; move limitations to source_limitations."
    );
    expect(result.blockingErrors).toContain(
      "Visible article text refers to PDF/attachments, analyzed material, or missing source data; move limitations to source_limitations."
    );
    expect(result.issues).toContainEqual({
      code: "VISIBLE_META_SOURCE_LANGUAGE",
      severity: "blocking",
      message:
        "Visible article text refers to PDF/attachments, analyzed material, or missing source data; move limitations to source_limitations."
    });
  });

  it("blocks visible extraction/meta limitation language from reviewed notices", () => {
    const payload = createPayload({ hasAttachments: true });
    const rewrite = createRewrite({
      title: "5th Planet Games med Q1-melding uten tall",
      lead:
        "Den korte meldingen som er analysert, inneholder ingen finansielle nøkkeltall.",
      body: [
        "Ifølge den analyserte rapportkonteksten fremstår vedlegget som en énsides melding.",
        "Inntekter og resultat er ikke oppgitt i det analyserte materialet."
      ],
      source_limitations: ["Full rapport er ikke analysert."]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.valid).toBe(false);
    expect(result.blockingErrors).toHaveLength(1);
    expect(result.issues.some((issue) => issue.code === "VISIBLE_META_SOURCE_LANGUAGE")).toBe(
      true
    );
  });

  it("warns on colon-heavy titles", () => {
    const result = validateRewriteOutput(
      createRewrite({ title: "DOF: Resultat etter skatt falt" }),
      createPayload()
    );

    expect(result.issues).toContainEqual({
      code: "COLON_HEAVY_TITLE",
      severity: "warning",
      message:
        "Title uses a colon; prefer a normal sentence-style headline unless it introduces a list."
    });
  });

  it("fails when visible article text exceeds the 1000 character cap", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall.",
      body: ["A".repeat(980)]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Visible article text exceeds 1000 chars.");
  });

  it("allows an explicit higher visible character cap", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall.",
      body: ["A".repeat(980)]
    });

    const result = validateRewriteOutput(rewrite, payload, {
      maxVisibleArticleChars: 1200
    });
    expect(result.errors).not.toContain("Visible article text exceeds 1000 chars.");
    expect(result.errors).not.toContain("Visible article text exceeds 1200 chars.");
  });

  it("flags currency markers that are not present in the source", () => {
    const payload = createPayload({
      bodyText:
        "Selskapet melder at inntektene var 10 millioner dollar i kvartalet."
    });
    const rewrite = createRewrite({
      lead: "Selskapet melder om inntekter pa 10 millioner kroner.",
      body: ["Meldingen oppgir ikke andre tall."]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Visible article text uses currency not present in source: NOK/kroner."
    );
  });

  it("allows converted currency when the source explicitly includes it", () => {
    const payload = createPayload({
      bodyText:
        "Selskapet melder at inntektene var 10 millioner dollar, tilsvarende 105 millioner kroner."
    });
    const rewrite = createRewrite({
      lead:
        "Selskapet melder om inntekter på 10 millioner dollar, tilsvarende 105 millioner kroner.",
      body: ["Meldingen oppgir ikke andre tall."],
      key_facts: ["Inntekter 10 millioner dollar", "Tilsvarer 105 millioner kroner"],
      source_spans: ["10 millioner dollar", "105 millioner kroner"]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.issues.some((issue) => issue.code === "UNEXPECTED_CURRENCY")).toBe(
      false
    );
    expect(result.issues.some((issue) => issue.code === "UNEXPECTED_NUMBERS")).toBe(
      false
    );
  });

  it("does not treat Swedish kroner as unexpected NOK currency", () => {
    const payload = createPayload({
      bodyText:
        "Selskapet melder at kontrakten har en verdi på SEK 50 million."
    });
    const rewrite = createRewrite({
      lead: "Selskapet har fått en kontrakt på 50 millioner svenske kroner.",
      body: ["Meldingen oppgir ikke andre tall."]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(
      result.issues.some(
        (issue) =>
          issue.code === "UNEXPECTED_CURRENCY" &&
          issue.message.includes("NOK/kroner")
      )
    ).toBe(false);
  });

  it("blocks generic report-publication rewrites without concrete report facts", () => {
    const payload = createPayload({
      title: "VDI: Vantage Drilling International Ltd. 2025 Annual Report",
      bodyText: "The 2025 annual report has been published and is attached.",
      hasAttachments: true
    });
    const rewrite = createRewrite({
      title: "Vantage Drilling publiserer årsrapport",
      lead:
        "Offshoreriggselskapet Vantage Drilling har publisert årsrapporten for 2025, ifølge en børsmelding.",
      body: [
        "I rapporten peker selskapet på risiko knyttet til liten riggflåte, få kunder og korte borekontrakter."
      ],
      source_limitations: ["Kun et utdrag av rapporten er analysert"]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.issues).toContainEqual({
      code: "GENERIC_REPORT_PUBLICATION",
      severity: "blocking",
      message:
        "Report notice was rewritten as a generic report-publication story without concrete report facts."
    });
  });

  it("allows report rewrites that include concrete report facts", () => {
    const payload = createPayload({
      title: "ARLES: Quarterly Report Arles I B.V. Q2",
      bodyText:
        "Result before tax was EUR -18.1m, compared with EBT of EUR -5.8m in Q2 2024-2025."
    });
    const rewrite = createRewrite({
      title: "Arles øker kvartalstapet",
      lead:
        "Arles I øker tapet i andre kvartal, viser delårsrapporten. Resultat før skatt endte på minus 18,1 millioner euro, mot minus 5,8 millioner året før.",
      body: ["Inntektene falt til 79,8 millioner euro, fra 83,4 millioner året før."]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(
      result.issues.some((issue) => issue.code === "GENERIC_REPORT_PUBLICATION")
    ).toBe(false);
  });

  it("flags missing right of reply when the source includes accusations and denial", () => {
    const payload = createPayload({
      bodyText:
        "Selskapet opplyser at en tidligere leder er anklaget for regnskapsbrudd. Den tidligere lederen avviser anklagene og sier seg uenig i fremstillingen."
    });
    const rewrite = createRewrite({
      lead: "En tidligere leder er anklaget for regnskapsbrudd.",
      body: ["Saken omtales i en borsmelding fra selskapet."]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Source contains criticism/accusation and a reply, but reply is missing from visible article text."
    );
  });

  it("flags likely revenue/result terminology mixups", () => {
    const payload = createPayload({
      bodyText:
        "Selskapet melder at inntektene var 100 millioner kroner i kvartalet. Omsetningen var stabil sammenlignet med samme periode i fjor."
    });
    const rewrite = createRewrite({
      lead: "Selskapet melder at resultatet var 100 millioner kroner.",
      body: ["Meldingen omtaler ikke andre tall."]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Source only appears to mention revenue/income, but visible article text uses result/profit/loss terminology."
    );
  });

  it("warns when the same visible number is repeated three or more times", () => {
    const payload = createPayload({
      bodyText:
        "Selskapet opplyser at inntektene var 100 millioner kroner og resultatet var 20 millioner kroner."
    });
    const rewrite = createRewrite({
      lead: "Inntektene var 100 millioner kroner.",
      body: [
        "Omsetningen var 100 millioner kroner.",
        "Selskapet gjentar at inntektene var 100 millioner kroner."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.issues.some((issue) => issue.code === "REPEATED_VISIBLE_NUMBER")).toBe(
      true
    );
  });

  it("does not count calendar dates as repeated visible numbers", () => {
    const payload = createPayload({
      bodyText:
        "Norges Bank vil utstede 3 milliarder kroner. Auksjonen skjer 3. juni."
    });
    const rewrite = createRewrite({
      lead: "Norges Bank vil utstede 3 milliarder kroner.",
      body: [
        "Auksjonen skjer 3. juni.",
        "Beløpet er på 3 milliarder kroner."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(
      result.issues.some((issue) => issue.code === "REPEATED_VISIBLE_NUMBER")
    ).toBe(false);
  });

  it("warns on unexplained proforma and named transactions", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet viser til proforma-tall for kvartalet.",
      body: ["Resultatet løftes av Evo-transaksjonen."]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.issues.some((issue) => issue.code === "UNEXPLAINED_PROFORMA")).toBe(
      true
    );
    expect(
      result.issues.some((issue) => issue.code === "UNEXPLAINED_NAMED_TRANSACTION")
    ).toBe(true);
  });

  it("warns on unexplained named platforms and project labels", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet viser til Endurance-plattformen i kvartalet.",
      body: ["Kostnadene er knyttet til Atlas-prosjektet."]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(
      result.issues.some((issue) => issue.code === "UNEXPLAINED_NAMED_TRANSACTION")
    ).toBe(true);
  });

  it("allows named platforms when the visible text explains them", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead:
        "Selskapet viser til Endurance-plattformen, som er en programvareplattform for salg og kundeoppfølging.",
      body: [
        "Evo-transaksjonen gjelder kjøpet av en installatørportefølje i Europa."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(
      result.issues.some((issue) => issue.code === "UNEXPLAINED_NAMED_TRANSACTION")
    ).toBe(false);
  });

  it("does not warn on ebitda when the full context is included", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead:
        "Driftsresultatet før renter, skatt, av- og nedskrivninger (ebitda) var 48 millioner.",
      body: ["Resultatet før skatt var 25 millioner."]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.issues.some((issue) => issue.code === "UNEXPLAINED_EBITDA")).toBe(
      false
    );
  });
});
