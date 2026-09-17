import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import type { NoticeJsonCaller, NoticeModelCallLog } from "./notice-model-client.js";
import { buildBoundReferencePrompt, boundReferenceJsonSchema, bindReferenceResult, type BoundReport } from "./bound-reference-check.js";
import { collectDraftSentences, type ReferenceCoverageReport } from "./reference-check.js";

/** One retry repairs evidence IDs/format only; semantic failures go to the existing article repair loop. */
export async function checkBoundReferences(payload: PromptPayload, draft: RewriteOutput, call: NoticeJsonCaller, calls: NoticeModelCallLog[]) {
  const prompt = buildBoundReferencePrompt(payload, draft);
  let promptChars = 0, errorText = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await call({ schemaName: "bound_reference_check", schema: boundReferenceJsonSchema,
      systemPrompt: prompt.systemPrompt, developerPrompt: prompt.developerPrompt,
      userPrompt: prompt.userPrompt + (errorText ? `\nForrige bevisformat var ugyldig: ${errorText}. Rett bare bevisvalget; artikkelen er uendret.` : ""),
      promptCacheKey: "newsweb:bound-reference-v1" });
    calls.push(result.modelCall);
    promptChars += result.promptChars;
    try {
      return { coverage: bindReferenceResult(payload, draft, prompt.sources, JSON.parse(result.content)), promptChars, modelCall: null };
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
      if (attempt === 1) throw Object.assign(new Error(`Bound reference check unavailable: ${errorText}`), { promptChars });
    }
  }
  throw new Error("Bound reference check unavailable");
}

export function attachBoundSourceLinks(draft: RewriteOutput, coverage: ReferenceCoverageReport | null): RewriteOutput {
  if (coverage?.bindingVersion !== "bound-reference-v1") return draft;
  // Never apply bindings belonging to a pre-edit draft.
  if (JSON.stringify(collectDraftSentences(draft)) !== JSON.stringify(coverage.items.map(i => i.sentence))) {
    throw new Error("BOUND_FINAL_DRAFT_CHANGED");
  }
  return { ...draft, source_links: (coverage as BoundReport).sourceLinks };
}
