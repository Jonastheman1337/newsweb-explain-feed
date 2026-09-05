import { readFileSync } from "node:fs";
import { defaultEnabledDerivationRules, type NumberDerivationRuleId, type PromptPayload } from "@newsweb/prompt-kit";
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
  collectQuoteTelemetry,
  detectMarkerLeaks,
  ensureReportSourceLimitation,
  markerLeakEnforcement,
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

describe("notice paid accounting outflow presentation", () => {
  const signedSource = "[PDF page 4]\nParent company financial statements\nTransactions with related parties\nEUR million\t2026\t2025\nDividends paid to shareholders\t-127.9\t-20.1";
  const paid = "Selskapet betalte 127,9 millioner euro i utbytte.";
  const validate = (text: string, source = signedSource, noticeSemantics = true) => validateRewriteOutput(
    createRewrite({ title: "Utbytte til eierne", lead: text, body: [], key_facts: [], source_spans: [] }),
    createPayload({ title: "Årsrapport", bodyText: source }), { noticeSemantics });
  const unexpected = (result: ReturnType<typeof validate>) => result.publicationNumberAssessments
    .filter(item => item.disposition === "unexpected").map(item => item.display);

  it("uses the same paid-outflow default for bare worker options and the evaluator's resolved rule list", () => {
    const rewrite = createRewrite({ title: "Utbytte til eierne", lead: paid, body: [], key_facts: [], source_spans: [] });
    const payload = createPayload({ title: "Årsrapport", bodyText: signedSource });
    const defaults = validateRewriteOutput(rewrite, payload, { noticeSemantics: true });
    expect(defaultEnabledDerivationRules).toContain("paid_outflow_magnitude");
    expect(validateRewriteOutput(rewrite, payload, { noticeSemantics: true, enabledDerivationRules: defaultEnabledDerivationRules })).toEqual(defaults);
    expect(defaults.valid).toBe(true);
  });

  it.each([
    { label: "all disabled", enabledDerivationRules: [] as NumberDerivationRuleId[] },
    { label: "paid rule disabled", enabledDerivationRules: defaultEnabledDerivationRules.filter(rule => rule !== "paid_outflow_magnitude") }
  ])("blocks the paid conversion with an exact override that omits its rule: $label", ({ enabledDerivationRules }) => {
    const result = validateRewriteOutput(
      createRewrite({ title: "Utbytte til eierne", lead: paid, body: [], key_facts: [], source_spans: [] }),
      createPayload({ bodyText: signedSource }), { noticeSemantics: true, enabledDerivationRules });
    expect(result.valid).toBe(false);
    expect(result.publicationNumberAssessments).toEqual([{
      display: "127,9", disposition: "unexpected", ruleId: null, candidateRuleId: "paid_outflow_magnitude", count: 1
    }]);
  });

  it("accepts a paid-only override in notices while keeping legacy and Sak matching unchanged", () => {
    const rewrite = createRewrite({ title: "Utbytte til eierne", lead: paid, body: [], key_facts: [], source_spans: [] });
    const payload = createPayload({ bodyText: signedSource });
    const enabledDerivationRules = ["paid_outflow_magnitude"] as const;
    expect(validateRewriteOutput(rewrite, payload, { noticeSemantics: true, enabledDerivationRules }).valid).toBe(true);
    expect(validateRewriteOutput(rewrite, payload, { enabledDerivationRules }).publicationNumberAssessments)
      .toEqual([{ display: "127,9", disposition: "unexpected", ruleId: null, count: 1 }]);
  });

  it("retains ordinary numeric acceptance when the paid rule is disabled", () => {
    const result = validateRewriteOutput(
      createRewrite({ title: "Utbytte til eierne", lead: paid, body: [], key_facts: [], source_spans: [] }),
      createPayload({ bodyText: signedSource + "\nThe paid dividend amount was EUR 127.9 million." }),
      { noticeSemantics: true, enabledDerivationRules: [] });
    expect(result.valid).toBe(true);
    expect(result.publicationNumberAssessments).toEqual([
      { display: "127,9", disposition: "matched", ruleId: "exact_source_match", count: 1 }
    ]);
  });

  it("keeps disabled-rule shadow identity specific to the supported payment occurrence", () => {
    const result = validateRewriteOutput(
      createRewrite({ title: "Utbytte til eierne", lead: paid, body: ["Resultatet var 127,9 millioner euro."], key_facts: [], source_spans: [] }),
      createPayload({ bodyText: signedSource }), { noticeSemantics: true, enabledDerivationRules: [] });
    expect(result.publicationNumberAssessments.filter(item => item.display === "127,9")).toEqual([
      { display: "127,9", disposition: "unexpected", ruleId: null, candidateRuleId: "paid_outflow_magnitude", count: 1 },
      { display: "127,9", disposition: "unexpected", ruleId: null, count: 1 }
    ]);
  });

  it("accepts the original signed paid-dividend row as a positive paid amount with literal evidence", () => {
    const fixture = JSON.parse(readFileSync(new URL("../fixtures/reports/servatur-remuneration-raw-2026-09-05.json", import.meta.url), "utf8")) as { pages: Array<{ pageNumber: number; text: string }> };
    const raw = fixture.pages.find(page => page.pageNumber === 66)!.text;
    const result = validate(paid, `[PDF page 66]\n${raw}`);
    expect(unexpected(result)).toEqual([]);
    expect(result.publicationNumberAssessments).toContainEqual(expect.objectContaining({
      display: "127,9", disposition: "derived", ruleId: "paid_outflow_magnitude", count: 1,
      provenance: expect.objectContaining({ outflowKind: "dividend", currency: "EUR", sourceSignedCell: "-127.9",
        sourceHeader: "EUR million\t2025/2026\t2024/2025", sourceRow: "Dividend paid to shareholders\t-127.9\t-" })
    }));
  });

  it.each([
    ["Interest paid", "Selskapet betalte 127,9 millioner euro i renter.", "interest"],
    ["Income taxes paid", "Selskapet betalte skatt på 127,9 millioner euro.", "tax"],
    ["Repayment of borrowings", "Selskapet tilbakebetalte 127,9 millioner euro i lån.", "debt_repayment"],
    ["Utbetalt utbytte", "Selskapet har utbetalt utbytte på 127,9 millioner euro.", "dividend"]
  ])("recognizes actual %s rows without treating accrual expenses as payments", (row, text, kind) => {
    const result = validate(text, signedSource.replace("Dividends paid to shareholders", row));
    expect(unexpected(result)).toEqual([]);
    expect(result.publicationNumberAssessments).toContainEqual(expect.objectContaining({ ruleId: "paid_outflow_magnitude",
      provenance: expect.objectContaining({ outflowKind: kind }) }));
  });

  it("permits exact unit scaling without accepting a rounded or different paid amount", () => {
    const source = signedSource.replace("EUR million", "EUR thousands").replace("-127.9", "-127 900");
    expect(unexpected(validate(paid, source))).toEqual([]);
    expect(unexpected(validate(paid.replace("127,9", "128"), source))).toContain("128");
    expect(unexpected(validate(paid.replace("127,9", "127,91"), source))).toContain("127,91");
  });

  it("never lets a supported payment occurrence clear the same unsigned number used as profit", () => {
    for (const separator of [" Resultatet var ", " Men resultatet var "]) {
      const result = validate(`${paid}${separator}127,9 millioner euro.`);
      expect(result.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "127,9", disposition: "derived", count: 1 }));
      expect(result.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "127,9", disposition: "unexpected", count: 1 }));
    }
    const sameClause = validate("Selskapet betalte 127,9 millioner euro i utbytte, og resultatet var 127,9 millioner euro.");
    expect(unexpected(sameClause)).toContain("127,9");
  });

  it("keeps title and paragraph occurrences independent", () => {
    const result = validateRewriteOutput(createRewrite({ title: "Resultatet var 127,9 millioner euro", lead: paid, body: [] }),
      createPayload({ bodyText: signedSource }), { noticeSemantics: true });
    expect(result.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "127,9", disposition: "derived" }));
    expect(unexpected(result)).toContain("127,9");
  });

  it.each([
    "Selskapet fikk et overskudd på 127,9 millioner euro.",
    "Selskapet fikk et underskudd på 127,9 millioner euro.",
    "Selskapet mottok 127,9 millioner euro i utbytte.",
    "Selskapet betalte 127,9 millioner euro i renter.",
    "Selskapet har ikke betalt 127,9 millioner euro i utbytte.",
    "Selskapet vil betale utbytte på 127,9 millioner euro.",
    "Hvis eierne samtykker, blir det betalt 127,9 millioner euro i utbytte.",
    "Selskapet kan ha betalt 127,9 millioner euro i utbytte.",
    "Selskapet betalte 127,9 millioner amerikanske dollar i utbytte."
  ])("does not reinterpret sign, direction, metric, currency or uncertain status: %s", text => {
    expect(unexpected(validate(text))).toContain("127,9");
  });

  it.each([
    signedSource.replace("Dividends paid to shareholders", "Profit for the year"),
    signedSource.replace("Dividends paid to shareholders", "Dividend income from subsidiaries"),
    signedSource.replace("Dividends paid to shareholders", "Dividends proposed to shareholders"),
    signedSource.replace("EUR million", "USD million"),
    signedSource.replace("EUR million\t2026\t2025\n", ""),
    signedSource.replace("Dividends paid", "[PDF page 5]\nDividends paid"),
    signedSource.replace("Dividends paid", "Parent company financial statements\nDividends paid"),
    signedSource.replace("Dividends paid", "USD thousands\t2026\t2025\nDividends paid"),
    signedSource.replace("Dividends paid", "2027\t2026\nDividends paid"),
    signedSource.replace("Transactions with related parties", "Forecast transactions with related parties"),
    signedSource.replace("-127.9", "-127.900"),
    signedSource.replace("-127.9", "-127,900"),
    signedSource.replace("-127.9", "\uE000127.9"),
    signedSource.replace("EUR million", "$ million")
  ])("requires a usable paid row and its own actual-period currency/unit header", source => {
    expect(unexpected(validate(paid, source))).toContain("127,9");
  });

  it("never uses a corrupted numeric cell as a signed-payment witness", () => {
    for (const cell of ["-\uE000127.9", "\uE000127.9", "-127.9\uE000"]) {
      const result = validate(paid, signedSource.replace("-127.9", cell));
      expect(result.publicationNumberAssessments.some(item => item.ruleId === "paid_outflow_magnitude")).toBe(false);
      expect(result.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "127,9", disposition: "unexpected",
        provenance: { corruptedSourceMatchBlocked: true } }));
    }
  });

  it("does not turn an interest expense into cash interest paid", () => {
    const source = signedSource.replace("Dividends paid to shareholders", "Interest expense");
    expect(unexpected(validate("Selskapet betalte 127,9 millioner euro i renter.", source))).toContain("127,9");
  });

  it("preserves explicit negative profit and the unchanged legacy sign behavior", () => {
    const source = signedSource.replace("Dividends paid to shareholders", "Profit for the year");
    expect(unexpected(validate("Resultatet var minus 127,9 millioner euro.", source))).toEqual([]);
    expect(unexpected(validate("Resultatet var 127,9 millioner euro.", source))).toContain("127,9");
    expect(unexpected(validate(paid, signedSource, false))).toContain("127,9");
  });

  it("binds the paid amount to its own table period", () => {
    expect(unexpected(validate(paid.replace("127,9", "20,1")))).toContain("20,1");
    expect(unexpected(validate(paid.replace("127,9", "20,1").replace(".", " i 2026.")))).toContain("20,1");
    expect(unexpected(validate(paid.replace("127,9", "20,1").replace(".", " i 2025.")))).toEqual([]);
    expect(unexpected(validate(paid.replace(".", " i 2025.")))).toContain("127,9");
  });

  it.each([
    "Eierne betalte 127,9 millioner euro i utbytte til selskapet.",
    "Selskapet betalte 127,9 millioner euro i utbytte til morselskapet.",
    "Et annet selskap betalte 127,9 millioner euro i utbytte.",
    "Konsernet betalte 127,9 millioner euro i utbytte."
  ])("does not reverse payer/payee or transfer parent amounts to another scope: %s", text => {
    expect(unexpected(validate(text))).toContain("127,9");
  });

  it("does not transfer a consolidated payment to the parent company", () => {
    const group = signedSource.replace("Parent company financial statements", "Consolidated financial statements");
    expect(unexpected(validate(paid.replace("Selskapet", "Morselskapet"), group))).toContain("127,9");
    expect(unexpected(validate(paid.replace("Selskapet", "Konsernet"), group))).toEqual([]);
  });

  it("does not infer an owning scope from a later section heading", () => {
    const unknown = signedSource.replace("Parent company financial statements\n", "");
    expect(unexpected(validate(paid, unknown))).toContain("127,9");
    expect(unexpected(validate(paid, unknown + "\nParent company financial statements"))).toContain("127,9");
  });

  it("preserves the exact recipient class instead of transferring a payout to another company's owners", () => {
    expect(unexpected(validate(paid.replace(".", " til aksjonærene i Fjellfjord.")))).toContain("127,9");
    const minority = signedSource.replace("to shareholders", "to non-controlling interests");
    expect(unexpected(validate(paid.replace(".", " til aksjonærene i selskapet."), minority))).toContain("127,9");
    expect(unexpected(validate(paid, minority))).toContain("127,9");
    expect(unexpected(validate(paid.replace(".", " til minoritetsaksjonærene."), minority))).toEqual([]);
    expect(unexpected(validate(paid.replace(".", " til minoritetsaksjonærene.")))).toContain("127,9");
  });

  it.each(["Parent financial statements", "Financial statements of subsidiary Fjellfjord", "  Parent financial statements", "Parent  financial statements"])(
    "does not carry group scope through the new entity section %s", heading => {
      const source = signedSource.replace("Parent company financial statements", `Consolidated financial statements\n${heading}`);
      expect(unexpected(validate(paid.replace("Selskapet", "Konsernet"), source))).toContain("127,9");
    }
  );

  it("uses the notice's Oslo calendar year at the UTC New Year boundary", () => {
    const result = validateRewriteOutput(createRewrite({ title: "Utbytte til eierne", lead: paid, body: [] }),
      createPayload({ bodyText: signedSource, publishedAt: "2025-12-31T23:30:00Z" }), { noticeSemantics: true });
    expect(unexpected(result)).toEqual([]);
    expect(result.publicationNumberAssessments).toContainEqual(expect.objectContaining({ ruleId: "paid_outflow_magnitude" }));
  });
});

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

  it("keeps hidden unexpected numbers in telemetry without blocking publication", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      key_facts: ["Intern modellnotis 999"],
      negative_or_surprising: ["Beregnet avvik 303"],
      source_spans: ["Intern tabellreferanse 404"]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.numberAssessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display: "999",
          disposition: "unexpected"
        }),
        expect.objectContaining({
          display: "303",
          disposition: "unexpected"
        })
      ])
    );
    expect(
      result.publicationNumberAssessments.some(
        (assessment) =>
          assessment.display === "999" || assessment.display === "303"
      )
    ).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "UNEXPECTED_NUMBERS")
    ).toBe(false);
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

  it("uses selected supplemental material text when validating numbers", () => {
    const payload = createPayload({
      supplementalMaterials: [
        {
          id: "mat1",
          sourceId: "material_mat1",
          kind: "text",
          title: "Analyst note",
          text: "Analysts expected revenue of 303 and operating profit of 404.",
          textChars: 62
        }
      ]
    });
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall med nye detaljer.",
      body: [
        "Analytikerne ventet inntekter pa 303.",
        "Driftsresultatet i perioden var 404."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.errors.some((error) => error.startsWith("Unexpected numbers:"))).toBe(
      false
    );
  });

  it("accepts figures from an attached earlier notice in the body but not in the title", () => {
    const relatedNotices = [
      {
        messageId: 676863,
        relation: "reference" as const,
        title: "HENT inngår innledende avtale med Nscale",
        issuerName: "Sentia ASA",
        issuerSign: "SNTIA",
        publishedAt: "2026-06-23T14:25:02.930Z",
        text: "HENT har inngått en innledende avtale om to datasenter med samlet kapasitet på 75 MW.",
        textChars: 88,
        resolvedBy: "db" as const,
        score: 0.6
      }
    ];
    const payload = createPayload({
      bodyText: "HENT har signert kontrakt med Nscale om to bygg i Narvik. Arbeidet skal være ferdig i 2027.",
      relatedNotices
    });

    const bodyUse = validateRewriteOutput(
      createRewrite({
        title: "Hent signerte Nscale-kontrakt",
        lead: "Hent har signert kontrakt med Nscale om to bygg i Narvik, opplyser selskapet.",
        body: ["Selskapet meldte i juni om en innledende avtale om 75 MW.", "Arbeidet skal være ferdig i 2027."],
        source_spans: ["primary: signert kontrakt", "prior_676863: samlet kapasitet på 75 MW"]
      }),
      payload
    );
    expect(bodyUse.issues.some((issue) => issue.code === "UNEXPECTED_NUMBERS")).toBe(false);
    expect(bodyUse.issues.some((issue) => issue.code === "SECONDARY_ONLY_TITLE_NUMBER")).toBe(false);

    const titleUse = validateRewriteOutput(
      createRewrite({
        title: "Hent signerte kontrakt om 75 MW",
        lead: "Hent har signert kontrakt med Nscale om to bygg i Narvik, opplyser selskapet.",
        body: ["Arbeidet skal være ferdig i 2027."],
        source_spans: ["primary: signert kontrakt"]
      }),
      payload
    );
    expect(titleUse.issues).toContainEqual({
      code: "SECONDARY_ONLY_TITLE_NUMBER",
      severity: "warning",
      message: "Title uses numbers found only in an earlier notice: 75."
    });

    // Without related notices the same figure is simply unexpected, and the
    // title guard stays silent.
    const noRelated = validateRewriteOutput(
      createRewrite({
        title: "Hent signerte kontrakt om 75 MW",
        lead: "Hent har signert kontrakt med Nscale om to bygg i Narvik, opplyser selskapet.",
        body: ["Arbeidet skal være ferdig i 2027."],
        source_spans: ["primary: signert kontrakt"]
      }),
      createPayload({ bodyText: payload.bodyText })
    );
    expect(noRelated.issues.some((issue) => issue.code === "SECONDARY_ONLY_TITLE_NUMBER")).toBe(false);
    expect(noRelated.issues.some((issue) => issue.code === "UNEXPECTED_NUMBERS")).toBe(true);
  });

  it("collects quote telemetry for source-close person attribution", () => {
    const payload = createPayload({
      bodyText:
        'CEO Kari Hansen says "Demand was weaker than expected" and says the company will cut costs.'
    });
    const rewrite = createRewrite({
      lead:
        "Konsernsjef Kari Hansen sier markedet var «svakere enn ventet».",
      body: ["Selskapet vil kutte kostnader."],
      key_facts: ["Markedet var svakere enn ventet"],
      source_spans: ['CEO Kari Hansen: "Demand was weaker than expected"']
    });

    const telemetry = collectQuoteTelemetry(rewrite, payload);
    const result = validateRewriteOutput(rewrite, payload);

    expect(telemetry.sourceContainsNamedQuoteLikePattern).toBe(true);
    expect(telemetry.draftContainsInlineGuillemets).toBe(true);
    expect(telemetry.draftContainsNamedPersonAttribution).toBe(true);
    expect(telemetry.draftSourceSpansMentionQuoteSpeaker).toBe(true);
    expect(result.quoteTelemetry).toEqual(telemetry);
    expect(
      result.issues.some((issue) => issue.code === "MISSING_QUOTE_SOURCE_SPAN")
    ).toBe(false);
  });

  it("warns when quote-like visible text lacks quote evidence in source_spans", () => {
    const payload = createPayload({
      bodyText:
        'CEO Kari Hansen says "Demand was weaker than expected" and expects lower activity.'
    });
    const rewrite = createRewrite({
      lead:
        "– Markedet var svakere enn ventet, sier konsernsjef Kari Hansen.",
      body: ["Selskapet venter lavere aktivitet."],
      key_facts: ["Markedet var svakere enn ventet"],
      source_spans: ["lower activity"]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.quoteTelemetry.draftContainsStandaloneDashQuote).toBe(true);
    expect(result.issues).toContainEqual({
      code: "MISSING_QUOTE_SOURCE_SPAN",
      severity: "warning",
      message:
        "Visible article text uses a quote, source-close wording, or named-person attribution, but source_spans lacks speaker or quote wording evidence."
    });
    expect(
      result.issues.some((issue) => issue.code === "MISSING_QUOTE_OPPORTUNITY")
    ).toBe(false);
  });

  it("warns when the source has a key-person statement but the draft has no quote", () => {
    const payload = createPayload({
      bodyText:
        'CEO Kari Hansen says "Demand was weaker than expected" and expects lower activity.'
    });
    const rewrite = createRewrite({
      lead: "Selskapet venter lavere aktivitet fremover.",
      body: ["Etterspørselen var svakere i kvartalet."],
      key_facts: ["Venter lavere aktivitet"],
      source_spans: ["expects lower activity"]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.quoteTelemetry.sourceContainsNamedQuoteLikePattern).toBe(true);
    expect(result.quoteTelemetry.draftContainsStandaloneDashQuote).toBe(false);
    expect(result.quoteTelemetry.draftContainsInlineGuillemets).toBe(false);
    expect(result.quoteTelemetry.draftContainsNamedPersonAttribution).toBe(false);
    expect(result.issues).toContainEqual({
      code: "MISSING_QUOTE_OPPORTUNITY",
      severity: "warning",
      message:
        "Source contains a named key-person statement, but visible article text has no quote, source-close wording, or named-person attribution."
    });
  });

  it("does not warn about a missed quote opportunity when the source has no key-person statement", () => {
    const payload = createPayload();
    const rewrite = createRewrite();

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.quoteTelemetry.sourceContainsNamedQuoteLikePattern).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "MISSING_QUOTE_OPPORTUNITY")
    ).toBe(false);
  });

  it("allows exact report numbers with source-spaced and rewrite-dotted thousands", () => {
    const payload = createPayload({
      title: "BELUX: BEELUX S.A R.L.: Financial Statements for 2025",
      bodyText: "Financial Statements for 2025",
      hasAttachments: true,
      pdfSupplementText: [
        "PROFIT (LOSS) BEFORE TAX 2025/12 1 402 704 2024/12 7 064 970",
        "Operating revenue 48 858 000 59 268 000",
        "PROFIT (LOSS) FROM OPERATIONS 982 426 7 492 653",
        "PROFIT AFTER TAX 5 173 704 5 635 970"
      ].join("\n")
    });
    const rewrite = createRewrite({
      title: "BeeLux-resultat for skatt faller",
      lead:
        "BeeLux fikk et resultat for skatt pa 1.402.704 euro i 2025, ned fra 7.064.970 euro aret for.",
      body: [
        "Driftsinntektene falt til 48.858.000 euro fra 59.268.000 euro.",
        "Driftsresultatet falt til 982.426 euro, mot 7.492.653 euro i 2024.",
        "Resultatet etter skatt endte pa 5.173.704 euro, ned fra 5.635.970 euro."
      ],
      company_sentence: "BeeLux er et Luxembourg-registrert selskap.",
      key_facts: [
        "Resultat for skatt 1.402.704 euro",
        "Driftsinntekter 48.858.000 euro",
        "Resultat etter skatt 5.173.704 euro"
      ],
      negative_or_surprising: ["Resultat for skatt falt fra aret for"],
      source_limitations: ["Selve borsmeldingen viser til arsregnskapet."],
      source_spans: [
        "PROFIT (LOSS) BEFORE TAX 1 402 704 7 064 970",
        "Operating revenue 48 858 000 59 268 000",
        "PROFIT AFTER TAX 5 173 704 5 635 970"
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(
      result.issues.some((issue) => issue.code === "UNEXPECTED_NUMBERS")
    ).toBe(false);
  });

  it("allows rounded million figures from explicitly thousand-scaled report tables", () => {
    const payload = createPayload({
      title: "CMMB: Compagnie Maritime Monegasque OSV B.V. Q1 2026 Interim Report",
      bodyText: "Q1 2026 Interim Report",
      hasAttachments: true,
      pdfSupplementText: [
        "Consolidated statement of income",
        "Amounts are in USD thousands",
        "Revenue 33,613 12,118",
        "Operating Profit 3,100 3,244",
        "Result before corporate income tax 6,232 4,027"
      ].join("\n")
    });
    const rewrite = createRewrite({
      title: "CMM oker inntektene",
      lead:
        "CMM okte inntektene til 33,6 millioner dollar i kvartalet, fra 12,1 millioner dollar aret for.",
      body: [
        "Driftsresultatet var 3,1 millioner dollar, mot 3,2 millioner i samme kvartal i fjor.",
        "Resultatet for skatt steg til 6,2 millioner dollar, fra 4,0 millioner aret for."
      ],
      company_sentence: "CMM har flere fartoykontrakter med Petrobras.",
      key_facts: [
        "Inntekter 33,6 millioner dollar",
        "Driftsresultat 3,1 millioner dollar",
        "Resultat for skatt 6,2 millioner dollar"
      ],
      negative_or_surprising: [],
      source_limitations: ["Kun et utdrag av rapporten er analysert."],
      source_spans: [
        "Revenue 33,613 12,118",
        "Operating Profit 3,100 3,244",
        "Result before corporate income tax 6,232 4,027"
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(
      result.issues.some((issue) => issue.code === "UNEXPECTED_NUMBERS")
    ).toBe(false);
  });

  it("allows simple source-derived insider trade totals", () => {
    const payload = createPayload({
      title: "Mandatory notification of trade",
      bodyText:
        "Lorenz AS has acquired 10.000 shares at a price of NOK 3,43 per share."
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

  it("allows approximate totals derived from average insider trade prices", () => {
    const payload = createPayload({
      title: "Mandatory notification of trade",
      bodyText:
        "The investor acquired 100.000 shares at an average price of NOK 12,38 per share."
    });
    const rewrite = createRewrite({
      title: "Investor kjoper aksjer",
      lead:
        "Investoren har kjopt aksjer for rundt 1,2 millioner kroner, ifolge en borsmelding.",
      body: [],
      key_facts: ["Kjopt for rundt 1,2 millioner kroner"],
      source_spans: ["100.000 shares", "average price of NOK 12,38 per share"]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.issues.some((issue) => issue.code === "UNEXPECTED_NUMBERS")).toBe(
      false
    );
  });

  it("flags exact totals derived from average insider trade prices", () => {
    const payload = createPayload({
      title: "Mandatory notification of trade",
      bodyText:
        "Lorenz AS has acquired 10.000 shares at an average price of NOK 3,43 per share."
    });
    const rewrite = createRewrite({
      title: "Lorenz kjoper aksjer",
      lead:
        "Lorenz har kjopt aksjer for 34.300 kroner, ifolge en borsmelding.",
      body: [],
      key_facts: ["Kjopt for 34.300 kroner"],
      source_spans: ["10.000 shares", "average price of NOK 3,43 per share"]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.issues).toContainEqual({
      code: "UNEXPECTED_NUMBERS",
      severity: "warning",
      message: "Unexpected numbers: 34.300"
    });
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

  it("does not treat lowercase Norwegian nok as NOK currency", () => {
    const payload = createPayload({
      title: "Status of bookbuilding",
      bodyText:
        "Bohus ASA has received sufficient orders to cover the minimum deal size."
    });
    const rewrite = createRewrite({
      lead: "Bohus har fatt nok ordre til aa dekke minimumsbelopet.",
      body: ["Selskapet opplyser at bokbyggingen fortsetter."],
      key_facts: ["Nok ordre til minimumsbelopet"],
      source_spans: ["received sufficient orders", "minimum deal size"]
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

  it("still flags uppercase NOK when source lacks NOK currency", () => {
    const payload = createPayload({
      bodyText:
        "Selskapet melder at inntektene var 10 millioner dollar i kvartalet."
    });
    const rewrite = createRewrite({
      lead: "Selskapet melder om inntekter paa NOK 10 millioner.",
      body: ["Meldingen oppgir ikke andre tall."]
    });

    const result = validateRewriteOutput(rewrite, payload);

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

  it.each([
    ["TNOK", "norske kroner", "NOK/kroner"],
    ["kUSD", "dollar", "USD/dollar"],
    ["TEUR", "euro", "EUR/euro"],
    ["MGBP", "pund", "GBP/pund"],
    ["TSEK", "svenske kroner", "SEK/svenske kroner"],
    ["TDKK", "danske kroner", "DKK/danske kroner"]
  ])(
    "treats scaled ISO unit %s as its underlying currency",
    (sourceUnit, visibleCurrency, issueLabel) => {
      const payload = createPayload({
        bodyText: `Financial report. Amounts in ${sourceUnit}. Revenue was 10.`
      });
      const rewrite = createRewrite({
        lead: `Selskapet rapporterte inntekter på 10 ${visibleCurrency}.`,
        body: ["Meldingen oppgir ikke andre tall."]
      });

      const result = validateRewriteOutput(rewrite, payload);

      expect(
        result.issues.some(
          (issue) =>
            issue.code === "UNEXPECTED_CURRENCY" && issue.message.includes(issueLabel)
        )
      ).toBe(false);
    }
  );

  it("keeps reader-friendly euro amounts when a report uses TEUR", () => {
    const payload = createPayload({
      title: "Øyfjellet Wind Investment AS interim report for H1 2026",
      bodyText: [
        "Amounts in TEUR.",
        "Revenue 21,042 14,646.",
        "Operating profit/(loss) 981 (15,106).",
        "Profit/(loss) before tax (7,729) (20,552)."
      ].join(" ")
    });
    const rewrite = createRewrite({
      title: "Øyfjellet Wind Investment snudde til driftsoverskudd",
      lead:
        "Øyfjellet Wind Investment snudde til et driftsoverskudd på 981.000 euro i første halvår, fra et tap på 15,1 millioner euro året før.",
      body: [
        "Inntektene steg til 21 millioner euro, fra 14,6 millioner året før.",
        "Underskuddet før skatt krympet til 7,7 millioner euro, fra 20,6 millioner."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(
      result.issues.some((issue) => issue.code === "UNEXPECTED_CURRENCY")
    ).toBe(false);
    expect(
      result.publicationNumberAssessments
        .filter((assessment) => assessment.disposition === "unexpected")
        .map((assessment) => assessment.display)
    ).toEqual(["981.000"]);
    // The report reference checker separately verifies this exact TEUR-to-euro
    // expansion, so it remains eligible for the grounded numeric override.
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

  it("blocks generic annual-report possession phrasing without concrete facts", () => {
    const payload = createPayload({
      title: "VDI: Vantage Drilling International Ltd. 2025 Annual Report",
      bodyText: "The 2025 annual report has been published and is attached.",
      hasAttachments: true
    });
    const rewrite = createRewrite({
      title: "Vantage Drilling har arsrapport",
      lead: "Vantage Drilling har arsrapport for 2025, viser rapporten.",
      body: [],
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

  it("warns when report/PDF rewrites omit source limitations", () => {
    const payload = createPayload({
      title: "MM Proton I, LLC 2025 Annual Financial Report",
      bodyText:
        "The annual financial report is attached. Assets were USD 206.81 million and liabilities were USD 241.52 million.",
      hasAttachments: true
    });
    const rewrite = createRewrite({
      title: "MM Proton har negativ egenkapital",
      lead:
        "MM Proton hadde 206,81 millioner dollar i eiendeler og 241,52 millioner dollar i gjeld ved utgangen av 2025.",
      body: [],
      key_facts: ["Eiendeler 206,81 mill. dollar", "Gjeld 241,52 mill. dollar"],
      source_spans: ["Assets were USD 206.81 million", "liabilities were USD 241.52 million"],
      source_limitations: []
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.issues).toContainEqual({
      code: "MISSING_REPORT_SOURCE_LIMITATION",
      severity: "warning",
      message:
        "Report/PDF-based rewrite must include a source_limitations note that explains the excerpted or limited source basis."
    });
  });

  it("can add the hidden limitation required for PDF-supplement rewrites", () => {
    const payload = createPayload({
      title: "Exercise of subscription rights",
      categories: ["MANAGERS' TRANSACTION"],
      hasAttachments: true,
      pdfSupplementText:
        "Price(s) Volume(s) NOK 1 27,949. Aggregated volume 27,949."
    });
    const rewrite = createRewrite({
      title: "Next-sjef faar aksjer",
      lead:
        "Next Biometrics-sjef Ulf Ritsvall faar nye aksjer og warrants i selskapets emisjon.",
      body: ["Aksjene prises til en krone stykket."],
      source_limitations: []
    });

    const normalized = ensureReportSourceLimitation(rewrite, payload);
    const result = validateRewriteOutput(normalized, payload);

    expect(normalized.source_limitations).toHaveLength(1);
    expect(normalized.source_limitations[0]).toMatch(/begrenset kildegrunnlag/);
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      "MISSING_REPORT_SOURCE_LIMITATION"
    );
  });

  it("warns when weak report extraction has only vague limitations", () => {
    const payload = createPayload({
      title: "Famkaa Invest ApS - Interim Report 2026 Q1",
      bodyText:
        "The interim report is attached. Result before tax was DKK -19.5 million.",
      hasAttachments: true
    });
    const rewrite = createRewrite({
      title: "Famkaa Invest i minus",
      lead:
        "Famkaa Invest fikk et resultat for skatt paa minus 19,5 millioner danske kroner i forste kvartal.",
      body: [],
      key_facts: ["Resultat for skatt minus 19,5 mill. danske kroner"],
      source_spans: ["Result before tax was DKK -19.5 million"],
      source_limitations: ["Rapporten omtales i kilden."]
    });

    const result = validateRewriteOutput(rewrite, payload, {
      reportExtraction: {
        metricCandidates: [],
        diagnostics: {
          fallbackUsed: true,
          incomeStatementFound: false,
          openAIPdfFallback: true
        }
      }
    });

    expect(result.issues).toContainEqual({
      code: "MISSING_REPORT_SOURCE_LIMITATION",
      severity: "warning",
      message:
        "Report/PDF-based rewrite must include a source_limitations note that explains the excerpted or limited source basis."
    });
    expect(result.issues).toContainEqual({
      code: "WEAK_REPORT_EXTRACTION_LIMITATION",
      severity: "warning",
      message:
        "Weak report/PDF extraction without structured metrics needs an explicit limitation about the limited or uncertain report basis."
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

describe("validateRewriteOutput number assessments", () => {
  it("exposes per-number assessments alongside the unexpected-number issue", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall med nye detaljer.",
      body: [
        "Omsetningen i kvartalet var 101 i denne omtalen.",
        "Meldingen oppgir ingen ny guiding."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);

    expect(result.numberAssessments).toContainEqual({
      display: "101",
      disposition: "unexpected",
      ruleId: null,
      count: 1
    });
    expect(result.numberAssessments).toContainEqual(
      expect.objectContaining({
        display: "100",
        disposition: "matched",
        ruleId: "exact_source_match"
      })
    );
  });

  it("keeps the issue message consistent with unexpected assessments", () => {
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
    const unexpected = result.publicationNumberAssessments
      .filter((assessment) => assessment.disposition === "unexpected")
      .map((assessment) => assessment.display);

    expect(result.errors).toContain(
      `Unexpected numbers: ${unexpected.join(", ")}`
    );
  });

  it("returns only matched assessments for a fully supported rewrite", () => {
    const payload = createPayload();
    const rewrite = createRewrite();

    const result = validateRewriteOutput(rewrite, payload);

    expect(
      result.issues.some((issue) => issue.code === "UNEXPECTED_NUMBERS")
    ).toBe(false);
    expect(result.numberAssessments.length).toBeGreaterThan(0);
    expect(
      result.numberAssessments.every(
        (assessment) => assessment.disposition === "matched"
      )
    ).toBe(true);
  });

  it("passes enabledDerivationRules through without changing behavior for the empty set", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall med nye detaljer.",
      body: ["Omsetningen i kvartalet var 101 i denne omtalen."]
    });

    const withKillSwitch = validateRewriteOutput(rewrite, payload, {
      enabledDerivationRules: []
    });

    expect(withKillSwitch).toEqual(validateRewriteOutput(rewrite, payload));
  });
});

// Verbatim leaked body sentence from message 675713 (regular_v6_draft
// challenger output) — the seed case for the marker-leak detector.
const LEAKED_675713_BODY =
  'Selskapet skal frakte restmassene med jernbane til Østlandet, der de skal brukes i landbruket og i produksjon av jord.】【：】【"】【confidence":"high"}大香蕉伊人assistant출장샵】【。】【"】【numerusformassistant to=system? 天天彩票提现 天天中彩票qq. We need identify issue final malformed? It has weird delimiter and quote at confidence due generation. Need respond? The last assistant answer is to user but malformed JSON. We need likely correct it, but no new prompt. Need answer perhaps corrected valid JSON. Ensure title max 8: Cambi-enhet(1) får2 Bergen-kontrakt3 over4 2005 millioner6. Good. Source span quote altered ellips';

describe("detectMarkerLeaks", () => {
  it("detects every leak category in the verbatim 675713 body", () => {
    const matches = detectMarkerLeaks(LEAKED_675713_BODY);
    const categories = new Set(matches.map((match) => match.category));
    expect(categories).toEqual(
      new Set([
        "role_marker",
        "reasoning_spill",
        "instruction_echo",
        "serialization_fragment",
        "foreign_script_spam"
      ])
    );
    expect(matches.map((match) => match.id)).toContain("assistant_to_role");
  });

  it("ignores benign Norwegian assistant words", () => {
    for (const text of [
      "Assistenten til styret la frem tallene.",
      "Hun er ansatt som assistent i selskapet.",
      "Førsteassistent Nilsen overtar rollen."
    ]) {
      expect(detectMarkerLeaks(text)).toEqual([]);
    }
  });

  it("ignores quoted English source text with a plain assistant mention", () => {
    expect(
      detectMarkerLeaks(
        "«He worked as an executive assistant to the CEO before the merger», heter det i meldingen."
      )
    ).toEqual([]);
  });

  it("ignores quoted English management commentary and prose confidence wording", () => {
    expect(
      detectMarkerLeaks(
        "«We need to identify further cost reductions», sier konsernsjefen."
      )
    ).toEqual([]);
    expect(
      detectMarkerLeaks("«We must respond to the changing market», heter det.")
    ).toEqual([]);
    expect(
      detectMarkerLeaks("Styret beskriver sin confidence: high street-salget stiger.")
    ).toEqual([]);
  });

  it("calibrates foreign-script detection to runs, not short quoted names", () => {
    expect(
      detectMarkerLeaks("Selskapet samarbeider med 华为 om utbyggingen.")
    ).toEqual([]);
    expect(
      detectMarkerLeaks("Kontrakten med 삼성 og 네이버 er signert.")
    ).toEqual([]);
    expect(
      detectMarkerLeaks("Rapporten siterer tittelen 【Årsrapport】 fra vedlegget.")
    ).toEqual([]);
    expect(
      detectMarkerLeaks("Avtalen omtales som 天天彩票提现 i vedlegget.")
    ).toEqual([
      { category: "foreign_script_spam", id: "cjk_run" }
    ]);
    expect(detectMarkerLeaks("】【 debris 】【")).toEqual([
      { category: "foreign_script_spam", id: "fullwidth_bracket" }
    ]);
  });

  it("detects obfuscated role-marker forms", () => {
    expect(detectMarkerLeaks("<|im_start|>assistant")).toEqual([
      { category: "role_marker", id: "chatml_token" }
    ]);
    expect(detectMarkerLeaks("tekstassistantfinal svar")).toEqual([
      { category: "role_marker", id: "assistant_channel" }
    ]);
    expect(detectMarkerLeaks("assistant   to=user")).toEqual([
      { category: "role_marker", id: "assistant_to_role" }
    ]);
  });
});

describe("marker leak shadow neutrality", () => {
  it("surfaces matches only via the markerLeaks field while in shadow", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      body: [
        "Omsetningen i kvartalet var 100.",
        LEAKED_675713_BODY,
        "Meldingen oppgir ingen ny guiding."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.markerLeaks.length).toBeGreaterThan(0);
    // Shadow neutrality: no issue of any severity — even a warning would
    // flip valid/errorCode for otherwise-clean runs.
    expect(
      result.issues.some((item) => item.code.startsWith("MARKER_LEAK"))
    ).toBe(false);
  });

  it("does not change valid or issue codes for a marker-tripping but otherwise clean run", () => {
    const payload = createPayload();
    const clean = createRewrite();
    const tripping = createRewrite({
      body: [
        ...clean.body.slice(0, 2),
        "Meldingen oppgir ingen ny guiding assistant to=system."
      ]
    });

    const cleanResult = validateRewriteOutput(clean, payload);
    const trippingResult = validateRewriteOutput(tripping, payload);
    expect(trippingResult.valid).toBe(cleanResult.valid);
    expect(trippingResult.issues.map((item) => item.code)).toEqual(
      cleanResult.issues.map((item) => item.code)
    );
    expect(trippingResult.markerLeaks).toEqual([
      { category: "role_marker", id: "assistant_to_role" }
    ]);
  });

  it("blocks with a redacted message under the promoted enforcement", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      body: [
        "Omsetningen i kvartalet var 100.",
        LEAKED_675713_BODY,
        "Meldingen oppgir ingen ny guiding."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload, {
      markerLeakEnforcement: { code: "MARKER_LEAK", severity: "blocking" }
    });
    const issue = result.issues.find((item) => item.code === "MARKER_LEAK");
    expect(issue?.severity).toBe("blocking");
    expect(issue?.message).toContain("role_marker(assistant_to_role)");
    // Redaction: the leaked text itself never reaches the message.
    expect(issue?.message).not.toContain('confidence":"high');
    expect(issue?.message).not.toContain("Ensure title max 8");
    expect(result.blockingErrors.length).toBeGreaterThan(0);
  });

  it("scans only visible text, not source_spans", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      source_spans: ['primary: confidence":"high"} assistant to=system']
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.markerLeaks).toEqual([]);
    expect(
      result.issues.some((item) => item.code === markerLeakEnforcement.code)
    ).toBe(false);
  });
});
