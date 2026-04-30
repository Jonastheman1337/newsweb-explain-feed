import type { PromptPayload } from "./prompt.js";
import {
  EDITORIAL_ATTRIBUTION,
  EDITORIAL_AUDIENCE,
  EDITORIAL_AVOID,
  EDITORIAL_LANGUAGE,
  EDITORIAL_LENGTH_CAP,
  EDITORIAL_NO_MARKET_COMMENTARY,
  EDITORIAL_NORWEGIAN,
  EDITORIAL_QUOTES,
  EDITORIAL_TITLE,
  EDITORIAL_WRITING_STYLE
} from "./shared-editorial.js";

export function createReportSystemPrompt(): string {
  return [
    "Du er nyhetsjournalist i E24-redaksjonen.",
    "Du skriver korte børsnyheter på norsk bokmål for en travel leser som scanner nyheter på mobilen.",
    "Leseren er en privatinvestor — kanskje en student eller nybegynner — som vil vite: hva skjedde, og hva betyr det for aksjen?",
    "Skriv så enkelt at en videregåendeelev med interesse for finans forstår teksten uten å google noe.",
    "Kilden er et utdrag fra en kvartals- eller halvårsrapport, eventuelt kombinert med en børsmelding.",
    "Du skal lage en kort nyhetssak basert på nøkkeltallene.",
    "Ikke vær en papegøye som bare ramser opp tall. Plukk ut det viktigste, det overraskende eller det dramatiske.",
    "Ikke følg rapportens struktur eller rekkefølge. Du er redaktøren ��� restrukturer fritt etter hva som er viktigst for leseren.",
    "Bruk redaksjonelt skjønn: velg det som er mest nyhetsverdig, ikke følg en rigid formel.",
    "Lead + body til sammen skal være maks 1000 tegn. Vær knapp."
  ].join(" ");
}

const REPORT_STYLE_EXAMPLES = `
Resultat + nyhetsvinkel kombinert (Otovo — emisjon + oppkjøp + resultat):
{"title":"Otovo vil hente inntil 191 millioner","lead":"Solselskapet Otovo kommer med resultat, varsler oppkjøp og et samarbeid etter handelsdagens slutt mandag. I tillegg starter selskapet en rettet emisjon.","body":["Otovo vil hente mellom 15 og 20 millioner dollar, tilsvarende mellom 143 og 191 millioner kroner, i frisk kapital.","Pengene skal blant annet brukes til å kjøpe det amerikanske selskapet Energyaid, i en handel som priser California-selskapet til 10 millioner dollar, tilsvarende 95 millioner kroner.","De øvrige pengene skal brukes til et større OEM-partnerskap, en mulig sekundærnotering i USA og generelle selskapsformål.","Samtidig kommer det frem av kvartalsrapporten at inntektene falt fire prosent til 138,5 millioner kroner i fjerde kvartal.","Resultatet før skatt endte på minus 161 millioner kroner i kvartalet, ned fra minus 71,6 millioner kroner året før."],"company_sentence":"Otovo er et solenergiselskap som installerer solcellepaneler og batterier i Europa.","key_facts":["Henter 143-191 mill. kroner i rettet emisjon","Kjøper amerikanske Energyaid for 95 mill. kroner","Inntekter falt 4 % til 138,5 mill. i Q4","Tap før skatt: 161 mill. kroner i Q4"],"negative_or_surprising":["Resultattapet mer enn doblet fra samme kvartal i fjor"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["rettet emisjon på 15-20 mill. dollar","kjøpe Energyaid for 10 mill. dollar","inntekter falt 4 prosent"]}

Klar nyhetsvinkel fra resultat (BW Offshore — endte på bunn av guiding):
{"title":"BW Offshore endte på bunn av resultatguiding","lead":"BW Offshore, som leverer oljeproduserende skip til offshore-felt, har lagt frem tall som viser at inntektene økte til 127 millioner dollar i fjorårets fjerde kvartal, en oppgang fra 101 millioner dollar på samme tid året før.","body":["Driftsresultatet (ebitda) gikk opp til 48 millioner fra 44 millioner dollar, mens resultat før skatt gikk så vidt ned til 25 millioner fra 26 millioner dollar.","For hele 2025 ble ebitda 240 millioner dollar, mens selskapet i forbindelse med rapporten for tredje kvartal guidet en ebitda for 2025 på 240-250 millioner dollar.","Selskapet venter et ebitda-resultat på 340-370 millioner dollar for helåret 2026."],"company_sentence":"BW Offshore leverer oljeproduserende skip til offshore-felt.","key_facts":["Q4-inntekter: 127 mill. dollar, opp fra 101 mill.","Ebitda 2025: 240 mill. dollar — bunn av guiding (240-250 mill.)","Ebitda-guiding 2026: 340-370 mill. dollar"],"negative_or_surprising":["Endte på bunn av egen resultatguiding"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["inntekter 127 mill. dollar","ebitda 240 millioner","guidet ebitda 240-250 millioner"]}

Nøkkeltall som liste (Jinhui Shipping — i minus, men foreslår utbytte):
{"title":"Jinhui Shipping i minus i fjerde kvartal","lead":"Jinhui Shipping gikk i minus i fjorårets fjerde kvartal, ifølge en melding. Selskapet foreslår et utbytte på 0,18 dollar per aksje for 2025.","body":["Dette er noen nøkkeltall for fjerde kvartal:","• Omsetning på 37,5 millioner dollar, ned fra 44,2 millioner i samme kvartal året før","• Resultat før skatt på minus 2,7 millioner dollar, ned fra pluss 5,2 millioner året før","• Resultat etter skatt også minus 2,7 millioner dollar, ned fra 5,2 millioner","Jinhui melder om en engangseffekt med tap på tre millioner dollar i kvartalet knyttet til at selskapet kvittet seg med tre Supramax-skip. Totalt kvittet selskapet seg med åtte slike skip i fjor, noe som har dempet inntektene.","Ved nyttår drev selskapet 23 fartøy, 18 av dem var selveide. Selskapet har seks Ultramax-skip under bygging som skal leveres i 2028 og 2029."],"company_sentence":"Jinhui Shipping er et shippingselskap som frakter tørrlast.","key_facts":["Underskudd på 2,7 mill. dollar i Q4","Omsetning falt til 37,5 mill. fra 44,2 mill.","Utbytte foreslått: 0,18 dollar per aksje","Engangstap på 3 mill. dollar fra skipsalg"],"negative_or_surprising":["Gikk fra overskudd til underskudd i Q4","Foreslår utbytte til tross for underskudd"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"uviktig","source_spans":["resultat før skatt minus 2,7 mill.","omsetning 37,5 mill.","utbytte 0,18 dollar"]}

Sterk tittel med multiplikator (Subsea 7 — femdobler resultatet):
{"title":"Subsea 7 femdobler resultatet","lead":"Offshore-selskapet Subsea 7 fikk et resultat før skatt på 205,9 millioner dollar i fjerde kvartal, en femdobling fra 40,9 millioner dollar i samme periode året før.","body":["Inntektene endte på 1,96 milliarder dollar, opp fra 1,87 milliarder dollar i fjerde kvartal 2024.","Driftsresultatet ble 276 millioner dollar, mer enn en dobling fra 126 millioner dollar året før.","Styret foreslår et utbytte på 13 kroner per aksje, tilsvarende 400 millioner dollar eller nærmere 4 milliarder kroner.","Utsiktene for 2026 er uendret, med ventede inntekter mellom 7 og 7,4 milliarder dollar.","Subsea 7 meldte ved inngangen til 2025 at selskapet skal fusjonere med italienske Saipem. Det nye selskapet vil hete Saipem7 og noteres i Oslo og Milano."],"company_sentence":"Subsea 7 er et offshore-selskap som leverer undervannsteknologi og -tjenester.","key_facts":["Resultat før skatt femdoblet til 205,9 mill. dollar","Inntekter: 1,96 mrd. dollar","Utbytte: 13 kroner per aksje (ca. 4 mrd. kroner)","Guiding 2026: 7-7,4 mrd. dollar i inntekter"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"viktig","source_spans":["resultat før skatt 205,9 mill.","inntekter 1,96 mrd.","utbytte 13 kroner per aksje"]}

Resultat + oppkjøp kombinert (Odfjell Technology):
{"title":"Lavere inntekter for Odfjell Technology – gjør oppkjøp","lead":"Oljeleverandøren Odfjell Technology leverte sterkere resultat før skatt i fjerde kvartal enn i samme periode året før, men svakere inntekter og bunnlinje.","body":["Dette er noen av tallene for fjerde kvartal:","• Resultat før skatt på 93,4 millioner kroner, opp fra 78,7 millioner i samme kvartal året før","• Resultat etter skatt faller til 65,7 millioner, fra 74,7 millioner i fjerde kvartal året før","• Omsetningen falt til 1,4 milliarder, fra 1,45 milliarder året før","Odfjell Technology melder også om at selskapet skal kjøpe 70 prosent av Kaseum Holding og Razor Oiltools, som driver med intervensjon og plugging av brønner. Selskapet har opsjon på de resterende 30 prosent.","De to selskapene verdsettes til 38,5 millioner pund, tilsvarende 498 millioner kroner.","Kjøpet finansieres med å tappe 600 millioner kroner fra eksisterende lån, kombinert med eksisterende midler. Gjeldsgraden vil fortsatt være moderat, ifølge selskapet."],"company_sentence":"Odfjell Technology leverer teknologi og tjenester til olje- og gassindustrien.","key_facts":["Resultat før skatt opp til 93,4 mill. fra 78,7 mill.","Omsetning ned til 1,4 mrd. fra 1,45 mrd.","Kjøper Kaseum/Razor Oiltools for 498 mill. kroner"],"negative_or_surprising":["Svakere bunnlinje til tross for bedre resultat før skatt"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["resultat før skatt 93,4 mill.","omsetning 1,4 mrd.","kjøpe 70 prosent av Kaseum"]}

Kort og tett resultathopp (Hafnia — produkttank med utbytte):
{"title":"Resultathopp for Hafnia","lead":"Produkttankrederiet har lagt frem en rapport som viser at resultat før skatt var 107 millioner dollar i fjorårets fjerde kvartal, en forbedring fra 80 millioner dollar i samme periode året før.","body":["Driftsresultatet var 110 millioner dollar, opp fra 92 millioner dollar.","Selskapet vil betale et utbytte på 87,7 millioner dollar, eller 0,1762 dollar per aksje.","Det totale utbyttet tilsvarer 837 millioner kroner.","Produkttankmarkedet holdt seg sesongmessig sterkt i fjerde kvartal, noe som gjorde at året kunne avsluttes på en solid måte, melder selskapet."],"company_sentence":"Hafnia er et produkttankrederi.","key_facts":["Resultat før skatt: 107 mill. dollar, opp fra 80 mill.","Driftsresultat: 110 mill. dollar, opp fra 92 mill.","Utbytte: 87,7 mill. dollar (837 mill. kroner)"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["resultat før skatt 107 mill.","driftsresultat 110 mill.","utbytte 87,7 mill."]}

Fra pluss til minus (Awilco LNG — markedskommentar med guillemets):
{"title":"Fra pluss til minus for Awilco","lead":"Gassfraktrederiet Awilco LNG har lagt frem en rapport som viser at resultat før skatt gikk ned til minus 4,4 millioner dollar i fjorårets fjerde kvartal, en forverring fra 1,5 millioner dollar på samme tid året før.","body":["Driftsresultatet (ebitda) var 2,3 millioner dollar, en nedgang fra 8,8 millioner dollar.","Netto fraktinntekter var 6,9 millioner dollar, ned fra 9,3 millioner.","Markedet var uventet sterkt, men rederiet klarte bare å hente ut noe av denne styrken, heter det i kvartalsrapporten.","Det er mange skip i markedet nå, og markedet har svinget mye de siste månedene.","«Overtilbudet er ventet å vare i 2026 og inn i 2027», skriver selskapet."],"company_sentence":"Awilco LNG er et gassfraktrederi.","key_facts":["Resultat før skatt: minus 4,4 mill. dollar, ned fra pluss 1,5 mill.","Ebitda ned til 2,3 mill. fra 8,8 mill. dollar","Fraktinntekter: 6,9 mill. dollar, ned fra 9,3 mill."],"negative_or_surprising":["Gikk fra overskudd til underskudd","Overtilbud ventet å vare inn i 2027"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"uviktig","source_spans":["resultat før skatt minus 4,4 mill.","ebitda 2,3 mill.","overtilbudet ventet å vare"]}

Oppstartsselskap uten inntekter (Andfjord Salmon — biologisk fremgang, men store tap):
{"title":"Andfjord Salmon økte tapene","lead":"Det landbaserte oppdrettsselskapet Andfjord Salmon skriver at veksten i bassengene K0 og K1 ved anlegget på Andøya «har overgått forventningene, inkludert når man tar høyde for høyere vanntemperaturer enn ventet».","body":["Lakseoppdretteren skriver også at overlevelsesraten i begge bassengene er høyere enn ventet. Den var samlet sett på 99,59 prosent i starten av denne uken.","Ifølge selskapet går byggingen av bassengene K2, K3 og K4 etter planen med ny entreprenør på plass.","Andfjord er fortsatt i startfasen, og hadde driftsinntekter på 1,03 millioner i fjerde kvartal. Resultatet var på minus 74 millioner kroner i kvartalet, en kraftig økning i tapene fra 18,1 millioner året før."],"company_sentence":"Andfjord Salmon driver landbasert lakseoppdrett på Andøya.","key_facts":["Tap på 74 mill. kroner i Q4, opp fra 18,1 mill.","Driftsinntekter: 1,03 mill. kroner","Overlevelsesrate: 99,59 %","Tre nye basseng under bygging"],"negative_or_surprising":["Tapene firedoblet fra året før"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"uviktig","source_spans":["minus 74 millioner","driftsinntekter 1,03 millioner","overlevelsesrate 99,59 prosent"]}

Første utbytte som milepæl (IWS — rekordhøyt resultat med CEO-sitat):
{"title":"IWS vil betale utbytte for første gang","lead":"Leverandørselskapet Integrated Wind Solutions (IWS) melder om rekordhøyt resultat etter skatt og vil betale sitt første utbytte.","body":["Selskapet driver seks serviceskip for havvindbransjen, og leverer et resultat før skatt på 6,85 millioner euro i fjorårets fjerde kvartal, opp fra 6,5 millioner euro i samme kvartal året før. Resultat etter skatt var på 7,8 millioner euro, opp fra 5,8 millioner euro i samme periode året før.","Selskapet vil betale tre kroner per aksje i utbytte, hvorav ordinært utbytte utgjør en krone per aksje.","– IWS rapporterer nok et sterkt kvartal med rekordhøyt resultat etter skatt. Utbyttet på tre kroner per aksje er en betydelig milepæl for IWS gjennom å gi kontantutbetalinger til våre støttende aksjonærer, sier IWS-konsernsjef Lars-Henrik Røren i en melding.","Selskapet hadde en ordrebok på 152 millioner euro ved utgangen av fjerde kvartal, opp 50,5 prosent fra kvartalet før."],"company_sentence":"Integrated Wind Solutions (IWS) driver seks serviceskip for havvindbransjen.","key_facts":["Resultat etter skatt: 7,8 mill. euro, opp fra 5,8 mill.","Første utbytte: 3 kroner per aksje","Ordrebok: 152 mill. euro, opp 50,5 % fra Q3"],"negative_or_surprising":[],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["resultat etter skatt 7,8 mill.","tre kroner per aksje","ordrebok 152 mill."]}

Utbytte som vinkel trass svakere resultat (Höegh Autoliners — CEO-sitat med guillemets):
{"title":"Utbyttedryss fra Höegh Autoliners","lead":"Bilfraktrederiet hadde inntekter på 358 millioner dollar i fjorårets fjerde kvartal, en oppgang fra 352 millioner dollar på samme tid året før.","body":["Driftsresultatet (ebitda) var 145 millioner, en nedgang fra 179 millioner. Resultat før skatt gikk ned til 104 millioner fra 138 millioner.","Selskapet vil betale et utbytte på 99 millioner dollar (0,519 dollar per aksje) i mars. Beløpet tilsvarer 944 millioner kroner.","Toppsjef Andreas Enger skryter av at selskapet har levert et nytt sterkt år, til tross for «komplekse og volatile driftsomgivelser»."],"company_sentence":"Höegh Autoliners er et bilfraktrederi.","key_facts":["Inntekter: 358 mill. dollar, opp fra 352 mill.","Ebitda ned til 145 mill. fra 179 mill. dollar","Utbytte: 99 mill. dollar (944 mill. kroner)"],"negative_or_surprising":["Ebitda og resultat falt til tross for inntektsvekst"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["inntekter 358 mill.","ebitda 145 mill.","utbytte 99 mill."]}

Porteføljevekst men kraftig resultatfall (Magnora — fornybar uten Q4-tall):
{"title":"Magnora-porteføljen vokser","lead":"Fornybarselskapet Magnora, som utvikler og selger kraftanlegg, har lagt frem resultater.","body":["Magnora kommer samtidig med en oppdatering om fremdriften for salgsprosesser, og status for datasenter-satsingen deres.","Prosjektporteføljen var totalt på 9,9 gigawatt ved utgangen av året, opp fra 6,3 gigawatt for et år siden og 8,3 gigawatt etter tredje kvartal. Siden årsskiftet har den økt videre til 10,4 gigawatt.","Selskapet har ikke lagt frem resultater for fjerde kvartal spesifikt.","I 2025 som helhet falt overskuddet kraftig. Resultatet før skatt endte på 12,2 millioner kroner, ned fra 269,2 millioner kroner i 2024.","Magnora skriver at de har gått videre med diskusjoner om salg av prosjekter med kapasitet på 500-800 megawatt. Dette har ifølge selskapet ført til forhandlinger om salg av ytterligere prosjekter."],"company_sentence":"Magnora er et fornybarselskap som utvikler og selger kraftanlegg.","key_facts":["Portefølje: 10,4 GW, opp fra 6,3 GW","Resultat før skatt 2025: 12,2 mill., ned fra 269,2 mill.","Forhandler om salg av 500-800 MW"],"negative_or_surprising":["Overskuddet falt fra 269 mill. til 12 mill. kroner"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["portefølje 9,9 gigawatt","resultat 12,2 mill.","salg 500-800 megawatt"]}

Giga-handel driver inntektsvekst (PPI — eiendomsoppkjøp fra SBB):
{"title":"Kraftig inntektshopp etter giga-handel","lead":"Eiendomsselskapet Public Property Invest (PPI) har lagt frem en rapport som viser at inntektene økte til 392 millioner kroner i fjorårets fjerde kvartal, fra 180 millioner kroner på samme tid året før.","body":["Driftsresultatet var 332 millioner kroner, opp fra 161 millioner kroner.","Resultatet før skatt gikk ned til 89 millioner fra 246 millioner kroner.","I løpet av fjerde kvartal kjøpte PPI en eiendomsportefølje for 38 milliarder kroner fra svenske SBB.","PPI skal flytte til Sverige og skal i hovedsak være børsnotert i Stockholm, en endring som er ventet å være i boks før juli.","Selskapet eide 850 eiendommer ved årsskiftet. Disse hadde en total markedsverdi på rundt 54 milliarder kroner."],"company_sentence":"Public Property Invest (PPI) er et eiendomsselskap.","key_facts":["Inntekter: 392 mill., opp fra 180 mill. kroner","Kjøpte eiendom for 38 mrd. fra SBB","850 eiendommer verdt 54 mrd. kroner","Flytter hovednotering til Stockholm"],"negative_or_surprising":["Resultat før skatt falt fra 246 mill. til 89 mill. trass inntektsvekst"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["inntekter 392 mill.","38 milliarder fra SBB","850 eiendommer"]}

Engangseffekt forklarer resultatsnudd (Kongsberg Automotive):
{"title":"Lavere inntekter for Kongsberg Automotive","lead":"Bildelprodusenten har lagt frem en rapport som viser at inntektene falt til 168 millioner euro i fjorårets fjerde kvartal, fra 185 millioner euro på samme tid året før.","body":["Driftsresultatet (ebitda) steg på sin side, til 17 millioner fra 10 millioner euro.","Resultatet før skatt snudde til pluss 5 millioner euro, fra minus 6 millioner euro.","Toppsjef Trond Fiskum peker på et krevende marked og opplyser at resultatene inkluderer en positiv engangseffekt på 4,9 millioner euro knyttet til en gjennomgang av periodiseringer ved årsslutt."],"company_sentence":"Kongsberg Automotive er en bildelprodusent.","key_facts":["Inntekter: 168 mill. euro, ned fra 185 mill.","Ebitda opp til 17 mill. fra 10 mill. euro","Resultat før skatt snudde til pluss 5 mill. fra minus 6 mill.","Engangseffekt: 4,9 mill. euro"],"negative_or_surprising":["Inntektsfall på 9 % i krevende marked","Engangseffekt forklarer mye av resultatforbedringen"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"uviktig","source_spans":["inntekter 168 mill.","ebitda 17 mill.","engangseffekt 4,9 mill."]}

Oppdrett med utdelingsplan (Grieg Seafood — storsalg til Cermaq):
{"title":"Grieg-resultatet steg","lead":"Oppdrettsselskapet Grieg Seafood hadde et operasjonelt driftsresultat («operational ebit») på 143 millioner kroner i fjorårets fjerde kvartal, en oppgang fra 97 millioner kroner på samme tid året før.","body":["Inntektene steg til 971 millioner kroner, fra 853 millioner, mens resultat før skatt gikk opp til 271 fra 147 millioner.","Kvartalet var preget av biologiske utfordringer fra kvartalet før og overgangseffekter, heter det i kvartalsrapporten.","Styret har fattet en prinsipiell beslutning om å dele ut fire milliarder kroner, og den formelle beslutningen vil bli tatt senere.","Selskapet har tatt grep for å kutte kostnader og vil spare 50 millioner kroner etter storsalg av deler av virksomheten. 29. desember 2025 fullførte Grieg salget av virksomheten i blant annet Finnmark til Cermaq."],"company_sentence":"Grieg Seafood er et oppdrettsselskap.","key_facts":["Operasjonelt driftsresultat: 143 mill., opp fra 97 mill.","Inntekter: 971 mill., opp fra 853 mill.","Resultat før skatt: 271 mill., opp fra 147 mill.","Planlagt utdeling: 4 mrd. kroner","Solgte virksomhet til Cermaq"],"negative_or_surprising":["Biologiske utfordringer preget kvartalet"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["operasjonelt driftsresultat 143 mill.","inntekter 971 mill.","fire milliarder kroner"]}

Emisjon + resultat (Huddly — henter penger, ledelsen tegner seg):
{"title":"Huddly vil hente opptil 75 millioner kroner","lead":"Teknologiselskapet Huddly kunngjør en rettet emisjon på mellom 55 og 75 millioner kroner til en kurs på 20 kroner per aksje, ifølge en børsmelding.","body":["Pengene fra emisjonen skal brukes til å nedbetale 30,75 millioner kroner av et lån fra nåværende og tidligere aksjonærer, samt dekke underskudd frem til selskapet oppnår positiv kontantstrøm, etter planen i andre halvår.","Ledelse og styre har indikert at de vil tegne seg for til sammen 26,5 millioner kroner i emisjonen. Styreleder Jon Øyvind Eriksen har indikert 10 millioner kroner, mens styremedlem Kristian Kolberg har indikert 15 millioner kroner.","Selskapet rapporterte samtidig inntekter på 64 millioner kroner i fjerde kvartal 2025, opp 26 prosent fra samme periode året før."],"company_sentence":"Huddly er et teknologiselskap.","key_facts":["Rettet emisjon: 55-75 mill. kroner til 20 kr/aksje","Nedbetaler lån på 30,75 mill.","Ledelse tegner seg for 26,5 mill.","Q4-inntekter: 64 mill., opp 26 %"],"negative_or_surprising":["Går med underskudd, venter positiv kontantstrøm i H2"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["emisjon 55-75 mill.","nedbetale 30,75 mill.","inntekter 64 mill."]}

Resultatfall men bedre enn ventet + guiding (MPC Container Ships):
{"title":"Resultatfall for MPC Container Ships","lead":"Rederiet har lagt frem en rapport som viser et driftsresultat (ebitda) på 76 millioner dollar i fjorårets fjerde kvartal, en nedgang fra 83 millioner på samme tid året før.","body":["Resultat før skatt ble 46 millioner dollar, ned fra 62 millioner dollar.","Resultatene var likevel noe bedre enn analytikerne hadde ventet, ifølge Bloomberg.","Inntektene falt også, til 127 millioner fra 130 millioner dollar.","MPCC-aksjen stiger rundt 3,5 prosent i tidlig handel på Oslo Børs etter tallslippet.","Selskapet skal i mars betale utbytte 17. gang på rad. Utbyttet er på 0,05 dollar for kvartalet, tilsvarende halvparten av overskuddet.","For 2026 venter MPC inntekter på 450-460 millioner dollar og ebitda på 240-260 millioner dollar. Begge deler er høyere enn analytikernes anslag samlet inn av Bloomberg."],"company_sentence":"MPC Container Ships er et containerrederi.","key_facts":["Ebitda: 76 mill. dollar, ned fra 83 mill.","Resultat før skatt: 46 mill., ned fra 62 mill.","Utbytte: 0,05 dollar (17. gang på rad)","Guiding 2026: inntekter 450-460 mill., ebitda 240-260 mill."],"negative_or_surprising":["Resultatfall, men bedre enn analytikernes forventninger","Guiding over konsensus"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"medium","source_spans":["ebitda 76 mill.","resultat før skatt 46 mill.","guiding 450-460 mill."]}

Snudd til overskudd (Salmon Evolution — i pluss trass inntektsfall):
{"title":"Salmon Evolution i pluss i fjerde kvartal","lead":"Salmon Evolution fikk et resultat før skatt på 1,14 millioner kroner i fjerde kvartal, fra minus 26,9 millioner i samme kvartal året før, ifølge en melding.","body":["Omsetningen ble på 98,7 millioner kroner, ned fra 148,7 millioner i samme periode året før.","De realiserte prisene var på 74 kroner kiloet, ned ti prosent fra perioden året før, skriver Salmon Evolution.","Selskapet leverte en slaktevekt på 1.203 tonn i kvartalet.","Salmon Evolution melder om at arbeidet med fase to av Indre Harøy-anlegget går etter planen."],"company_sentence":"Salmon Evolution driver landbasert lakseoppdrett.","key_facts":["Resultat før skatt: 1,14 mill., opp fra minus 26,9 mill.","Omsetning: 98,7 mill., ned fra 148,7 mill.","Realisert pris: 74 kr/kg, ned 10 %","Slaktevekt: 1.203 tonn"],"negative_or_surprising":["Snudde til overskudd trass kraftig inntektsfall","Lakseprisene falt 10 %"],"excluded_hype":[],"source_limitations":["Kun et utdrag av rapporten er analysert"],"confidence":"high","importance":"uviktig","source_spans":["resultat 1,14 mill.","omsetning 98,7 mill.","74 kroner kiloet"]}
`.trim();

export function createReportDeveloperPrompt(schemaJson: string): string {
  return `OPPGAVE
Lag en kort nyhetssak i E24-stil basert på utdraget fra en kvartals-/halvårsrapport.
Leseren er en privatinvestor som kanskje gar pa videregaende og er interessert i finans. Vanlige finansord som 'driftsresultat', 'ebitda' og 'omsetning' er greit, men tyngre jargong ma forklares gjennom kontekst.

${EDITORIAL_AUDIENCE}
- Vi er ikke papegøyer som bare ramser opp tall. Vi finner nyhetshistorien i tallene.

HVILKE TALL ER VIKTIGE?
Bruk redaksjonelt skjonn — plukk ut det som er mest nyhetsverdig:
- Resultat for skatt — ofte overskriften, men ikke alltid
- Inntekter (total omsetning)
- Driftsresultat (operating profit) / ebitda
- Utbytte — hvis et totalbelop er oppgitt, er det ofte svaert nyhetsverdig
- Endring fra samme kvartal i fjor (YoY) der det er tilgjengelig
- Guidanse/utsikter og eventuelle prognoser
- Strategiske nyheter, oppkjop eller store hendelser nevnt i rapporten

Vaer fleksibel: Et selskap kan ha enorm omsetningsvekst men nesten null i resultat — det er interessant og saken bor reflektere det. Ikke led mekanisk med resultat for skatt hvis et annet tall forteller den egentlige historien.

For energi-/oljeselskaper er justert driftsresultat typisk nokkeltallet markedet folger. La deg tilpasse til det rapporten selv vektlegger.

Hvis resultatet lander i bunn eller topp av tidligere guiding, er det en nyhetsvinkel i seg selv (f.eks. 'endte pa bunn av resultatguiding').

Hvis resultatet er mangedoblet eller har en slagkraftig multiplikator (f.eks. 'femdobler resultatet'), bruk det i tittelen.

Nar bade en borsmelding og en rapport er tilgjengelig, kombiner dem. Meldingen kan ha nyheter (emisjon, oppkjop, samarbeid) som rapporten ikke dekker. Bruk begge kildene for a finne den sterkeste nyhetsvinkelen.

TALL-DISIPLIN
- Plukk ut 3-4 nokkeltall. Ikke rams opp alt rapporten inneholder.
- De viktigste tallene for en aksjeeier er typisk: inntekter, resultat for skatt, ebitda og utbytte.
- Unnga nisjetall som bruttofortjeneste, 'adjusted operating profit' og andre mellomlinjer med mindre de er selskapets eget nokkeltall.
- Helårstall kan nevnes kort, men hold fokus på kvartalet.
- Balansetall (gjeld, kontanter, egenkapital) bare nar de er nyheten (f.eks. likviditetskrise).

${EDITORIAL_LANGUAGE}

STRUKTUR
${EDITORIAL_TITLE}
- body: 2-5 avsnitt med nokkeltall, sammenligninger og eventuelle utsikter. Hold det kort:
  De fleste rapporter klarer seg med 2-3 avsnitt. Bruk flere bare hvis det virkelig trengs.
  Punktliste med nokkeltall (med '•') er ofte effektivt. Kombiner gjerne liste med lopende tekst.
  Nar du bruker punktliste, ta med fjorarstallet med retning: '• Omsetning pa 37,5 millioner dollar, ned fra 44,2 millioner i samme kvartal aret for'
  Hvert punktlisteelement er et eget element i body-arrayen — IKKE en lang streng med alle punkter.
  Maks 3-4 kulepunkter. Velg de viktigste tallene, ikke rams opp alt.
  Gode titler: 'Subsea 7 femdobler resultatet', 'BW Offshore endte pa bunn av resultatguiding', 'Otovo vil hente inntil 191 millioner', 'Jinhui Shipping i minus i fjerde kvartal'.
  Nar bade resultat og en annen nyhet (oppkjop, emisjon) presenteres samtidig, kan tittelen bruke tankestrek: 'Lavere inntekter for Odfjell Technology – gjor oppkjop'.
- importance: 'viktig' kun ved store overraskelser eller klare kursdrivere. 'medium' for solide rapporter. 'uviktig' for rutine uten overraskelser.

${EDITORIAL_WRITING_STYLE}

${EDITORIAL_NO_MARKET_COMMENTARY}

${EDITORIAL_ATTRIBUTION}

${EDITORIAL_QUOTES}

${EDITORIAL_LENGTH_CAP}

${EDITORIAL_AVOID}
- Spekulasjon om kursutvikling eller investeringslogikk.
- Meta-kommentarer om rapporten som kilde.

source_limitations SKAL inkludere: 'Kun et utdrag av rapporten er analysert'

EKSEMPLER PA GOD E24-OUTPUT FOR KVARTALSRAPPORTER
${REPORT_STYLE_EXAMPLES}

Sprak: norsk Bokmal. Tone: noytral, enkel, lett a forsta for en privatinvestor uten profesjonell finansbakgrunn.
Bruk kun tall og fakta som finnes i kilden.

${EDITORIAL_NORWEGIAN}

JSON schema:
${schemaJson}`;
}

export type ReportPromptPayload = PromptPayload & {
  reportText: string;
  reportPageCount: number;
};

export function createReportUserPrompt(payload: ReportPromptPayload): string {
  const metadata = [
    `messageId: ${payload.messageId}`,
    `title: ${payload.title}`,
    `issuerName: ${payload.issuerName}`,
    `issuerSign: ${payload.issuerSign}`,
    `publishedAt: ${payload.publishedAt}`,
    `categories: ${payload.categories.join(", ") || "ikke oppgitt"}`,
    `markets: ${payload.markets.join(", ") || "ikke oppgitt"}`,
    `reportPageCount: ${payload.reportPageCount}`
  ].join("\n");

  const parts: string[] = [
    "Lag en kort, publiserbar nyhetssak basert på kildene under.",
    "Skriv nyhetstekst, ikke sammendrag. Plukk ut de viktigste nøkkeltallene for en aksjeeier.",
    "Skriv så enkelt at en videregåendeelev med interesse for finans forstår det.",
    "Bruk aktiv form, presens og omvendt nyhetspyramide.",
    "Bruk kun data i kildene under. Ikke bruk markdown.",
    "",
    "Metadata:",
    metadata
  ];

  // Include the notice body text if it's substantive (not just a stub like "See attached PDF")
  if (payload.bodyText && payload.bodyText.trim().length >= 100) {
    parts.push(
      "",
      "KILDE 1 (BØRSMELDING):",
      "<<<",
      payload.bodyText,
      ">>>"
    );
    parts.push(
      "",
      "KILDE 2 (UTDRAG FRA RAPPORT):",
      "<<<",
      payload.reportText || "ikke oppgitt",
      ">>>"
    );
  } else {
    parts.push(
      "",
      "KILDE (UTDRAG FRA RAPPORT):",
      "<<<",
      payload.reportText || "ikke oppgitt",
      ">>>"
    );
  }

  return parts.join("\n");
}
