import {
  PROMPT_VERSION,
  createDeveloperPrompt,
  createSystemPrompt,
  createUserPrompt,
  type PromptPayload
} from "./prompt.js";
import {
  createDeveloperPromptV6,
  createSystemPromptV6,
  createUserPromptV6
} from "./prompt-v6.js";
import { EDITORIAL_AUDIENCE } from "./shared-editorial.js";

export const regularPromptVariantIds = [
  "regular_v5_6_control",
  "audience_mechanism_v1",
  "regular_v6_full"
] as const;

export type RegularPromptVariantId = (typeof regularPromptVariantIds)[number];

export type RegularPromptMessages = {
  variantId: RegularPromptVariantId;
  promptVersion: string;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
};

const AUDIENCE_MECHANISM_AUDIENCE = `HVEM SKRIVER VI FOR?
- Finansielt interesserte lesere i en nyhetssetting, ikke et investeringsnotat.
- De vil raskt forsta hva selskapet har meldt, hvilken mekanisme som er viktig, og hvilke folger som star direkte i meldingen.
- Vi vurderer ikke aksjen og gir ikke kurslogikk. Vi gjor meldingen lettere a forsta.
- Mye i en borsmelding eller kvartalsrapport er stoy. Kutt det som ikke hjelper leseren a forsta hendelsen.`;

const MECHANISM_FIRST_RULE = [
  "MEKANISMEFORKLARING",
  "- Forklar hva begrepet gjor i akkurat denne meldingen, ikke gi en leksikondefinisjon.",
  "- Forklar hvorfor strukturen er med, hva den endrer, og hvordan den fungerer innenfor fakta i kilden.",
  "- Ikke gjor forklaringen mer analytisk, spekulativ eller radgivende."
].join("\n");

function appendMechanismRuleIfMissing(prompt: string): string {
  return prompt.includes("MEKANISMEFORKLARING")
    ? prompt
    : [prompt, MECHANISM_FIRST_RULE].join("\n\n");
}

function removeStockAdviceTension(prompt: string): string {
  return prompt
    .replaceAll("uten at vi vurderer aksjen, spår kursreaksjon eller gir investeringsråd", "uten å skrive investeringsråd")
    .replaceAll("for selskapet og aksjonærene", "for selskapet")
    .replaceAll("selskapet og aksjonærene", "selskapet")
    .replaceAll("aksjonærene", "leserne")
    .replaceAll("aksjonær", "leser")
    .replaceAll("kursreaksjon", "markedsreaksjon");
}

function createAudienceMechanismSystemPrompt(): string {
  return appendMechanismRuleIfMissing(
    removeStockAdviceTension(createSystemPrompt())
      .replace(
        "Skriv sa enkelt at en videregaendeelev med interesse for finans forstar teksten uten a google noe.",
        "Skriv klart for en travel, finansielt interessert leser uten a skrive ned til leseren."
      )
  );
}

function createAudienceMechanismDeveloperPrompt(): string {
  return appendMechanismRuleIfMissing(
    removeStockAdviceTension(
      createDeveloperPrompt().replace(
        EDITORIAL_AUDIENCE,
        AUDIENCE_MECHANISM_AUDIENCE
      )
    )
      .replace(
        "Leseren vil vite hva som er mest vesentlig for selskapet, uten å skrive investeringsråd.",
        "Leseren er finansielt interessert og leser dette som nyheter, ikke som investeringsrad."
      )
      .replace(
        "Velg nyhetspoenget som er mest vesentlig for en leser å forstå, uten å antyde kursretning. Hvis en negativ opplysning er det viktigste å forstå, skal tittelen vinkles pa det negative.",
        "Velg nyhetspoenget som best forklarer hva som faktisk har skjedd. Hvis en negativ opplysning er det viktigste for forstaelsen, skal tittelen vinkles pa det negative."
      )
  );
}

function createAudienceMechanismUserPrompt(payload: PromptPayload): string {
  return removeStockAdviceTension(createUserPrompt(payload))
    .replace(
      "Skriv nyhetstekst, ikke sammendrag. Plukk ut det som er mest vesentlig for selskapet.",
      "Skriv nyhetstekst, ikke sammendrag. Plukk ut det som hjelper leseren a forsta hva selskapet har meldt og hvilken mekanisme som betyr noe."
    )
    .replace(
      "Skriv sa enkelt at en videregaendeelev med interesse for finans forstar det. Unnga tung jargong",
      "Skriv klart for en travel, finansielt interessert leser. Unnga tung jargong"
    );
}

export function createRegularPromptVariantMessages(
  variantId: RegularPromptVariantId,
  payload: PromptPayload
): RegularPromptMessages {
  if (variantId === "regular_v5_6_control") {
    return {
      variantId,
      promptVersion: `${PROMPT_VERSION}:regular_v5_6_control`,
      systemPrompt: createSystemPrompt(),
      developerPrompt: createDeveloperPrompt(),
      userPrompt: createUserPrompt(payload)
    };
  }

  if (variantId === "regular_v6_full") {
    return {
      variantId,
      promptVersion: `${PROMPT_VERSION}:regular_v6_full`,
      systemPrompt: createSystemPromptV6(),
      developerPrompt: createDeveloperPromptV6(),
      userPrompt: createUserPromptV6(payload)
    };
  }

  return {
    variantId,
    promptVersion: `${PROMPT_VERSION}:audience_mechanism_v1`,
    systemPrompt: createAudienceMechanismSystemPrompt(),
    developerPrompt: createAudienceMechanismDeveloperPrompt(),
    userPrompt: createAudienceMechanismUserPrompt(payload)
  };
}

export function isRegularPromptVariantId(
  value: string
): value is RegularPromptVariantId {
  return regularPromptVariantIds.includes(value as RegularPromptVariantId);
}
