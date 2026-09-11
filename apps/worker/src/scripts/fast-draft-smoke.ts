import { config as loadEnv } from "dotenv";
import { writeFileSync } from "node:fs";
import OpenAI from "openai";
import type { PromptPayload } from "@newsweb/prompt-kit";
import { callOpenAIForJson } from "@newsweb/shared/openai-responses";
import { generateFastDraft } from "../services/fast-draft.js";
import { parseWorkerConfig } from "../config.js";
loadEnv({ path: process.env.FAST_DRAFT_SMOKE_ENV_FILE ?? ".env", quiet: true });
if (!process.env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY missing");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
const config = parseWorkerConfig({ ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost/unused",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
const model = config.OPENAI_NOTICE_HELPER_MODEL ?? config.OPENAI_FAST_MODEL;
const reasoningEffort = config.OPENAI_TRIAGE_REASONING_EFFORT;
const cases = [
    { title: "Fjord ASA files for bankruptcy", bodyText: "The board of Fjord ASA has today filed for bankruptcy. The company is insolvent and has been unable to secure additional financing. The bankruptcy petition was submitted to Oslo District Court on 7 September 2026. The court has not yet opened bankruptcy proceedings." },
    { title: "Fjord ASA warns of severe losses and liquidity crisis", bodyText: "Fjord ASA now expects an operating loss of NOK 800 million for 2026, compared with previous guidance of an operating profit of NOK 300 million. The company has breached its loan covenants and warns that it may run out of cash within two weeks unless it secures new financing. Discussions with lenders are ongoing; no agreement has been reached." },
    { title: "Fjord ASA issues profit warning", bodyText: "Fjord ASA now expects operating profit for 2026 of NOK 200 million, down from its previous guidance of NOK 350 million. The revision follows lower demand in the Norwegian market. The figures are preliminary and unaudited." },
    { title: "Fjord ASA enters agreement to acquire Dal AS", bodyText: "Fjord ASA has signed an agreement to acquire all shares in Dal AS for NOK 200 million. Closing is conditional on approval from the Norwegian Competition Authority. Fjord expects completion in the fourth quarter of 2026. The acquisition has not yet been completed." },
    { title: "Fjord ASA mandatory notification of trade", bodyText: "The chief executive of Fjord ASA has purchased 500 shares at NOK 20 per share. The purchase was made on 7 September 2026. Following the transaction, the chief executive owns 1500 shares. This is a routine mandatory notification." }
];
const results = [];
for (const [index, source] of cases.entries()) {
    if (process.env.FAST_DRAFT_SMOKE_CASE && index !== Number(process.env.FAST_DRAFT_SMOKE_CASE))
        continue;
    const payload: PromptPayload = { ...source, messageId: 990001 + index, issuerName: "Fjord ASA", issuerSign: "FJORD", publishedAt: "2026-09-07T10:00:00.000Z", hasAttachments: false, categories: [], markets: [], sourceBodyChars: source.bodyText.length };
    const calls: unknown[] = [];
    const started = Date.now();
    try {
        const result = await generateFastDraft(payload, model, started + 35000, (request) => callOpenAIForJson(client, request), ({ content, ...telemetry }, request) => calls.push({ ...telemetry, schemaName: request.schemaName, reasoningEffort: request.reasoningEffort, output: JSON.parse(content) }), reasoningEffort);
        results.push({ source, status: result.status, durationMs: Date.now() - started, ...(result.status === "ready" ? { rewrite: result.rewrite, validation: result.validation } : {}), calls });
    }
    catch (error) {
        results.push({ source, status: "failed", durationMs: Date.now() - started, error: error instanceof Error ? error.message : "unknown", calls });
    }
}
const report = { testedAt: new Date().toISOString(), model, reasoningEffort, syntheticSources: true, results };
writeFileSync(process.env.FAST_DRAFT_SMOKE_OUTPUT ?? "fast-draft-smoke.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
