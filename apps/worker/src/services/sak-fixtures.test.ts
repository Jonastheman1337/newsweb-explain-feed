import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sakArticleSchema, sakLinkedMaterialIds, type SakDraftJobData } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { buildSakPromptPayload } from "./sak-draft.js";
import { countSakSentences, validateSakArticle } from "./sak-validation.js";

/**
 * The two pieces the owner and Claude wrote by hand before /sak existed,
 * replayed through the validator with their real materials. They are the
 * bar: the validator must let the published shape through with zero
 * blocking issues, and the numeric gate must find the figures that came
 * out of the PDF tables.
 */

type SakFixture = {
  id: string;
  sakId: string;
  todayIso: string;
  titleOverride: string | null;
  instruction: string;
  targetChars: number;
  materials: SakDraftJobData["materials"];
  article: unknown;
  expected: {
    leadSentenceCountMax: number;
    firstParagraphNoLeadingDigit: boolean;
    excludedHypeMin: number;
    blockingCount: number;
    visibleCharsWithinBand: boolean;
    deskNotesNonEmpty: boolean;
    numericGateDisplays: string[];
  };
};

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sak"
);

async function loadFixture(name: string): Promise<SakFixture> {
  const raw = await fs.readFile(path.join(FIXTURE_DIR, `${name}.json`), "utf8");
  return JSON.parse(raw) as SakFixture;
}

function runFixture(fixture: SakFixture) {
  const article = sakArticleSchema.parse(fixture.article);
  const payload = buildSakPromptPayload({
    sakId: fixture.sakId,
    generationRunId: "fixture-run",
    targetVersion: 1,
    materials: fixture.materials,
    instruction: fixture.instruction,
    titleOverride: fixture.titleOverride,
    targetChars: fixture.targetChars,
    todayIso: fixture.todayIso
  });
  const result = validateSakArticle(article, payload, {
    titleOverride: fixture.titleOverride,
    targetChars: fixture.targetChars,
    isFirstDraft: true
  });
  return { article, payload, result };
}

function assertFixture(fixture: SakFixture): void {
  const { article, result } = runFixture(fixture);
  const expected = fixture.expected;

  expect(countSakSentences(article.lead)).toBeLessThanOrEqual(expected.leadSentenceCountMax);

  const firstParagraph = article.blocks.find((block) => block.kind === "paragraph");
  expect(firstParagraph).toBeDefined();
  if (expected.firstParagraphNoLeadingDigit) {
    expect(/^\s*\d/.test(firstParagraph!.text)).toBe(false);
  }

  const materialIds = new Set(fixture.materials.map((material) => material.sourceId));
  for (const linked of sakLinkedMaterialIds(article)) {
    expect(materialIds.has(linked), linked).toBe(true);
  }
  expect(sakLinkedMaterialIds(article).length).toBeGreaterThan(0);

  expect(article.excluded_hype.length).toBeGreaterThanOrEqual(expected.excludedHypeMin);
  if (expected.deskNotesNonEmpty) {
    expect(article.desk_notes.length).toBeGreaterThan(0);
  }

  expect(result.blockingErrors, result.blockingErrors.join("\n")).toHaveLength(expected.blockingCount);
  if (expected.visibleCharsWithinBand) {
    expect(result.visibleChars).toBeGreaterThanOrEqual(result.lengthBand.min);
    expect(result.visibleChars).toBeLessThanOrEqual(result.lengthBand.max);
  }

  for (const display of expected.numericGateDisplays) {
    const matches = result.numberAssessments.filter((assessment) => assessment.display === display);
    expect(matches.length, `numeric gate saw ${display}`).toBeGreaterThan(0);
    expect(
      matches.every((assessment) => assessment.disposition !== "unexpected"),
      `${display} covered by materials`
    ).toBe(true);
  }
  expect(result.unexpectedNumbers).toEqual([]);

  // The transcribed articles keep their links intact through validation.
  expect(sakLinkedMaterialIds(result.article)).toEqual(sakLinkedMaterialIds(article));
}

describe("sak fixtures", () => {
  it("Danske Bank Nordic Outlook passes the validator with the PDF as the only figure source", async () => {
    const fixture = await loadFixture("danske-bank-nordic-outlook");
    assertFixture(fixture);
    const { result } = runFixture(fixture);
    expect(result.article.title).toBe("Danske Bank venter tre rentekutt i 2027");
    expect(result.article.change_note).toBe("Første utkast");
    const quoteBlocks = result.article.blocks.filter((block) => block.kind === "quote");
    expect(quoteBlocks.length).toBeGreaterThanOrEqual(3);
    expect(quoteBlocks.every((block) => block.text.startsWith("– "))).toBe(true);
    const failedIds = fixture.materials.filter((m) => m.status === "failed").map((m) => m.sourceId);
    expect(sakLinkedMaterialIds(result.article).some((id) => failedIds.includes(id))).toBe(true);
  });

  it("Air Canada Oslo–Toronto passes with the PR ledger filled and no numbers up top", async () => {
    const fixture = await loadFixture("air-canada-oslo-toronto");
    assertFixture(fixture);
    const { article, result } = runFixture(fixture);
    expect(article.excluded_hype.some((entry) => /Galardo/.test(entry.speaker ?? ""))).toBe(true);
    expect(/styrker sin posisjon/.test(result.article.blocks.map((b) => b.text).join(" "))).toBe(false);
    expect(/\d/.test(article.lead)).toBe(false);
    expect(result.article.blocks[0]?.kind).toBe("paragraph");
    expect(result.article.blocks.some((block) => block.kind === "subheading")).toBe(true);
  });
});
