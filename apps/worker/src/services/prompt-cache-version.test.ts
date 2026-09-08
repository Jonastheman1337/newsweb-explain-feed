import { readFileSync } from "node:fs";
import { EDITORIAL_HYBRID_PROMPT_VERSION } from "@newsweb/prompt-kit";
import { expect, it } from "vitest";

it("keeps every production worker cache key within the API's 64-character limit", () => {
  const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
  const keys = [...worker.matchAll(/promptCacheKey: `([^`]*\$\{PROMPT_VERSION\}[^`]*)`/g)]
    .map((match) => match[1].replace("${PROMPT_VERSION}", EDITORIAL_HYBRID_PROMPT_VERSION));
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) expect(key.length, key).toBeLessThanOrEqual(64);
});
