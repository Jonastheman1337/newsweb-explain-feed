import type { RewriteOutput } from "@newsweb/shared";
import {
  isAmbiguousBareRemovalInstruction,
  parseRevisionInstruction,
  type RevisionInstructionPlan
} from "./revision-instructions.js";

export type EditorialRevisionReview = {
  compliant: boolean;
  findings: string[];
  repairInstruction: string;
};

export const editorialRevisionReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    compliant: { type: "boolean" },
    findings: {
      type: "array",
      items: { type: "string" },
      maxItems: 8
    },
    repairInstruction: { type: "string" }
  },
  required: ["compliant", "findings", "repairInstruction"]
} as const;

export const EDITORIAL_REVIEW_SYSTEM_PROMPT =
  "Du er en streng norsk redaktør som kvalitetssikrer manuelle revisjoner av korte finansnyheter.";

export const EDITORIAL_REVIEW_DEVELOPER_PROMPT = [
  "Vurder bare om revisjonen følger brukerens instruksjon og etablerte redaksjonelle regler.",
  "Ikke skriv en ny sak.",
  "Hvis revisjonen er god nok, sett compliant=true og repairInstruction til tom streng.",
  "Hvis den må repareres, sett compliant=false og skriv én smal reparasjonsinstruksjon.",
  "Ved smale fjern/kutt-instruksjoner: krev at bare den angitte teksten fjernes, og at resten av saken i hovedsak beholdes.",
  "Krev at beløp på 1.000 millioner eller mer skrives som milliarder.",
  "Krev at synlig title/lead/body ikke omtaler PDF, vedlegg, rapportkontekst, analysert materiale eller manglende kildegrunnlag."
].join("\n");

function formatRewriteForReview(rewrite: RewriteOutput): string {
  return JSON.stringify(
    {
      title: rewrite.title,
      lead: rewrite.lead,
      body: rewrite.body,
      company_sentence: rewrite.company_sentence,
      key_facts: rewrite.key_facts,
      source_limitations: rewrite.source_limitations,
      importance: rewrite.importance
    },
    null,
    2
  );
}

export function shouldRunEditorialRevisionReview({
  instruction,
  previousOutput
}: {
  instruction?: string | null;
  previousOutput?: RewriteOutput;
}): boolean {
  if (!instruction?.trim() || !previousOutput) {
    return false;
  }
  if (isAmbiguousBareRemovalInstruction(instruction)) {
    return false;
  }
  return parseRevisionInstruction(instruction).intents.length > 0;
}

export function buildEditorialRevisionReviewUserPrompt({
  instruction,
  previousOutput,
  draftRewrite,
  plan = parseRevisionInstruction(instruction)
}: {
  instruction: string;
  previousOutput: RewriteOutput;
  draftRewrite: RewriteOutput;
  plan?: RevisionInstructionPlan;
}): string {
  return [
    "Vurder om DRAFT følger INSTRUKSJONEN som revisjon av FORRIGE VERSJON.",
    "Returner bare JSON etter skjemaet.",
    "",
    "INSTRUKSJON:",
    instruction,
    "",
    "MASKINLEST INTENT:",
    JSON.stringify(
      {
        ambiguousBareRemoval: plan.ambiguousBareRemoval,
        intents: plan.intents
      },
      null,
      2
    ),
    "",
    "FORRIGE VERSJON:",
    "<<<",
    formatRewriteForReview(previousOutput),
    ">>>",
    "",
    "DRAFT:",
    "<<<",
    formatRewriteForReview(draftRewrite),
    ">>>"
  ].join("\n");
}

export function parseEditorialRevisionReviewResponse(
  raw: string
): EditorialRevisionReview {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fenced?.[1]?.trim() ?? trimmed;
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  if (typeof parsed.compliant !== "boolean") {
    throw new Error("Editorial review response missing compliant boolean.");
  }
  return {
    compliant: parsed.compliant,
    findings: Array.isArray(parsed.findings)
      ? parsed.findings.filter((item): item is string => typeof item === "string")
      : [],
    repairInstruction:
      typeof parsed.repairInstruction === "string"
        ? parsed.repairInstruction.trim()
        : ""
  };
}

export function editorialRepairInstruction(
  review: EditorialRevisionReview
): string | null {
  if (review.compliant || !review.repairInstruction.trim()) {
    return null;
  }
  return review.repairInstruction.trim();
}
