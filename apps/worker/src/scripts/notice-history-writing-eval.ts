import fs from "node:fs/promises";
import { parse } from "dotenv";
import { createSystemPrompt,createDeveloperPrompt,createUserPrompt,createRevisionUserPrompt } from "@newsweb/prompt-kit";
import { rewriteOutputJsonSchema,rewriteOutputSchema } from "@newsweb/shared";
import { createOpenAIClient,callOpenAIForJson } from "../services/openai-responses.js";
import { applyHistoryDecision,historyWriterGuidance } from "../services/notice-history.js";
import { applyImportanceHighBar } from "../services/importance.js";
import { sanitizeRewriteStyle } from "../services/style-sanitizer.js";
import { validateRewriteOutput } from "../services/rewrite-validation.js";
import { buildReferenceCheckPrompt,referenceCheckJsonSchema,referenceCheckResultSchema,buildCoverageReport,assessReferenceCheckGate,buildCorrectionInstruction } from "../services/reference-check.js";

// Standalone generation-only check. No worker startup, database, publishing or source fetching.
const [artifactPath,envPath,out,resumePath]=process.argv.slice(2);
if(!artifactPath||!envPath||!out)throw Error('Required: assessment-artifact env-file new-output-file');
const artifact=JSON.parse(await fs.readFile(artifactPath,'utf8'));
const payload=artifact.payload;applyHistoryDecision(payload,artifact.details.assessment);
const env={...parse(await fs.readFile(envPath)),...process.env};
if(!env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY missing');
const client=createOpenAIClient(env.OPENAI_API_KEY);
const profile={model:'gpt-5.6-sol',reasoningEffort:'medium' as const,timeoutMs:120000,maxOutputTokens:4000,serviceTier:'default' as const,promptCacheMode:'implicit' as const};
const resumed=resumePath?JSON.parse(await fs.readFile(resumePath,'utf8')):null;
const generation=resumed?.generation ?? await callOpenAIForJson(client,{...profile,schemaName:'rewrite_output',schema:rewriteOutputJsonSchema,
  systemPrompt:createSystemPrompt(),developerPrompt:createDeveloperPrompt(undefined,payload),userPrompt:createUserPrompt(payload)+historyWriterGuidance(payload)});
const initial=rewriteOutputSchema.parse(resumed?.rewrite ?? JSON.parse(generation.content));
const styled=sanitizeRewriteStyle(initial).rewrite;
const importance=applyImportanceHighBar(styled,payload);let rewrite=importance.rewrite;
const refPayload=payload.pdfSupplementText?{...payload,bodyText:payload.bodyText+'\n\n'+payload.pdfSupplementText}:payload;
const prompt=buildReferenceCheckPrompt(refPayload,rewrite);
const checked=resumed?.checked ?? await callOpenAIForJson(client,{...profile,schemaName:'reference_check_result',schema:referenceCheckJsonSchema,
  systemPrompt:prompt.systemPrompt,developerPrompt:prompt.developerPrompt,userPrompt:prompt.userPrompt});
let coverage=buildCoverageReport(prompt.draftSentences,referenceCheckResultSchema.parse(JSON.parse(checked.content)),{
  visibleArticleSentenceCount:prompt.visibleDraftSentences.length,headSentenceCount:prompt.headDraftSentenceCount,priorContext:prompt.priorContext});
let gate=assessReferenceCheckGate(coverage);let validation=validateRewriteOutput(rewrite,refPayload);
const repairs=[];
for(let attempt=1;attempt<=2 && (gate.blocking || !validation.valid);attempt++){
  const instruction=[buildCorrectionInstruction(coverage,{gate,attempt,maxAttempts:2}),...validation.errors,
    'Rett de identifiserte feilene. Ved begrenset PDF-grunnlag: skriv uttrykkelig i source_limitations at bare utdrag er analysert. Bevar dagens vinkel.'].filter(Boolean).join('\n');
  const repaired=await callOpenAIForJson(client,{...profile,schemaName:'rewrite_output',schema:rewriteOutputJsonSchema,
    systemPrompt:createSystemPrompt(),developerPrompt:createDeveloperPrompt(undefined,payload),userPrompt:createRevisionUserPrompt(payload,rewrite,instruction)+historyWriterGuidance(payload)});
  rewrite=applyImportanceHighBar(sanitizeRewriteStyle(rewriteOutputSchema.parse(JSON.parse(repaired.content))).rewrite,payload).rewrite;
  const rp=buildReferenceCheckPrompt(refPayload,rewrite);
  const rc=await callOpenAIForJson(client,{...profile,schemaName:'reference_check_result',schema:referenceCheckJsonSchema,
    systemPrompt:rp.systemPrompt,developerPrompt:rp.developerPrompt,userPrompt:rp.userPrompt});
  coverage=buildCoverageReport(rp.draftSentences,referenceCheckResultSchema.parse(JSON.parse(rc.content)),{visibleArticleSentenceCount:rp.visibleDraftSentences.length,headSentenceCount:rp.headDraftSentenceCount,priorContext:rp.priorContext});
  gate=assessReferenceCheckGate(coverage);validation=validateRewriteOutput(rewrite,refPayload);
  repairs.push({attempt,repaired,checked:rc,gate,validation});
}
await fs.writeFile(out,JSON.stringify({payload,initial,rewrite,importance,coverage,gate,validation,generation,checked,repairs},null,2),{flag:'wx'});
console.log(JSON.stringify({title:rewrite.title,importance:rewrite.importance,body:rewrite.body,lead:rewrite.lead,referenceGate:gate,validation},null,2));
