import { describe, expect, it } from "vitest";
import { EDITORIAL_CURRENCY_NAMES } from "./currency-editorial.js";
import { createDeveloperPrompt } from "./prompt.js";
import { createReportDeveloperPrompt } from "./report-prompt.js";
import { createYearlyReportDeveloperPrompt } from "./yearly-report-prompt.js";
import { createSakDeveloperPrompt } from "./sak-prompt.js";
import { createHybridDeveloperPrompt, createHybridReportDeveloperPrompt, createHybridYearlyReportDeveloperPrompt } from "./editorial-hybrid-prompt.js";

describe("shared currency style across writing paths", () => {
  it.each([
    ["regular", () => createDeveloperPrompt("{}")],
    ["report", () => createReportDeveloperPrompt("{}")],
    ["yearly", () => createYearlyReportDeveloperPrompt("{}")],
    ["sak", () => createSakDeveloperPrompt()],
    ["production regular", () => createHybridDeveloperPrompt()],
    ["production report", () => createHybridReportDeveloperPrompt()],
    ["production yearly", () => createHybridYearlyReportDeveloperPrompt()]
  ] as const)("applies currency names to %s", (_name, build) => {
    expect(build()).toContain(EDITORIAL_CURRENCY_NAMES);
    expect(build()).not.toMatch(/Gjengi summer og valuta slik de st(?:ar|år) i kilden/);
  });
});
