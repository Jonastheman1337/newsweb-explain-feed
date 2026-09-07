# Editorial hybrid candidate — 7 September 2026

Prepared locally as `v5.11.1-hybrid.1` on branch `codex/editorial-hybrid-20260907`, based on `6679aa9`. Production has not been changed by this work.

The successful v5.11 writer is the foundation. The historical system, developer and user builders remain unchanged and available for exact comparisons. The worker keeps its existing generation, checking, revision and publication flow; only its developer-prompt selection and attribution-correction helper are switched in this candidate.

## What stays and what is added

| Area | Prepared behavior |
| --- | --- |
| Voice and storytelling | Keep the journalist role, reader perspective, conversational Norwegian, active verbs, company context, narrative progression and existing examples. |
| News selection | A small developer-prompt variant encourages the defining development over a generic amount-led headline, and allows a decisive closure or outlook change to take precedence over another financial line. |
| Quotations | Keep the normal useful short quote. Replace accounting for every named statement with selection of the best explanation; do not label merely omitted statements as hype. |
| Certainty and attribution | Reuse the larger release's notice-specific correction helper: attribute opinions and causes while preserving the source's certainty. An ordinary change verb in a reported fact no longer automatically demands an invented “kan”. The older helper remains for its existing other callers. |
| PDF source reading | Reuse visual column spacing and heading-based selection, exclude incidental accounting-note mentions, and retain one adjacent management-prose page within the existing narrative-page budget. |
| Reference evidence | Supply original selected page text to the checker, separate from the extracted metric summary. Bound it at 72,000 characters and record truncation. The writer retains its existing context budget. |
| Existing product behavior | Keep the saved-article compatibility fix and the later viewed-version feed fix. Keep the separate remuneration assignment, source boundaries and historical JSON generation schemas. |

The compact v5.12 prompt, mandatory brief, completeness-check pipeline and replacement repair loop are not part of this candidate. More complex financial-table interpretation, multi-attachment selection and PDF fallback changes are deferred; they are not needed to claim the specific source-selection improvement demonstrated here. No model or provider setting, schema, database, publication rule or public article was changed.

## Source-reading evidence

Two stored public PDFs were re-extracted locally with the baseline and candidate. No real notice text or production export was submitted to a model during this work.

| Report | Baseline selected physical pages | Candidate selected physical pages | Material difference |
| --- | --- | --- | --- |
| Carucel, notice 681201 / attachment 332352 | 5, 9, 10 | 3, 4, 5 | The candidate includes the management/results explanation that the prior-year quarter contained a NOK 46 million property-divestment gain; excluding it, EBITDA was broadly unchanged. This explanation was absent from the baseline selection. |
| Haugaland, notice 681267 / attachment 332291 | 7, 10 | 2, 3, 6, 7 | The candidate includes the management explanation of higher achieved electricity prices, absent from the baseline selection. |

Carucel's physical management and income-statement pages were visually inspected against the retained renderings. The geometry test separately exercises column gaps, whitespace items and small baseline offsets. Source selection was checked separately from writing, so these are not claims about newly generated articles from the actual reports.

## Writing comparison and limits

Seven fictional sources: three reused diagnostic scenarios and four fresh cases, frozen before generation. Both writers use the same sources, JSON schema, `gpt-5.6-terra`, medium reasoning and default service tier; returned model and tier matched for every call. The comparison uses first writer drafts and deterministic attribution diagnostics. It does not replay the full worker's repair/publication sequence, score real production articles, or demonstrate a statistically reliable win rate.

Version placement was randomized and hidden while preferences were recorded. The reviewer also authored the candidate, so this is a development review, not independent acceptance. Preferences were saved before the mapping was opened: four candidate preferences, one baseline preference, two ties. Three candidate preferences were slight. The baseline remains strong, and the financing example still favors its concision.

All seven candidate drafts parse under the retained output contract and have no findings from the candidate attribution helper. The baseline's profit-quality draft triggers the older helper on a directly reported result increase; this is a correction diagnostic, not proof of what its final repaired output would be.

The source changes are supported by focused regressions and actual extraction comparison. The modest prompt changes are a reviewable candidate; the owner should judge the article texts below before any release. No further tuning was done after reading these comparisons.

## Validation and reproduction

Prompt-kit: 156 passed. Worker: 637 passed, one existing skip. Worker typecheck passed. All five application workspaces built successfully. The web build needed a network-enabled rerun because the sandbox initially blocked its existing Google Fonts downloads. No font or UI implementation was changed.

Development artifacts are under `tmp/hybrid/` in the candidate worktree: `writer-cases.json`, `writer-protocol.json`, per-case outputs, `writer-results.json`, `paired-review.md`, `review-before-unmasking.json`, `arm-map.json` and `extraction-comparison.json`. `compare-writers.ts` freezes and generates the experiment with overwrite refusal; `check-extraction.ts` compares the stored PDFs locally. The model API key is never stored in the artifacts.

The unchanged historical prompt builders provide the baseline. `packages/prompt-kit/src/editorial-hybrid-prompt.ts` defines the candidate; the worker import aliases activate it locally. A production release needs a separate instruction and final served-output verification.

## Full paired examples

These are untouched model drafts from fictional source notices. Company-description metadata is not shown as article text.

### first-export-contract

**Candidate preferred (slight).** Smoother headline and a clearer description of the scheduling work. Both keep company context and a short useful quote.

**Fictional source**

Planhelse develops software that helps hospitals schedule operations and allocate staff. It has signed a five-year contract with a hospital group in the Netherlands. The contract is worth EUR 12 million and is the company's first outside Norway. Its HelixFlow Pro platform will replace manual scheduling at eight hospitals. Implementation starts in January 2027. CEO Marianne Dahl said: "Today, staff spend hours calling around to fill gaps in the operating schedule. Our system brings the available rooms and staff into one plan." Dahl added that Planhelse was proud and delighted to announce this important milestone.

**Restored v5.11 writer**

Planhelse får nederlandsavtale på 12 millioner euro

Programvareselskapet Planhelse har inngått en femårig avtale verdt 12 millioner euro med en nederlandsk sykehusgruppe. Avtalen er selskapets første utenfor Norge, ifølge børsmeldingen.

Planhelses system skal erstatte manuell planlegging av operasjoner ved åtte sykehus. Innføringen starter i januar 2027.

– Systemet samler tilgjengelige operasjonsrom og ansatte i én plan, sier konsernsjef Marianne Dahl.

**Prepared hybrid**

Planhelse får kontrakt på 12 millioner euro

Programvareselskapet Planhelse har inngått en femårskontrakt verdt 12 millioner euro med en nederlandsk sykehusgruppe. Avtalen er selskapets første utenfor Norge, ifølge børsmeldingen.

Planhelses planleggingssystem skal erstatte manuell vakt- og operasjonsplanlegging ved åtte sykehus. Innføringen starter i januar 2027.

– Systemet samler tilgjengelige operasjonsrom og ansatte i én plan, sier konsernsjef Marianne Dahl.

### factory-closure

**Candidate preferred (clear).** Cleaner opening and avoids A linking lower orders specifically to the 2025 loss, which the source does not expressly say. Both could shorten their quote.

**Fictional source**

Fjordmøbler produserer møbler til hoteller. Selskapet avvikler fabrikken i Hamar ved utgangen av november. Fabrikkens 38 ansatte mister jobben. Produksjonen flyttes til selskapets fabrikk på Gjøvik, som har ledig kapasitet. Det skal ikke ansettes flere der. Bakgrunnen er at hotellkundene har redusert bestillingene det siste året. Fabrikken på Hamar gikk med et driftsunderskudd på 14 millioner kroner i 2025. Konsernsjef Anders Berg sier: «Vi har for få bestillinger til å holde begge fabrikkene i gang. På Gjøvik kan vi produsere det kundene trenger med dagens bemanning.» Selskapet beskriver beslutningen som et viktig skritt i arbeidet med å optimalisere produksjonsstrukturen.

**Restored v5.11 writer**

Fjordmøbler legger ned Hamar-fabrikk

Møbelprodusenten Fjordmøbler avvikler fabrikken i Hamar ved utgangen av november. 38 ansatte mister jobben, etter at lavere hotellbestillinger ga fabrikken et driftsunderskudd på 14 millioner kroner i 2025, opplyser selskapet.

Produksjonen flyttes til fabrikken på Gjøvik, som har ledig kapasitet. Selskapet skal ikke ansette flere der.

– Vi har for få bestillinger til å holde begge fabrikkene i gang. På Gjøvik kan vi produsere det kundene trenger med dagens bemanning, sier konsernsjef Anders Berg.

**Prepared hybrid**

Fjordmøbler legger ned Hamar-fabrikk

Møbelprodusenten Fjordmøbler avvikler fabrikken i Hamar ved utgangen av november. 38 ansatte mister jobben, mens produksjonen flyttes til Gjøvik, opplyser selskapet.

Bakgrunnen er lavere bestillinger fra hotellkundene det siste året. Hamar-fabrikken hadde et driftsunderskudd på 14 millioner kroner i 2025.

– Vi har for få bestillinger til å holde begge fabrikkene i gang. På Gjøvik kan vi produsere det kundene trenger med dagens bemanning, sier konsernsjef Anders Berg.

### short-insider-item

**Candidate preferred (slight).** Retains the useful share price and omits the ordinary trading date. The company clause in its lead is somewhat cumbersome.

**Fictional source**

Finansdirektør Knut Dale har kjøpt 51.000 aksjer i Bryggetek for 14 kroner per aksje, til sammen 714.000 kroner. Etter kjøpet eier han 151.000 aksjer. Bryggetek leverer utstyr til bryggerier. Handelen ble gjennomført 4. september 2026.

**Restored v5.11 writer**

Bryggetek-CFO kjøper aksjer for 714.000

Finansdirektør Knut Dale kjøper 51.000 aksjer i Bryggetek for 714.000 kroner, ifølge en børsmelding.

Etter handelen 4. september eier Dale 151.000 aksjer i selskapet, som leverer utstyr til bryggerier.

**Prepared hybrid**

Bryggetek-CFO kjøper aksjer for 714.000

Finansdirektør Knut Dale har kjøpt 51.000 aksjer i Bryggetek, som leverer utstyr til bryggerier, for 714.000 kroner. Det går frem av en børsmelding.

Kjøpet skjer til 14 kroner per aksje. Etter handelen eier Dale 151.000 aksjer i selskapet.

### profit-quality

**Candidate preferred (slight).** More natural title and a sharper description of the result change. Both explain the one-off gain and weaker operations.

**Fictional source**

Industriselskapet Lindverk rapporterer inntekter på 800 millioner kroner i andre kvartal 2026, mot 850 millioner i andre kvartal 2025. Resultatet før skatt steg fra 20 til 60 millioner kroner. Driftsresultatet falt fra 40 til 35 millioner kroner. Resultatet før skatt inkluderer en gevinst på 50 millioner kroner fra salg av en finansiell eierpost. Konsernsjef Anne Vik sier: «Vi solgte mindre til kundene dette kvartalet. Vi har kuttet overtiden og venter at dette vil redusere kostnadene i høst.» Styrelederen sier at selskapet er fornøyd med gjennomføringen av salget. Neste rapport presenteres 12. november.

**Restored v5.11 writer**

Lindverk løfter resultatet med eierpostsalg

Industriselskapet Lindverk øker resultatet før skatt til 60 millioner kroner i andre kvartal, fra 20 millioner året før. Resultatløftet skyldes en gevinst på 50 millioner kroner fra salg av en finansiell eierpost, ifølge kvartalsrapporten.

• Inntektene falt til 800 millioner kroner, fra 850 millioner i samme kvartal i fjor

• Driftsresultatet falt til 35 millioner kroner, fra 40 millioner

– Vi solgte mindre til kundene dette kvartalet. Vi har kuttet overtiden og venter at dette vil redusere kostnadene i høst, sier konsernsjef Anne Vik.

**Prepared hybrid**

Lindverk løfter resultatet med salg

Industriselskapet Lindverk tredobler resultatet før skatt til 60 millioner kroner i andre kvartal, ifølge kvartalsrapporten. Resultatet løftes av en gevinst på 50 millioner fra salg av en finansiell eierpost.

• Omsetningen faller til 800 millioner kroner, fra 850 millioner i samme kvartal i fjor.

• Driftsresultatet faller til 35 millioner kroner, fra 40 millioner.

– Vi solgte mindre til kundene dette kvartalet. Vi har kuttet overtiden og venter at dette vil redusere kostnadene i høst, sier konsernsjef Anne Vik.

### guidance-over-growth

**Tie (equivalent).** Both prioritize the guidance cut, preserve its cause and use the concrete customer quote. Differences are minor phrasing.

**Fictional source**

Fjellkomponent lager deler til anleggsmaskiner. Inntektene i første halvår 2026 steg til 900 millioner kroner fra 750 millioner i samme periode i 2025. Driftsresultatet var 50 millioner kroner, mot 70 millioner, og resultatet før skatt var 30 millioner kroner, mot 55 millioner. Selskapet kutter anslaget for driftsresultatet i 2026 til 80–100 millioner kroner fra 140–160 millioner. Lavere bestillinger fra de tyske kundene er årsaken til kuttet. Konsernsjef Erik Strand sier: «Flere kunder vil heller reparere maskinene de har enn å bestille nye. Det merker vi nå i ordreboken for høsten.» Det er ikke foreslått utbytte.

**Restored v5.11 writer**

Fjellkomponent kutter resultatanslaget

Fjellkomponent, som lager deler til anleggsmaskiner, kutter anslaget for driftsresultatet i 2026 til 80–100 millioner kroner, fra 140–160 millioner. Lavere bestillinger fra tyske kunder er årsaken, opplyser selskapet.

Første halvår ga inntekter på 900 millioner kroner, opp fra 750 millioner i samme periode i fjor. Driftsresultatet falt likevel til 50 millioner kroner, fra 70 millioner.

Resultatet før skatt gikk ned til 30 millioner kroner, fra 55 millioner.

– Flere kunder vil heller reparere maskinene de har enn å bestille nye. Det merker vi nå i ordreboken for høsten, sier konsernsjef Erik Strand.

**Prepared hybrid**

Fjellkomponent kutter resultatanslaget

Fjellkomponent, som lager deler til anleggsmaskiner, kutter anslaget for årets driftsresultat til 80–100 millioner kroner, fra 140–160 millioner. Lavere bestillinger fra tyske kunder er årsaken, opplyser selskapet.

Inntektene steg til 900 millioner kroner i første halvår, fra 750 millioner i samme periode i fjor. Driftsresultatet falt samtidig til 50 millioner kroner, fra 70 millioner.

Resultatet før skatt ble 30 millioner kroner, ned fra 55 millioner kroner.

– Flere kunder vil heller reparere maskinene de har enn å bestille nye. Det merker vi nå i ordreboken for høsten, sier konsernsjef Erik Strand.

### funding-the-backlog

**Baseline preferred (moderate).** Tighter story, fewer repetitions and a more selective quote. Its sensor description is less informative and it omits the issue price; those are tradeoffs.

**Fictional source**

Rørsyn lager sensorer som oppdager lekkasjer i vannrør. Selskapet har hentet 40 millioner kroner ved å selge åtte millioner nye aksjer til utvalgte investorer for fem kroner per aksje. Pengene skal brukes til maskiner og montører som øker produksjonskapasiteten fra 8.000 til 16.000 sensorer i året. Utvidelsen skal stå ferdig i mars 2027. Administrerende direktør Liv Moe sier: «Kundene står i kø, men vi klarer ikke levere raskt nok med dagens fabrikk. Nå kan vi bygge ut produksjonen.» Selskapet omtaler innhentingen som en viktig milepæl. Styret vil ikke foreslå en reparasjonsemisjon.

**Restored v5.11 writer**

Rørsyn henter 40 millioner

Sensorselskapet Rørsyn henter 40 millioner kroner ved å selge åtte millioner nye aksjer til utvalgte investorer. Pengene skal doble produksjonskapasiteten til 16.000 sensorer i året, ifølge børsmeldingen.

Utvidelsen med nye maskiner og montører skal stå ferdig i mars 2027. Styret vil ikke foreslå en reparasjonsemisjon, som ellers kunne gitt aksjonærer utenfor emisjonen mulighet til å kjøpe aksjer.

– Kundene står i kø, men vi klarer ikke levere raskt nok med dagens fabrikk, sier administrerende direktør Liv Moe.

**Prepared hybrid**

Rørsyn henter 40 millioner kroner

Rørsyn, som lager sensorer som oppdager lekkasjer i vannrør, henter 40 millioner kroner ved å selge åtte millioner nye aksjer til utvalgte investorer. Pengene skal doble produksjonskapasiteten, ifølge børsmeldingen.

De nye aksjene selges for fem kroner stykket. Selskapet skal bruke pengene på maskiner og montører for å øke kapasiteten fra 8.000 til 16.000 sensorer i året innen mars 2027.

– Kundene står i kø, men vi klarer ikke levere raskt nok med dagens fabrikk. Nå kan vi bygge ut produksjonen, sier administrerende direktør Liv Moe.

Styret vil ikke foreslå en reparasjonsemisjon, som ellers kunne gitt aksjonærer som ikke deltok i salget mulighet til å kjøpe nye aksjer.

### closure-in-earnings

**Tie (equivalent).** Both find the closure ahead of modest financial movements and keep a useful quote. No material editorial difference.

**Fictional source**

Nordpak produserer emballasje for næringsmiddelindustrien. Omsetningen i andre kvartal 2026 var 600 millioner kroner, opp fra 580 millioner kroner i andre kvartal 2025. Driftsresultatet var 30 millioner kroner, mot 32 millioner, og resultatet før skatt var 22 millioner kroner, mot 24 millioner. Selskapet stenger fabrikken i Larvik innen utgangen av året. Alle 24 ansatte ved fabrikken mister jobben. Produksjonen skal flyttes til den eksisterende fabrikken i Skien. Konsernsjef Per Holm sier: «Vi har kapasitet til å betjene kundene fra Skien med dagens bemanning. Fabrikken i Larvik har gått med underskudd i tre år.» Selskapet kaller tiltaket en optimalisering av produksjonsstrukturen.

**Restored v5.11 writer**

Nordpak stenger Larvik-fabrikk

Emballasjeprodusenten Nordpak stenger fabrikken i Larvik innen årsslutt. Alle 24 ansatte mister jobben, mens produksjonen flyttes til Skien, opplyser selskapet.

Omsetningen økte til 600 millioner kroner i andre kvartal, fra 580 millioner kroner året før. Samtidig falt driftsresultatet til 30 millioner, fra 32 millioner kroner.

Resultatet før skatt gikk ned til 22 millioner kroner, fra 24 millioner.

– Fabrikken i Larvik har gått med underskudd i tre år, sier konsernsjef Per Holm. Han sier kundene kan betjenes fra Skien med dagens bemanning.

**Prepared hybrid**

Nordpak stenger Larvik-fabrikk

Emballasjeprodusenten Nordpak stenger fabrikken i Larvik innen årsskiftet. Alle de 24 ansatte mister jobben, mens produksjonen flyttes til Skien, opplyser selskapet.

Omsetningen økte til 600 millioner kroner i andre kvartal, fra 580 millioner året før. Samtidig falt driftsresultatet til 30 millioner kroner, fra 32 millioner.

Resultatet før skatt gikk ned til 22 millioner kroner, fra 24 millioner.

– Fabrikken i Larvik har gått med underskudd i tre år, sier konsernsjef Per Holm. Han sier Skien-fabrikken kan betjene kundene med dagens bemanning.

