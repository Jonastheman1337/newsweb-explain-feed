import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import type { PromptPayload } from "@newsweb/prompt-kit";
import { callOpenAIForJson, createOpenAIClient } from "../services/openai-responses.js";
import { HISTORY_PROMPT, HISTORY_VERSION, selectHistory, buildHistoryPrompt, historyAssessmentJsonSchema, validateHistoryAssessment } from "../services/notice-history.js";
import type { RelatedNoticeCandidate } from "../services/related-notices.js";

const args=process.argv.slice(2);
const arg=(key:string)=>args[args.indexOf(key)+1];
if(!args.includes('--env-file') || !args.includes('--out')) throw Error('Required: --env-file PATH --out NEW_DIRECTORY');
const env={...parse(await fs.readFile(arg('--env-file'))),...process.env};
if(!env.OPENAI_API_KEY) throw Error('OPENAI_API_KEY missing');
const out=arg('--out'); await fs.mkdir(out,{recursive:false});
const bytes=await fs.readFile(args.includes('--cases') ? arg('--cases') : new URL('../fixtures/notice-history.json',import.meta.url));
const fixtures=JSON.parse(bytes.toString()).cases as {id:string;current:PromptPayload;prior:(Omit<RelatedNoticeCandidate,'publishedAt'>&{publishedAt:string})[];expected:string[];importance?:string}[];
const profiles=[{model:'gpt-5.6-luna',reasoningEffort:'none' as const},{model:'gpt-5.6-sol',reasoningEffort:'low' as const},{model:'gpt-5.6-sol',reasoningEffort:'medium' as const}].filter(p=>!args.includes('--model') || p.model===arg('--model'));
await fs.writeFile(out+'/manifest.json',JSON.stringify({version:HISTORY_VERSION,fixtureSha256:createHash('sha256').update(bytes).digest('hex'),codeSha256:createHash('sha256').update(await fs.readFile(new URL('../services/notice-history.ts',import.meta.url))).digest('hex'),profiles,protocol:'Frozen development cases. No database access or publication. Model timeout 15s to measure beyond production deadline; record whether calls meet 5s.'},null,2));
const client=createOpenAIClient(env.OPENAI_API_KEY); const summaries=[];
for(const profile of profiles) for(const fixture of fixtures){
  const selected=selectHistory(fixture.current,fixture.prior.map(p=>({...p,publishedAt:new Date(p.publishedAt)})));
  const payload={...fixture.current,relatedNotices:selected}; const start=Date.now();
  let actual='no_match',importance:string|undefined,details:unknown,modelCall:unknown;
  if(selected.length) try{
    const result=await callOpenAIForJson(client,{...profile,schemaName:'notice_history_triage',schema:historyAssessmentJsonSchema,
      systemPrompt:HISTORY_PROMPT,developerPrompt:'Return only the evidence-backed structured decision.',userPrompt:buildHistoryPrompt(payload),
      timeoutMs:15000,maxOutputTokens:1600,signal:AbortSignal.timeout(15000),promptCacheKey:'newsweb:history:'+HISTORY_VERSION,promptCacheMode:'implicit',serviceTier:'default'});
    modelCall=result; const validated=validateHistoryAssessment(payload,result.content);details=validated;actual=validated.assessment.decision;importance=validated.assessment.importance;
  }catch(error){actual='error';details=String(error);}
  const durationMs=Date.now()-start;
  const passed=fixture.expected.includes(actual) && (!fixture.importance || (fixture.importance==='not_viktig' ? importance!=='viktig' : importance===fixture.importance));
  const summary={id:fixture.id,...profile,actual,importance,durationMs,within5s:durationMs<=5000,passed,selected:selected.map(s=>s.messageId)};
  summaries.push(summary);console.log(JSON.stringify(summary));
  await fs.writeFile(out+'/'+profile.model+'-'+profile.reasoningEffort+'-'+fixture.id+'.json',JSON.stringify({summary,payload,details,modelCall},null,2));
}
await fs.writeFile(out+'/summary.json',JSON.stringify(summaries,null,2));
