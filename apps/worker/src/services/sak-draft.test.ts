import type { SakArticle, SakDraftJobData } from "@newsweb/shared";
import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  SakDraftFatalError,
  buildSakPromptPayload,
  classifySakFailure,
  parseSakArticleResponse,
  processSakDraft,
  sakReasoningEffort,
  type SakDraftDeps,
  type SakDraftJob,
  type SakModelCallInput
} from "./sak-draft.js";

const MATERIAL_TEXT =
  "Air Canada announces a new non-stop route between Oslo and Toronto for summer 2027. Flights operate four times per week from June 3 to October 11, 2027, with 182 seats on the A321XLR.";

function jobData(overrides: Partial<SakDraftJobData> = {}): SakDraftJobData {
  return {
    sakId: "cksak1",
    generationRunId: "run1",
    targetVersion: 1,
    materials: [
      {
        id: "ckm1",
        sourceId: "material_ckm1",
        kind: "pdf",
        title: "Pressemelding",
        url: null,
        status: "ready",
        errorText: null,
        text: MATERIAL_TEXT,
        textChars: MATERIAL_TEXT.length
      }
    ],
    targetChars: 1500,
    todayIso: "2026-09-04T08:00:00.000Z",
    ...overrides
  };
}

function job(overrides: Partial<SakDraftJob> = {}, data: Partial<SakDraftJobData> = {}): SakDraftJob {
  return {
    id: "42",
    name: "sak-draft",
    data: jobData(data),
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides
  };
}

function article(overrides: Partial<SakArticle> = {}): SakArticle {
  const paragraph =
    "Ruten blir en sommerrute, og selskapet blir det eneste nordamerikanske flyselskapet med direktefly til Norge, [[ifølge pressemeldingen|material_ckm1]]. ";
  return {
    sources: [{ materialId: "material_ckm1", usedFor: "rutedager og flytype" }],
    source_spans: ['material_ckm1: "four times per week"'],
    excluded_hype: [],
    title: "Air Canada åpner rute mellom Oslo og Toronto",
    lead: "Canadas største flyselskap starter direkterute mellom Oslo og Toronto neste sommer.",
    blocks: [
      { kind: "paragraph", text: paragraph.repeat(4).trim() },
      { kind: "subheading", text: "Fire avganger i uken" },
      {
        kind: "paragraph",
        text: "Flyet går fire ganger i uken fra 3. juni til 11. oktober, med 182 seter om bord. ".repeat(6).trim()
      },
      { kind: "paragraph", text: "Les mer i [[dekningen|material_finnesikke]] av ruten. ".repeat(4).trim() }
    ],
    desk_notes: ["Ingen merknader"],
    change_note: "Noe",
    ...overrides
  };
}

type VersionRow = Record<string, unknown> & { status: string };

function fakeDeps(options: {
  draft?: { id: string; activeGenerationRunId: string | null } | null;
  responses?: Array<SakArticle | Error | (() => SakArticle)>;
} = {}) {
  const versions = new Map<string, VersionRow>();
  const runUpdates: Array<Record<string, unknown>> = [];
  const releases: Array<{ id: string; activeGenerationRunId: string }> = [];
  const calls: SakModelCallInput[] = [];
  const responses = [...(options.responses ?? [article()])];
  const draft = options.draft === undefined ? { id: "cksak1", activeGenerationRunId: "run1" } : options.draft;

  const deps: SakDraftDeps = {
    prisma: {
      sakDraft: {
        async findUnique() {
          return draft;
        },
        async updateMany(args) {
          releases.push(args.where);
          return { count: 1 };
        }
      },
      sakVersion: {
        async upsert(args) {
          const key = `${args.where.sakId_version.sakId}:${args.where.sakId_version.version}`;
          const existing = versions.get(key);
          versions.set(key, existing ? { ...existing, ...args.update } : { ...args.create });
        }
      }
    },
    logPrisma: {
      generationRun: {
        async update(args) {
          runUpdates.push(args.data as Record<string, unknown>);
        }
      }
    },
    callModelForJson: vi.fn(async (input: SakModelCallInput) => {
      calls.push(input);
      const next = responses.shift();
      if (!next) throw new Error("no scripted response");
      if (next instanceof Error) throw next;
      const value = typeof next === "function" ? next() : next;
      return {
        content: JSON.stringify(value),
        promptChars: input.userPrompt.length,
        modelCall: { model: "gpt-test" }
      };
    }),
    promptCacheMode: "implicit",
    config: { OPENAI_SAK_REASONING_EFFORT: "high", OPENAI_SAK_TIMEOUT_MS: 1000 },
    log: () => undefined,
    now: () => new Date("2026-09-04T09:00:00Z")
  };

  return {
    deps,
    calls,
    releases,
    runUpdates,
    version: () => versions.get("cksak1:1"),
    phases: () => runUpdates.map((update) => update.phase).filter(Boolean)
  };
}

describe("classifySakFailure", () => {
  it("never retries a fatal error", () => {
    const result = classifySakFailure(new SakDraftFatalError("SAK_DELETED", "borte"), false);
    expect(result).toMatchObject({ kind: "fatal", code: "SAK_DELETED", status: "failed", rethrow: false });
  });

  it("marks needs_retry and rethrows before the last attempt", () => {
    expect(classifySakFailure(new Error("openai down"), false)).toMatchObject({
      kind: "retry",
      status: "needs_retry",
      rethrow: true,
      errorText: "openai down"
    });
  });

  it("fails for good on the last attempt", () => {
    expect(classifySakFailure("boom", true)).toMatchObject({
      kind: "final",
      status: "failed",
      rethrow: false,
      errorText: "boom"
    });
  });
});

describe("sakReasoningEffort", () => {
  const config = { OPENAI_SAK_REASONING_EFFORT: "high" as const, OPENAI_SAK_TIMEOUT_MS: 1 };

  it("uses the configured effort for drafts and medium for revisions and repairs", () => {
    expect(sakReasoningEffort({}, config, "draft")).toBe("high");
    expect(sakReasoningEffort({}, config, "revision")).toBe("medium");
    expect(sakReasoningEffort({}, config, "repair")).toBe("medium");
  });

  it("honours the xhigh override everywhere", () => {
    expect(sakReasoningEffort({ reasoningEffortOverride: "xhigh" }, config, "draft")).toBe("xhigh");
    expect(sakReasoningEffort({ reasoningEffortOverride: "xhigh" }, config, "repair")).toBe("xhigh");
  });
});

describe("parseSakArticleResponse", () => {
  it("rejects malformed json and schema violations with distinct codes", () => {
    expect(() => parseSakArticleResponse("{not json")).toThrow(/SAK_ARTICLE_PARSE_FAILED/);
    expect(() => parseSakArticleResponse(JSON.stringify({ title: "x" }))).toThrow(/SAK_ARTICLE_SCHEMA_FAILED/);
    expect(parseSakArticleResponse(JSON.stringify(article())).title).toContain("Air Canada");
  });
});

describe("buildSakPromptPayload", () => {
  it("maps snapshots to prompt materials", () => {
    const payload = buildSakPromptPayload(
      jobData({
        instruction: "Kort lead",
        titleOverride: "Egen tittel",
        materials: [
          ...jobData().materials,
          {
            id: "ckm2",
            sourceId: "material_ckm2",
            kind: "url",
            title: "E24",
            url: "https://e24.no/x",
            status: "failed",
            errorText: "Betalingsmur",
            text: "",
            textChars: 0
          }
        ]
      })
    );
    expect(payload.materials[1]).toMatchObject({ sourceId: "material_ckm2", status: "failed", failureReason: "Betalingsmur" });
    expect(payload).toMatchObject({ instruction: "Kort lead", titleOverride: "Egen tittel", targetChars: 1500 });
  });
});

describe("processSakDraft", () => {
  it("writes a ready version, normalizes links, releases the slot and closes the run", async () => {
    const fake = fakeDeps();
    await processSakDraft(job(), fake.deps);

    const version = fake.version();
    expect(version?.status).toBe("ready");
    expect(version?.changeNote).toBe("Første utkast");
    expect(version?.model).toBe("gpt-test");
    const stored = version?.articleJson as unknown as SakArticle;
    expect(stored.blocks[3]?.text).not.toContain("material_finnesikke");
    expect(stored.blocks[3]?.text).toContain("dekningen");
    expect(stored.blocks[0]?.text).toContain("[[ifølge pressemeldingen|material_ckm1]]");

    expect(fake.releases).toEqual([{ id: "cksak1", activeGenerationRunId: "run1" }]);
    expect(fake.phases()).toEqual([
      "reading_notice",
      "analyzing_content",
      "writing_notice",
      "checking_references",
      "finalizing",
      "published"
    ]);
    expect(fake.runUpdates.at(-1)).toMatchObject({ status: "published", model: "gpt-test" });

    const call = fake.calls[0];
    expect(call).toMatchObject({
      schemaName: "sak_article",
      reasoningEffort: "high",
      maxOutputTokens: 24576,
      timeoutMs: 1000,
      promptCacheKey: expect.stringMatching(/^newsweb:sak:sak-v/)
    });
    expect(call?.userPrompt).toContain("[material_ckm1]");
    expect(fake.calls).toHaveLength(1);
  });

  it("uses the revision prompt at medium effort when there is a previous article and an instruction", async () => {
    const previous = article();
    const fake = fakeDeps({ responses: [article({ change_note: "Kortere lead" })] });
    await processSakDraft(
      job({}, { targetVersion: 2, previousArticleJson: previous, instruction: "Kortere lead" }),
      fake.deps
    );
    const call = fake.calls[0];
    expect(call?.reasoningEffort).toBe("medium");
    expect(call?.userPrompt).toContain("FORRIGE VERSJON");
    expect(call?.userPrompt.indexOf("KILDEMATERIALE")).toBeLessThan(call?.userPrompt.indexOf("FORRIGE VERSJON") ?? 0);
    expect(call?.userPrompt).toContain("Kortere lead");
    expect(fake.version()?.status).toBeUndefined();
  });

  it("runs one repair call when the validator blocks and stores needs_review if it still blocks", async () => {
    const blocked = article({ lead: "Canadas største flyselskap starter direkterute med 900 seter neste sommer." });
    const fixed = article();
    const repaired = fakeDeps({ responses: [blocked, fixed] });
    await processSakDraft(job(), repaired.deps);
    expect(repaired.calls).toHaveLength(2);
    expect(repaired.calls[1]?.reasoningEffort).toBe("medium");
    expect(repaired.calls[1]?.userPrompt).toContain("KORRIGERINGSMODUS");
    expect(repaired.calls[1]?.userPrompt).toContain("900");
    expect(repaired.version()?.status).toBe("ready");

    const stillBlocked = fakeDeps({ responses: [blocked, blocked] });
    await processSakDraft(job(), stillBlocked.deps);
    expect(stillBlocked.calls).toHaveLength(2);
    expect(stillBlocked.version()?.status).toBe("needs_review");
    const validation = stillBlocked.version()?.validationJson as { blockingErrors: string[]; repair: { attempted: boolean } };
    expect(validation.blockingErrors[0]).toContain("900");
    expect(validation.repair.attempted).toBe(true);
    expect(stillBlocked.releases).toHaveLength(1);
  });

  it("keeps the first draft when the repair call itself fails", async () => {
    const blocked = article({ lead: "Canadas største flyselskap starter direkterute med 900 seter neste sommer." });
    const fake = fakeDeps({ responses: [blocked, new Error("repair timeout")] });
    await processSakDraft(job(), fake.deps);
    expect(fake.version()?.status).toBe("needs_review");
    const validation = fake.version()?.validationJson as { repair: { error: string | null } };
    expect(validation.repair.error).toBe("repair timeout");
  });

  it("marks the version failed and the run superseded when another run owns the draft", async () => {
    const fake = fakeDeps({ draft: { id: "cksak1", activeGenerationRunId: "run-other" } });
    await processSakDraft(job(), fake.deps);
    expect(fake.calls).toHaveLength(0);
    expect(fake.version()).toMatchObject({ status: "failed", errorText: "SAK_SUPERSEDED" });
    expect(fake.runUpdates.at(-1)).toMatchObject({ status: "superseded" });
    expect(fake.releases).toEqual([]);
  });

  it("fails without retry when the draft is gone", async () => {
    const fake = fakeDeps({ draft: null });
    await expect(processSakDraft(job(), fake.deps)).resolves.toBeUndefined();
    // Cascade removed the version rows and the slot with the draft: only the
    // log-DB run is closed out, nothing else is touched.
    expect(fake.runUpdates.at(-1)).toMatchObject({ status: "failed", errorText: expect.stringContaining("SAK_DELETED") });
    expect(fake.releases).toHaveLength(0);
  });

  it("stores needs_retry and rethrows model failures before the last attempt", async () => {
    const fake = fakeDeps({ responses: [new Error("openai 500")] });
    await expect(processSakDraft(job(), fake.deps)).rejects.toThrow("openai 500");
    // The desk sees a short Norwegian line; the raw diagnostics live in validationJson.
    expect(fake.version()).toMatchObject({
      status: "needs_retry",
      errorText: "Genereringen feilet. Prøver igjen."
    });
    expect(fake.version()?.validationJson).toMatchObject({ errors: ["openai 500"] });
    expect(fake.runUpdates.at(-1)).toMatchObject({
      status: "needs_retry",
      phase: "queued",
      errorText: expect.stringContaining("openai 500")
    });
    expect(fake.releases).toEqual([]);
  });

  it("fails for good on the last attempt and releases the slot", async () => {
    const fake = fakeDeps({ responses: [new Error("openai 500")] });
    await expect(processSakDraft(job({ attemptsMade: 2 }), fake.deps)).resolves.toBeUndefined();
    expect(fake.version()?.status).toBe("failed");
    expect(fake.runUpdates.at(-1)).toMatchObject({ status: "failed", errorText: expect.stringContaining("SAK_DRAFT_FAILED_FINAL") });
    expect(fake.releases).toHaveLength(1);
  });

  it("refuses to draft without a readable material", async () => {
    const fake = fakeDeps();
    await processSakDraft(
      job({}, { materials: [{ ...jobData().materials[0]!, status: "failed", text: "", textChars: 0 }] }),
      fake.deps
    );
    expect(fake.calls).toHaveLength(0);
    expect(fake.version()).toMatchObject({ status: "failed" });
    expect(fake.runUpdates.at(-1)).toMatchObject({ errorText: expect.stringContaining("SAK_NO_MATERIALS") });
  });

  it("stores json-safe article data", async () => {
    const fake = fakeDeps();
    await processSakDraft(job(), fake.deps);
    const stored = fake.version()?.articleJson as Prisma.InputJsonValue;
    expect(() => JSON.stringify(stored)).not.toThrow();
  });
});
