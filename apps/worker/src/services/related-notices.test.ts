import { describe, expect, it } from "vitest";
import {
  dedupeBilingualCandidates,
  detectNoticeLanguage,
  osloCalendarDate,
  resolveRelatedNotices,
  scoreRelatedNoticeCandidate,
  trimRelatedNoticeText,
  type RelatedNoticeCandidate,
  type RelatedNoticeNewswebClient,
  type RelatedNoticeSource,
  type RelatedNoticeStore
} from "./related-notices.js";

const HENT_JUNE_BODY = [
  "Det vises til børsmelding 23 desember 2025 vedrørende bygging av datasenter i Narvik.",
  "HENT har nå inngått en Limited Notice to Proceed (LNTP) med Nscale i forbindelse med bygging av ytterligere to datasenter med samlet kapasitet på 75 MW i Kvanndal utenfor Narvik.",
  "-Det er en anerkjennelse å bli videre valgt til å realisere et av de mer spennende industriprosjektene i Nord-Norge, sier Jan Jahren, CEO i Sentia.",
  "HENT skal bygge bygningskroppen og infrastrukturen, Civil/Structural/Architectural (CSA).",
  "Partene har som mål å inngå en full Engineering, Procurement and Construction (EPC) kontrakt for prosjektet juni 2026.",
  "For mer informasjon, ta kontakt med: Sverre Hærem Konserndirektør finans & CFO Sentia ASA +47 952 45 167 | sh@sentiagruppen.com"
].join(" ");

const HENT_SEPTEMBER_BODY = [
  "Det vises til børsmelding 23. juni 2026 vedrørende bygging av datasenter i Kvandal - Narvik.",
  "HENT har nå signert kontrakt med Nscale for å utvide datasenteret med to bygg, med en samlet kapasitet på 75 MW.",
  "Med denne signeringen har HENT totalt fått i oppdrag å bygge tre bygg med en samlet kapasitet på 100 MW for datasenteret i Narvik-regionen, kjent som Kvandal North Campus."
].join(" ");

function candidate(
  overrides: Partial<RelatedNoticeCandidate> = {}
): RelatedNoticeCandidate {
  return {
    messageId: 676863,
    title:
      "HENT, et selskap i Sentia konsernet, inngår innledende avtale med Nscale om bygging av ytterligere to datasenter i Narvik-regionen",
    issuerName: "Sentia ASA",
    issuerSign: "SNTIA",
    publishedAt: new Date("2026-06-23T14:25:02.930Z"),
    bodyText: HENT_JUNE_BODY,
    ...overrides
  };
}

function source(overrides: Partial<RelatedNoticeSource> = {}): RelatedNoticeSource {
  return {
    messageId: 681428,
    issuerName: "Sentia ASA",
    issuerSign: "SNTIA",
    publishedAt: new Date("2026-09-02T05:00:04.025Z"),
    bodyText: HENT_SEPTEMBER_BODY,
    rawMessageJson: { messageId: 681428, correctionForMessageId: 0 },
    ...overrides
  };
}

function memoryStore(rows: RelatedNoticeCandidate[]): RelatedNoticeStore & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async findByIssuerAndDate({ issuerSign, excludeMessageId, from, to, before }) {
      calls.push("findByIssuerAndDate");
      return rows.filter(
        (row) =>
          row.issuerSign === issuerSign &&
          row.messageId !== excludeMessageId &&
          row.publishedAt >= from &&
          row.publishedAt <= to &&
          row.publishedAt < before
      );
    },
    async findByMessageId(messageId) {
      calls.push("findByMessageId");
      return rows.find((row) => row.messageId === messageId) ?? null;
    }
  };
}

function failingStore(): RelatedNoticeStore {
  return {
    async findByIssuerAndDate() {
      throw new Error("db down");
    },
    async findByMessageId() {
      throw new Error("db down");
    }
  };
}

const enabledRelations = ["reference", "correction"] as const;

describe("trimRelatedNoticeText", () => {
  it("drops the contact tail when substantive text precedes it and caps length", () => {
    const trimmed = trimRelatedNoticeText(HENT_JUNE_BODY);
    expect(trimmed).toContain("Limited Notice to Proceed");
    expect(trimmed).not.toContain("For mer informasjon");
    expect(trimmed).not.toContain("sh@sentiagruppen.com");

    const long = `${"Selskapet melder om nye kontrakter. ".repeat(400)}`;
    const capped = trimRelatedNoticeText(long, 500);
    expect(capped.length).toBeLessThan(560);
    expect(capped).toContain("[... teksten er avkortet ...]");
  });

  it("never truncates a short notice to nothing", () => {
    const short = "Kort melding. For mer informasjon, kontakt CFO.";
    expect(trimRelatedNoticeText(short)).toBe(short);
  });
});

describe("scoreRelatedNoticeCandidate and language helpers", () => {
  it("scores by topic token overlap with the candidate title and lead", () => {
    const score = scoreRelatedNoticeCandidate(
      "bygging av datasenter i Kvandal - Narvik",
      candidate()
    );
    expect(score).toBeGreaterThanOrEqual(0.5);
    expect(
      scoreRelatedNoticeCandidate("kjøp av Agil Helse AS", candidate())
    ).toBeLessThan(0.35);
    expect(scoreRelatedNoticeCandidate(null, candidate())).toBe(0);
  });

  it("detects the notice language from function words", () => {
    expect(detectNoticeLanguage(HENT_JUNE_BODY)).toBe("no");
    expect(
      detectNoticeLanguage(
        "Reference is made to the announcement published by the Company on 26 May 2026 regarding the private placement of new shares."
      )
    ).toBe("en");
  });

  it("keeps one notice per bilingual pair, preferring the source language", () => {
    const norwegian = candidate({ messageId: 1, bodyText: HENT_JUNE_BODY });
    const english = candidate({
      messageId: 2,
      publishedAt: new Date("2026-06-23T14:25:08.000Z"),
      bodyText:
        "Reference is made to the announcement of 23 December 2025 regarding the construction of a data centre in Narvik. HENT has now entered into a Limited Notice to Proceed with Nscale for the construction of two further data centres."
    });
    expect(dedupeBilingualCandidates([english, norwegian], "no").map((c) => c.messageId)).toEqual([1]);
    expect(dedupeBilingualCandidates([norwegian, english], "en").map((c) => c.messageId)).toEqual([2]);
    expect(dedupeBilingualCandidates([norwegian, english], "unknown").map((c) => c.messageId)).toEqual([1]);
  });
});

describe("resolveRelatedNotices", () => {
  it("resolves an explicit dated reference from the local database", async () => {
    const store = memoryStore([candidate()]);
    const result = await resolveRelatedNotices(source(), {
      enabledRelations,
      store
    });

    expect(result.related).toHaveLength(1);
    const related = result.related[0];
    expect(related.messageId).toBe(676863);
    expect(related.relation).toBe("reference");
    expect(related.resolvedBy).toBe("db");
    expect(related.publishedAt).toBe("2026-06-23T14:25:02.930Z");
    expect(related.issuerSign).toBe("SNTIA");
    expect(related.text).toContain("Limited Notice to Proceed");
    expect(related.text).not.toContain("For mer informasjon");
    expect(related.textChars).toBe(related.text.length);

    expect(result.telemetry.references).toHaveLength(1);
    expect(result.telemetry.references[0].date).toBe("2026-06-23");
    expect(result.telemetry.resolved[0]).toMatchObject({
      messageId: 676863,
      relation: "reference",
      resolvedBy: "db"
    });
    expect(result.telemetry.unresolved).toEqual([]);
    expect(store.calls).toContain("findByIssuerAndDate");
  });

  it("marks the reference ambiguous when two same-day notices overlap poorly", async () => {
    const store = memoryStore([
      candidate({
        messageId: 1,
        title: "Sentia ASA: Mandatory notification of trade",
        bodyText: "A primary insider has bought 1,000 shares. For further information contact IR."
      }),
      candidate({
        messageId: 2,
        publishedAt: new Date("2026-06-23T09:00:00.000Z"),
        title: "Sentia ASA: Key information relating to dividend",
        bodyText: "The board has resolved a dividend of NOK 1 per share. For further information contact IR."
      })
    ]);
    const result = await resolveRelatedNotices(source(), {
      enabledRelations,
      store
    });
    expect(result.related).toEqual([]);
    expect(result.telemetry.unresolved).toEqual([
      { raw: expect.stringContaining("vises til"), reason: "ambiguous" }
    ]);
  });

  it("falls back to Newsweb when the database has no notice on the cited day", async () => {
    const store = memoryStore([]);
    const fetched: number[] = [];
    const newsweb: RelatedNoticeNewswebClient = {
      async listByDate(date) {
        expect(date).toBe("2026-06-23");
        return [
          {
            messageId: 676863,
            title: candidate().title,
            issuerName: "Sentia ASA",
            issuerSign: "SNTIA",
            publishedTime: "2026-06-23T14:25:02.930Z"
          },
          {
            messageId: 676900,
            title: "Other Issuer ASA: Contract award",
            issuerName: "Other Issuer ASA",
            issuerSign: "OTHR",
            publishedTime: "2026-06-23T15:00:00.000Z"
          }
        ];
      },
      async fetchMessage(messageId) {
        fetched.push(messageId);
        return candidate({ messageId });
      }
    };
    const result = await resolveRelatedNotices(source(), {
      enabledRelations,
      store,
      newsweb
    });
    expect(fetched).toEqual([676863]);
    expect(result.related).toHaveLength(1);
    expect(result.related[0].resolvedBy).toBe("newsweb");
    expect(result.telemetry.resolved[0].resolvedBy).toBe("newsweb");
  });

  it.each([
    ["previous", "2026-06-22T10:00:00.000Z"],
    ["next", "2026-06-24T10:00:00.000Z"]
  ])(
    "rejects a %s-calendar-day database hit and falls back to the exact cited day",
    async (_label, wrongPublishedAt) => {
      const wrongDay = candidate({
        messageId: 676862,
        publishedAt: new Date(wrongPublishedAt),
        title: "Sentia ASA: Generic company update",
        bodyText: "Sentia ASA provides a general company update."
      });
      const newsweb: RelatedNoticeNewswebClient = {
        async listByDate(fromDate, toDate) {
          expect([fromDate, toDate]).toEqual(["2026-06-23", "2026-06-23"]);
          return [
            {
              messageId: 676863,
              title: candidate().title,
              issuerName: "Sentia ASA",
              issuerSign: "SNTIA",
              publishedTime: "2026-06-23T14:25:02.930Z"
            }
          ];
        },
        async fetchMessage(messageId) {
          return candidate({ messageId });
        }
      };

      const result = await resolveRelatedNotices(source(), {
        enabledRelations,
        store: memoryStore([wrongDay]),
        newsweb
      });

      expect(result.related).toHaveLength(1);
      expect(result.related[0]).toMatchObject({
        messageId: 676863,
        resolvedBy: "newsweb"
      });
    }
  );

  it("uses the Europe/Oslo calendar date at UTC day boundaries", async () => {
    const osloJune23 = candidate({
      messageId: 676860,
      publishedAt: new Date("2026-06-22T22:00:00.000Z")
    });
    const osloJune24 = candidate({
      messageId: 676861,
      publishedAt: new Date("2026-06-23T22:00:00.000Z")
    });

    expect(osloCalendarDate(osloJune23.publishedAt)).toBe("2026-06-23");
    expect(osloCalendarDate(osloJune24.publishedAt)).toBe("2026-06-24");

    const result = await resolveRelatedNotices(source(), {
      enabledRelations,
      store: memoryStore([osloJune23, osloJune24])
    });
    expect(result.related.map((notice) => notice.messageId)).toEqual([676860]);
  });

  it("rechecks the fetched Newsweb candidate's Oslo date before accepting it", async () => {
    const newsweb: RelatedNoticeNewswebClient = {
      async listByDate() {
        return [
          {
            messageId: 676863,
            title: candidate().title,
            issuerName: "Sentia ASA",
            issuerSign: "SNTIA",
            publishedTime: "2026-06-23T14:25:02.930Z"
          }
        ];
      },
      async fetchMessage(messageId) {
        return candidate({
          messageId,
          publishedAt: new Date("2026-06-24T10:00:00.000Z")
        });
      }
    };

    const result = await resolveRelatedNotices(source(), {
      enabledRelations,
      store: memoryStore([]),
      newsweb
    });
    expect(result.related).toEqual([]);
    expect(result.telemetry.unresolved).toEqual([
      { raw: expect.stringContaining("vises til"), reason: "no-candidate" }
    ]);
  });

  it("records fetch-failed when both the database and Newsweb are unavailable", async () => {
    const newsweb: RelatedNoticeNewswebClient = {
      async listByDate() {
        throw new Error("network");
      },
      async fetchMessage() {
        throw new Error("network");
      }
    };
    const result = await resolveRelatedNotices(source(), {
      enabledRelations,
      store: failingStore(),
      newsweb
    });
    expect(result.related).toEqual([]);
    expect(result.telemetry.unresolved[0].reason).toBe("fetch-failed");
  });

  it("attaches the correction target first and caps at two related notices", async () => {
    const corrected = candidate({
      messageId: 681400,
      title: "HENT signerer kontrakt (feil tall)",
      publishedAt: new Date("2026-09-02T04:00:00.000Z"),
      bodyText:
        "HENT har signert kontrakt med Nscale for å utvide datasenteret med to bygg med samlet kapasitet på 57 MW. Dette er en foreløpig melding som korrigeres. For mer informasjon, ta kontakt med Sverre Hærem, konserndirektør finans og CFO i Sentia ASA, på telefon eller e-post."
    });
    const store = memoryStore([candidate(), corrected]);
    const result = await resolveRelatedNotices(
      source({ rawMessageJson: { correctionForMessageId: 681400 } }),
      { enabledRelations, store }
    );
    expect(result.related.map((notice) => [notice.relation, notice.messageId])).toEqual([
      ["correction", 681400],
      ["reference", 676863]
    ]);
    expect(result.telemetry.references[0]).toMatchObject({
      messageId: 681400,
      raw: "correctionForMessageId=681400"
    });
  });

  it("rejects explicit-ID and correction candidates published after the source", async () => {
    const future = candidate({
      messageId: 700001,
      publishedAt: new Date("2026-09-03T05:00:00.000Z")
    });

    const explicit = await resolveRelatedNotices(
      source({
        bodyText:
          "Reference is made to https://newsweb.oslobors.no/message/700001 for details."
      }),
      { enabledRelations, store: memoryStore([future]) }
    );
    expect(explicit.related).toEqual([]);
    expect(explicit.telemetry.unresolved).toContainEqual({
      raw: expect.stringContaining("700001"),
      reason: "no-candidate"
    });

    const correction = await resolveRelatedNotices(
      source({
        bodyText: "Correction notice.",
        rawMessageJson: { correctionForMessageId: 700001 }
      }),
      { enabledRelations: ["correction"], store: memoryStore([future]) }
    );
    expect(correction.related).toEqual([]);
    expect(correction.telemetry.unresolved).toEqual([
      { raw: "correctionForMessageId=700001", reason: "no-candidate" }
    ]);
  });

  it("resolves an undated formula reference within the previous week on a clear topic match", async () => {
    const contemplated = candidate({
      messageId: 681058,
      title: "Nykode Therapeutics ASA - Contemplated Private Placement",
      issuerName: "Nykode Therapeutics ASA",
      issuerSign: "NYKD",
      publishedAt: new Date("2026-08-27T14:32:05.077Z"),
      bodyText:
        "Nykode Therapeutics ASA has engaged managers to advise on a contemplated private placement of new shares raising gross proceeds of approximately NOK 286 million. For further information, please contact the CFO."
    });
    const unrelated = candidate({
      messageId: 681000,
      title: "Nykode Therapeutics ASA - Mandatory notification of trade",
      issuerName: "Nykode Therapeutics ASA",
      issuerSign: "NYKD",
      publishedAt: new Date("2026-08-24T08:00:00.000Z"),
      bodyText: "A primary insider has sold 10,000 shares at NOK 4.60. For further information contact IR."
    });
    const store = memoryStore([contemplated, unrelated]);
    const result = await resolveRelatedNotices(
      source({
        messageId: 681076,
        issuerName: "Nykode Therapeutics ASA",
        issuerSign: "NYKD",
        publishedAt: new Date("2026-08-27T21:51:37.331Z"),
        bodyText:
          'Reference is made to the stock exchange notice published by Nykode Therapeutics ASA ("Nykode" or the "Company") related to the contemplated private placement in the Company (the "Private Placement"). The Company is pleased to announce that the Private Placement has been successfully placed.'
      }),
      { enabledRelations, store }
    );
    expect(result.related.map((notice) => notice.messageId)).toEqual([681058]);
    expect(result.telemetry.references[0].date).toBeNull();

    // Without a clear topic winner an undated reference attaches nothing.
    const vague = await resolveRelatedNotices(
      source({
        messageId: 681076,
        issuerName: "Nykode Therapeutics ASA",
        issuerSign: "NYKD",
        publishedAt: new Date("2026-08-27T21:51:37.331Z"),
        bodyText: "Reference is made to the stock exchange notice published by the Company related to the matter."
      }),
      { enabledRelations, store: memoryStore([contemplated, unrelated]) }
    );
    expect(vague.related).toEqual([]);
  });

  it("does nothing when every relation is disabled", async () => {
    const store = memoryStore([candidate()]);
    const result = await resolveRelatedNotices(source(), {
      enabledRelations: [],
      store
    });
    expect(result.related).toEqual([]);
    expect(result.telemetry.references).toEqual([]);
    expect(store.calls).toEqual([]);
  });

  it("ignores references to the notice itself and undated mentions", async () => {
    const store = memoryStore([candidate()]);
    const result = await resolveRelatedNotices(
      source({
        bodyText:
          "The Company has placed the previously announced retail private placement. Reference is made to https://newsweb.oslobors.no/message/681428 for details."
      }),
      { enabledRelations, store }
    );
    expect(result.related).toEqual([]);
    expect(result.telemetry.unresolved.every((entry) => entry.reason === "self")).toBe(true);
  });

  it("never throws when the extractor sees odd input", async () => {
    const store = memoryStore([]);
    const result = await resolveRelatedNotices(source({ bodyText: "" }), {
      enabledRelations,
      store
    });
    expect(result.related).toEqual([]);
    expect(result.telemetry.durationMs).toBeGreaterThanOrEqual(0);
  });
});
