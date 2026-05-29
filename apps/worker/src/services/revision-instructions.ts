import type { RewriteOutput } from "@newsweb/shared";
import { collectDraftSentences } from "./reference-check.js";
import { countVisibleArticleChars, visibleArticleText } from "./rewrite-validation.js";

export type RevisionIntent =
  | { type: "remove_text"; target: string }
  | { type: "explain_term"; term: string }
  | { type: "simplify" }
  | { type: "title_only" }
  | { type: "length_target"; mode: "shorter" | "longer" | "around"; targetChars?: number }
  | { type: "focus_shift"; target: string }
  | { type: "attachment_required" };

export type RevisionInstructionPlan = {
  rawInstruction: string;
  intents: RevisionIntent[];
  checklist: string | null;
  ambiguousBareRemoval: boolean;
};

export type RevisionComplianceCheck = {
  type: RevisionIntent["type"];
  target?: string;
  passed: boolean;
  message: string;
};

export type RevisionInstructionCompliance = {
  rawInstruction: string;
  intents: RevisionIntent[];
  checks: RevisionComplianceCheck[];
  warnings: string[];
  passed: boolean;
  maxVisibleArticleChars?: number;
};

const GENERIC_TARGETS = new Set([
  "det",
  "dette",
  "den",
  "hele det avsnittet",
  "det avsnittet",
  "avsnittet",
  "saken",
  "teksten",
  "meldingen"
]);

const EXPLANATION_MARKERS = [
  "betyr",
  "det vil si",
  "altså",
  "innebærer",
  "forklar",
  "gir rett",
  "rett til",
  "kan brukes",
  "brukes til",
  "gjøres om",
  "gjøres opp",
  "som er",
  "som gir",
  "som betyr"
];

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[«»"“”'`]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTarget(raw: string): string | null {
  const cleaned = raw
    .replace(/[«»"“”]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(at|om|hva|hvordan)\s+/i, "")
    .replace(/\s+(gjerne|hvis|dersom|eventuelt|også|ogsaa).*$/i, "")
    .trim()
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  const normalized = normalizeText(cleaned);
  if (cleaned.length < 3 || GENERIC_TARGETS.has(normalized)) {
    return null;
  }
  if (cleaned.split(/\s+/).length > 8) {
    return null;
  }
  return cleaned;
}

function cleanRemoveTarget(raw: string): string | null {
  const cleaned = raw
    .replace(/[«»"“”]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^dette\s*:?\s*/i, "")
    .replace(/\s+(gjerne|hvis|dersom|eventuelt|også|ogsaa).*$/i, "")
    .trim()
    .replace(/[;:]+$/g, "")
    .trim();
  const normalized = normalizeText(cleaned);
  if (cleaned.length < 3 || GENERIC_TARGETS.has(normalized)) {
    return null;
  }
  if (cleaned.split(/\s+/).length > 80) {
    return null;
  }
  return cleaned;
}

function addUnique(intents: RevisionIntent[], intent: RevisionIntent): void {
  const key = JSON.stringify(intent);
  if (!intents.some((existing) => JSON.stringify(existing) === key)) {
    intents.push(intent);
  }
}

function extractTargets(raw: string): string[] {
  return raw
    .split(/\s+og\s+|,\s*/i)
    .map(cleanTarget)
    .filter((target): target is string => Boolean(target));
}

function quotedTargets(instruction: string): string[] {
  const targets: string[] = [];
  const pattern = /(?:dropp|fjern|ta bort|kutt)\s+(?:"([^"]+)"|«([^»]+)»|“([^”]+)”|'([^']+)')/gi;
  for (const match of instruction.matchAll(pattern)) {
    const target = cleanRemoveTarget(
      match[1] ?? match[2] ?? match[3] ?? match[4] ?? ""
    );
    if (target) {
      targets.push(target);
    }
  }
  return targets;
}

function addRemoveIntents(instruction: string, intents: RevisionIntent[]): void {
  const explicitCut = instruction.match(
    /\b(?:dropp|fjern|ta bort|kutt)\s+dette\s*:\s*([\s\S]+)/i
  );
  if (explicitCut) {
    const target = cleanRemoveTarget(explicitCut[1] ?? "");
    if (target) {
      addUnique(intents, { type: "remove_text", target });
    }
  }

  for (const target of quotedTargets(instruction)) {
    addUnique(intents, { type: "remove_text", target });
  }

  const patterns = [
    /(?:^|[.!?]\s*)(?:dropp|fjern|ta bort|kutt)\s+(?:omtalen|setningen|avsnittet)\s+(?:av|om)\s+([^.!?]+)/gi,
    /(?:^|[.!?]\s*)(?:dropp|fjern|ta bort|kutt)\s+(?!dette\s*:)(?!(?:omtalen|setningen|avsnittet)\s+(?:av|om)\s+)([^.!?]+)/gi,
    /(?:^|[.!?]\s*)ikke\s+(?:nevn|ta med|bruk|skriv)\s+([^.!?]+)/gi
  ];
  for (const pattern of patterns) {
    for (const match of instruction.matchAll(pattern)) {
      for (const target of extractTargets(match[1] ?? "")) {
        addUnique(intents, { type: "remove_text", target });
      }
    }
  }
}

export function isAmbiguousBareRemovalInstruction(
  instruction?: string | null
): boolean {
  const normalized = normalizeText(instruction?.trim() ?? "");
  return /^(?:kan du\s+)?(?:dropp|fjern|ta bort|kutt)\s+dette(?:\s+(?:fra|i)\s+(?:saken|teksten|tittel(?:en)?|lead(?:en)?|body|avsnitt(?:et)?))?$/.test(
    normalized
  );
}

function addExplainIntents(instruction: string, intents: RevisionIntent[]): void {
  const patterns = [
    /hva\s+er\s+([a-zæøå0-9 -]{2,60})\??/gi,
    /hva\s+betyr\s+([a-zæøå0-9 -]{2,60})/gi,
    /(?:leser(?:ne)?\s+)?(?:skjønner|forstår)\s+ikke\s+(?:hva\s+)?([a-zæøå0-9 -]{2,60}?)(?:\s+er|[.!?]|$)/gi,
    /forklar\s+(?:hva\s+)?([a-zæøå0-9 -]{2,60})(?:\s+betyr|[.!?]|$)/gi
  ];
  for (const pattern of patterns) {
    for (const match of instruction.matchAll(pattern)) {
      const term = cleanTarget(match[1] ?? "");
      if (term) {
        addUnique(intents, { type: "explain_term", term });
      }
    }
  }
}

function addLengthIntent(instruction: string, intents: RevisionIntent[]): void {
  const aroundMatch = instruction.match(/(?:rundt|ca\.?|cirka)?\s*(\d{3,4})\s*tegn/i);
  if (aroundMatch) {
    addUnique(intents, {
      type: "length_target",
      mode: "around",
      targetChars: Number(aroundMatch[1])
    });
    return;
  }
  if (/\b(?:kortere|for langt|strammere)\b/i.test(instruction)) {
    addUnique(intents, { type: "length_target", mode: "shorter" });
  }
  if (/\b(?:litt lenger|lengre|mer utfyllende|skriv mer)\b/i.test(instruction)) {
    addUnique(intents, { type: "length_target", mode: "longer" });
  }
}

function addFocusIntent(instruction: string, intents: RevisionIntent[]): void {
  const patterns = [
    /vinkl(?:e|er)?\s+(?:på|pa)\s+([^.!?]+)/gi,
    /(?:mer|mest)\s+(?:på|pa|om)\s+([^.!?]+)/gi
  ];
  for (const pattern of patterns) {
    for (const match of instruction.matchAll(pattern)) {
      const target = cleanTarget(match[1] ?? "");
      if (target) {
        addUnique(intents, { type: "focus_shift", target });
      }
    }
  }
}

export function parseRevisionInstruction(
  instruction?: string | null
): RevisionInstructionPlan {
  const rawInstruction = instruction?.trim() ?? "";
  const intents: RevisionIntent[] = [];
  if (!rawInstruction) {
    return { rawInstruction, intents, checklist: null, ambiguousBareRemoval: false };
  }

  addRemoveIntents(rawInstruction, intents);
  addExplainIntents(rawInstruction, intents);
  addLengthIntent(rawInstruction, intents);
  addFocusIntent(rawInstruction, intents);

  if (/\b(?:for komplisert|skriv(?:e)?(?: mye)? enklere|gjør(?:e)? enklere|vanskelig å skjønne|lett å forstå)\b/i.test(rawInstruction)) {
    addUnique(intents, { type: "simplify" });
  }
  if (/\b(?:endre|bytt|fiks|ny)\s+tittel(?:en)?\b|\btittelen\b/i.test(rawInstruction)) {
    addUnique(intents, { type: "title_only" });
  }
  if (/(?:les|åpne|apne)\s+(?:pdf(?:-en)?|vedlegg(?:et|ene)?|rapport(?:en)?)/i.test(rawInstruction)) {
    addUnique(intents, { type: "attachment_required" });
  }

  const checklist = buildRevisionChecklist(intents);
  return {
    rawInstruction,
    intents,
    checklist,
    ambiguousBareRemoval: isAmbiguousBareRemovalInstruction(rawInstruction)
  };
}

export function buildRevisionChecklist(intents: RevisionIntent[]): string | null {
  if (intents.length === 0) {
    return null;
  }

  const lines = intents.map((intent) => {
    switch (intent.type) {
      case "remove_text":
        return `- Fjern synlig omtale av: "${intent.target}".`;
      case "explain_term":
        return `- Forklar "${intent.term}" naturlig i samme eller neste setning, eller dropp ordet.`;
      case "simplify":
        return "- Skriv merkbart enklere: kortere setninger, færre fagord og mer hverdagsnorsk.";
      case "title_only":
        return "- Endre tittelen, men behold lead og body mest mulig uendret.";
      case "length_target":
        if (intent.mode === "around" && intent.targetChars) {
          return `- Sikt på rundt ${intent.targetChars} tegn i synlig artikkeltekst.`;
        }
        return intent.mode === "shorter"
          ? "- Gjør synlig artikkeltekst tydelig kortere."
          : "- Gjør synlig artikkeltekst tydelig lengre.";
      case "focus_shift":
        return `- Vinkle tydeligere på: "${intent.target}".`;
      case "attachment_required":
        return "- Bruk ekstra dokument-/rapportkontekst hvis den faktisk er hentet ut; ikke lat som vedlegg er lest hvis konteksten mangler.";
    }
  });

  return ["MASKINLEST SJEKKLISTE:", ...lines].join("\n");
}

export function appendRevisionChecklist(
  instruction?: string | null
): string | undefined {
  const plan = parseRevisionInstruction(instruction);
  if (!plan.rawInstruction) {
    return undefined;
  }
  if (!plan.checklist) {
    return plan.rawInstruction;
  }
  return [plan.rawInstruction, "", plan.checklist].join("\n");
}

function sentenceHasExplanation(sentences: string[], index: number): boolean {
  const current = normalizeText(sentences[index] ?? "");
  const next = normalizeText(sentences[index + 1] ?? "");
  const combined = `${current} ${next}`;
  return EXPLANATION_MARKERS.some((marker) => combined.includes(normalizeText(marker)));
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 && rightTokens.size === 0) {
    return 1;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size, 1);
}

function normalizedTargetChunks(target: string): string[] {
  const sentenceChunks = target
    .split(/[.!?]+/)
    .map(normalizeText)
    .filter((chunk) => chunk.split(" ").filter(Boolean).length >= 4);
  if (sentenceChunks.length > 0) {
    return sentenceChunks;
  }
  const normalized = normalizeText(target);
  return normalized ? [normalized] : [];
}

function removeTargetStillVisible(normalizedVisible: string, target: string): boolean {
  const normalizedTarget = normalizeText(target);
  const targetWords = normalizedTarget.split(" ").filter(Boolean);
  if (targetWords.length <= 8) {
    return normalizedVisible.includes(normalizedTarget);
  }
  return normalizedTargetChunks(target).some((chunk) =>
    normalizedVisible.includes(chunk)
  );
}

function removeTargetFromNormalizedText(text: string, target: string): string {
  let normalized = normalizeText(text);
  for (const chunk of normalizedTargetChunks(target).sort(
    (left, right) => right.length - left.length
  )) {
    normalized = normalized.replaceAll(chunk, " ");
  }
  return normalized.replace(/\s+/g, " ").trim();
}

function earlyVisibleText(rewrite: RewriteOutput): string {
  return [rewrite.title, rewrite.lead, rewrite.body[0] ?? ""].join("\n");
}

export function validateRevisionInstructionCompliance(
  rewrite: RewriteOutput,
  context: {
    instruction?: string | null;
    previousOutput?: RewriteOutput;
    attachmentTextAvailable?: boolean;
  }
): RevisionInstructionCompliance | null {
  const plan = parseRevisionInstruction(context.instruction);
  if (!plan.rawInstruction || plan.intents.length === 0) {
    return null;
  }

  const visible = normalizeText(visibleArticleText(rewrite));
  const sentences = [rewrite.title, ...collectDraftSentences(rewrite)];
  const checks: RevisionComplianceCheck[] = [];
  let maxVisibleArticleChars: number | undefined;

  for (const intent of plan.intents) {
    if (intent.type === "remove_text") {
      const passed = !removeTargetStillVisible(visible, intent.target);
      checks.push({
        type: intent.type,
        target: intent.target,
        passed,
        message: passed
          ? `Fjernet "${intent.target}".`
          : `Instruksjonen ba om å fjerne "${intent.target}", men teksten omtaler det fortsatt.`
      });

      if (context.previousOutput) {
        const previousWithoutTarget = removeTargetFromNormalizedText(
          visibleArticleText(context.previousOutput),
          intent.target
        );
        const currentWithoutTarget = removeTargetFromNormalizedText(
          visibleArticleText(rewrite),
          intent.target
        );
        const similarity = tokenSimilarity(previousWithoutTarget, currentWithoutTarget);
        const preserved = similarity >= 0.65;
        checks.push({
          type: intent.type,
          target: intent.target,
          passed: preserved,
          message: preserved
            ? "Resten av teksten er i hovedsak beholdt etter smal kuttinstruksjon."
            : "Instruksjonen var en smal kutt/fjern-endring, men teksten ble endret for mye ellers."
        });
      }
    }

    if (intent.type === "explain_term") {
      const normalizedTerm = normalizeText(intent.term);
      const termIndex = sentences.findIndex((sentence) =>
        normalizeText(sentence).includes(normalizedTerm)
      );
      const passed = termIndex < 0 || sentenceHasExplanation(sentences, termIndex);
      checks.push({
        type: intent.type,
        target: intent.term,
        passed,
        message: passed
          ? `"${intent.term}" er fjernet eller forklart.`
          : `Instruksjonen ba om forklaring av "${intent.term}", men ordet står uten tydelig forklaring i samme eller neste setning.`
      });
    }

    if (intent.type === "simplify") {
      const longSentences = sentences.filter((sentence) => sentence.split(/\s+/).length > 28);
      const passed = longSentences.length === 0;
      checks.push({
        type: intent.type,
        passed,
        message: passed
          ? "Teksten har ingen svært lange setninger."
          : "Instruksjonen ba om enklere tekst, men én eller flere synlige setninger er fortsatt svært lange."
      });
    }

    if (intent.type === "title_only" && context.previousOutput) {
      const previousBody = [context.previousOutput.lead, ...context.previousOutput.body].join("\n");
      const currentBody = [rewrite.lead, ...rewrite.body].join("\n");
      const similarity = tokenSimilarity(previousBody, currentBody);
      const passed = similarity >= 0.85;
      checks.push({
        type: intent.type,
        passed,
        message: passed
          ? "Lead/body er i hovedsak beholdt ved tittelendring."
          : "Instruksjonen ser ut til å gjelde tittelen, men lead/body ble også endret mye."
      });
    }

    if (intent.type === "length_target") {
      const chars = countVisibleArticleChars(rewrite);
      let passed = true;
      let message = "Lengdeinstruksjonen er oppfylt.";
      if (intent.mode === "around" && intent.targetChars) {
        const min = Math.floor(intent.targetChars * 0.8);
        const max = Math.ceil(intent.targetChars * 1.2);
        passed = chars >= min && chars <= max;
        maxVisibleArticleChars = Math.max(maxVisibleArticleChars ?? 0, max);
        message = passed
          ? `Synlig tekst er ${chars} tegn, innenfor målet rundt ${intent.targetChars}.`
          : `Instruksjonen ba om rundt ${intent.targetChars} tegn, men synlig tekst er ${chars} tegn.`;
      } else if (context.previousOutput) {
        const previousChars = countVisibleArticleChars(context.previousOutput);
        if (intent.mode === "shorter") {
          passed = chars <= Math.floor(previousChars * 0.9);
          message = passed
            ? "Teksten er tydelig kortere enn forrige versjon."
            : "Instruksjonen ba om kortere tekst, men teksten er ikke minst 10 prosent kortere.";
        } else {
          passed = chars >= Math.ceil(previousChars * 1.1);
          message = passed
            ? "Teksten er tydelig lengre enn forrige versjon."
            : "Instruksjonen ba om lengre tekst, men teksten er ikke minst 10 prosent lengre.";
        }
      }
      checks.push({ type: intent.type, passed, message });
    }

    if (intent.type === "focus_shift") {
      const passed = normalizeText(earlyVisibleText(rewrite)).includes(
        normalizeText(intent.target)
      );
      checks.push({
        type: intent.type,
        target: intent.target,
        passed,
        message: passed
          ? `Vinklingen er synlig tidlig: "${intent.target}".`
          : `Instruksjonen ba om vinkel på "${intent.target}", men dette er ikke tydelig i tittel, lead eller første avsnitt.`
      });
    }

    if (intent.type === "attachment_required") {
      const passed = context.attachmentTextAvailable === true;
      checks.push({
        type: intent.type,
        passed,
        message: passed
          ? "Ekstra dokument-/rapportkontekst var tilgjengelig."
          : "Instruksjonen ba om å lese vedlegg/rapport, men ingen ekstra dokumenttekst var tilgjengelig for regenereringen."
      });
    }
  }

  const warnings = checks.filter((check) => !check.passed).map((check) => check.message);
  return {
    rawInstruction: plan.rawInstruction,
    intents: plan.intents,
    checks,
    warnings,
    passed: warnings.length === 0,
    ...(maxVisibleArticleChars ? { maxVisibleArticleChars } : {})
  };
}
