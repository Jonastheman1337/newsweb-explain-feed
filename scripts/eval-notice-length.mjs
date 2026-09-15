// Synthetic, read-only model evaluation. Run after npm run build.
// node scripts/eval-notice-length.mjs <env-file> <output-file>
import fs from "node:fs/promises";
import { config } from "dotenv";
import { createOpenAIClient, callOpenAIForJson } from "@newsweb/shared/openai-responses";
import { rewriteOutputJsonSchema, rewriteOutputSchema, noticeArticleChars } from "@newsweb/shared";
import { createSystemPrompt, createHybridDeveloperPrompt, createUserPrompt, createRevisionUserPrompt } from "@newsweb/prompt-kit";
import { noticeRevisionInstruction, repairNoticeLength } from "../apps/worker/dist/services/notice-length.js";
import { buildReferenceCheckPrompt, referenceCheckJsonSchema, referenceCheckResultSchema, buildCoverageReport, assessReferenceCheckGate } from "../apps/worker/dist/services/reference-check.js";
import { validateRewriteOutput } from "../apps/worker/dist/services/rewrite-validation.js";
if (!process.argv[2] || !process.argv[3]) throw Error("Supply env file and output file");
config({path: process.argv[2]});
const client = createOpenAIClient(process.env.OPENAI_API_KEY);
const model = "gpt-5.6-sol", reasoningEffort = "medium";
const source = [
  "Fjordverk ASA har inngått en bindende kontrakt med Nordhavn Energi om levering av pumpesystemer til tre anlegg i Norge. Kontrakten er verdt 240 millioner kroner. Leveransene starter i januar 2027 og skal være fullført i desember 2028.",
  "Avtalen omfatter konstruksjon, produksjon, installasjon og testing av tolv pumpesystemer. Fjordverk skal også lære opp kundens driftspersonell og levere reservedeler de første to årene. Service etter denne perioden er ikke inkludert i kontraktsverdien.",
  "Produksjonen skal skje ved Fjordverks fabrikk i Ålesund. Selskapet vil ansette 18 operatører og seks ingeniører. Rekrutteringen starter i oktober 2026. Fabrikken har i dag 126 ansatte. De nye stillingene er faste.",
  "Fjordverk investerer 35 millioner kroner i nytt testutstyr og en produksjonslinje ved fabrikken. Investeringen finansieres med eksisterende kontantbeholdning. Bygget skal ikke utvides, og produksjonen skal fortsette mens utstyret installeres.",
  "Nordhavn Energi betaler 20 prosent ved signering, 50 prosent etter godkjente fabrikktester og resten ved ferdig installasjon. Kontrakten har ingen opsjoner, og verdien kan ikke økes uten en ny avtale. Prisen er fast, men justeres dersom myndighetene innfører nye avgifter som direkte gjelder leveransene.",
  "Fjordverk opplyser at avtalen øker ordreboken fra 610 til 850 millioner kroner. Ved utgangen av samme måned året før var ordreboken 580 millioner kroner. Tallene gjelder signerte kontrakter og inkluderer ikke tilbud som ennå er til vurdering.",
  "Administrerende direktør Anne Berg sier: Vi har ledig kapasitet i Ålesund og kan gjennomføre oppdraget uten å flytte andre leveranser. Hun opplyser at kunden valgte Fjordverk etter en anbudskonkurranse som pågikk fra februar til august.",
  "Systemene skal erstatte eldre utstyr som kunden tar ut av drift. Kunden har ikke oppgitt hvor mye strøm de nye systemene vil spare. Fjordverk gir ingen resultatprognose for kontrakten og oppgir ikke forventet margin. Selskapet har ansvaret for forsinkelser som skyldes egen produksjon, men ikke forsinkelser på kundens byggeplasser.",
  "Fjordverk leverer industrielle pumpesystemer og vedlikeholdstjenester. Selskapet omsatte for 920 millioner kroner i 2025. Avtalen med Nordhavn Energi er selskapets største enkeltkontrakt hittil i 2026, ifølge børsmeldingen."
].join("\n\n");
const payload = {messageId: 999999, title: "Fjordverk inngår kontrakt på 240 millioner kroner", issuerName: "Fjordverk ASA", issuerSign: "FJORD", publishedAt: "2026-09-15T10:00:00Z", categories: ["Innsideinformasjon"], markets: ["Oslo Børs"], bodyText: source, sourceBodyChars: source.length, hasAttachments: false};
async function write(p, previous, instruction) {
  const result = await callOpenAIForJson(client, {schemaName:"rewrite_output",schema:rewriteOutputJsonSchema,systemPrompt:createSystemPrompt(),developerPrompt:createHybridDeveloperPrompt(undefined,p),userPrompt:previous?createRevisionUserPrompt(p,previous,instruction):[createUserPrompt(p),instruction].filter(Boolean).join("\n\n"),model,reasoningEffort,timeoutMs:240000,maxOutputTokens:6500});
  return rewriteOutputSchema.parse(JSON.parse(result.content));
}
async function verify(p, draft) {
  const prompt=buildReferenceCheckPrompt(p,draft);
  const result=await callOpenAIForJson(client,{schemaName:"reference_check_result",schema:referenceCheckJsonSchema,systemPrompt:prompt.systemPrompt,developerPrompt:prompt.developerPrompt,userPrompt:prompt.userPrompt,model,reasoningEffort,timeoutMs:240000,maxOutputTokens:6500});
  const parsed=referenceCheckResultSchema.parse(JSON.parse(result.content));
  const coverage=buildCoverageReport(prompt.draftSentences,parsed,{visibleArticleSentenceCount:prompt.visibleDraftSentences.length,headSentenceCount:prompt.headDraftSentenceCount,priorContext:prompt.priorContext});
  const gate=assessReferenceCheckGate(coverage);
  if(gate.blocking) throw Error("Synthetic evaluation failed source check: "+JSON.stringify(gate));
  return draft;
}
async function run(p,target,previous) {
  const started=Date.now(), manual={...p,targetVisibleArticleChars:target};
  const draft=await write(manual,previous,noticeRevisionInstruction(manual));
  const result=await repairNoticeLength({rewrite:draft,target,correct:(current,instruction)=>write(manual,current,instruction),verify:current=>verify(manual,current)});
  if(!result.audit.applied) await verify(manual,result.rewrite);
  const validation=validateRewriteOutput(result.rewrite,manual);
  if(validation.blockingErrors.length) throw Error(JSON.stringify(validation.blockingErrors));
  console.log(JSON.stringify({target,chars:noticeArticleChars(result.rewrite),outcome:result.audit.outcome,repair:result.audit.applied,elapsedMs:Date.now()-started}));
  return {...result,elapsedMs:Date.now()-started};
}
const middle=await run(payload,1000);
const [short,long]=await Promise.all([run(payload,500,middle.rewrite),run(payload,1500,middle.rewrite)]);
const sparseText="Fjordverk ASA opplyser at ordinær generalforsamling avholdes 20. mai 2027 i Ålesund. Innkallingen publiseres senere.";
const sparse=await run({...payload,title:"Dato for generalforsamling",bodyText:sparseText,sourceBodyChars:sparseText.length},1500);
const report={model,reasoningEffort,source,results:[short,middle,long],sparse};
await fs.writeFile(process.argv[3],JSON.stringify(report,null,2));
if([short,middle,long].some(r=>r.audit.outcome!=="within_target")) throw Error("Rich-source targets were not met");
if(sparse.audit.outcome!=="shorter") throw Error("Sparse source should remain short");
console.log("PASS: 500/1000/1500 targets and sparse-source fallback, with fresh source checks.");
