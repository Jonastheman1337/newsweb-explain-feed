import {
  SAK_PROMPT_VERSION,
  createSakDeveloperPrompt,
  createSakRevisionUserPrompt,
  createSakSystemPrompt,
  createSakUserPrompt,
  type SakMaterialPayload,
  type SakPromptPayload
} from "@newsweb/prompt-kit";
import {
  QUEUE_NAMES,
  parseStoredSakArticle,
  sakArticleJsonSchema,
  sakArticleSchema,
  toPrismaJsonValue,
  type GenerationPhase,
  type SakArticle,
  type SakDraftJobData
} from "@newsweb/shared";
import type {
  OpenAIPromptCacheMode,
  OpenAIReasoningEffort
} from "@newsweb/shared/openai-responses";
import type { Prisma } from "@prisma/client";
import { setGenerationPhase } from "./generation-phase.js";
import { appendRevisionChecklist } from "./revision-instructions.js";
import {
  buildSakRepairInstruction,
  sakValidationJson,
  validateSakArticle,
  type SakValidationResult
} from "./sak-validation.js";

/**
 * The /sak generation job: one model call for the draft (or revision), the
 * deterministic validator, at most one repair call, then the version row.
 * Everything the worker process owns (OpenAI client, prisma, config) comes
 * in through deps so the flow is testable without a queue or a database.
 */

export const SAK_MAX_OUTPUT_TOKENS = 24576;
export const SAK_SCHEMA_NAME = "sak_article";
export const SAK_REVISION_REASONING_EFFORT: OpenAIReasoningEffort = "medium";
export const SAK_DEFAULT_REVISION_INSTRUCTION =
  "Skriv en ny versjon med samme vinkel og kilder. Stram inn språket, behold fakta, sitater og lenker.";

/** Short Norwegian line for the desk; the raw diagnostics stay in validationJson. */
export function sakVersionErrorText(failure: SakFailureClassification): string {
  if (failure.kind === "fatal") return failure.errorText;
  if (failure.kind === "retry") return "Genereringen feilet. Prøver igjen.";
  return "Genereringen feilet. Prøv igjen, eller kort ned materialet.";
}

export class SakDraftFatalError extends Error {
  constructor(
    readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "SakDraftFatalError";
  }
}

export type SakFailureClassification = {
  kind: "fatal" | "retry" | "final";
  code: string;
  status: "failed" | "needs_retry";
  errorText: string;
  rethrow: boolean;
};

export function classifySakFailure(
  error: unknown,
  finalAttempt: boolean
): SakFailureClassification {
  const errorText = error instanceof Error ? error.message : String(error);
  if (error instanceof SakDraftFatalError) {
    return { kind: "fatal", code: error.code, status: "failed", errorText, rethrow: false };
  }
  if (finalAttempt) {
    return {
      kind: "final",
      code: "SAK_DRAFT_FAILED_FINAL",
      status: "failed",
      errorText,
      rethrow: false
    };
  }
  return {
    kind: "retry",
    code: "SAK_DRAFT_ATTEMPT_FAILED",
    status: "needs_retry",
    errorText,
    rethrow: true
  };
}

export type SakModelCallInput = {
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
  reasoningEffort?: OpenAIReasoningEffort;
  timeoutMs?: number;
  maxOutputTokens?: number;
  promptCacheKey?: string;
  promptCacheMode?: OpenAIPromptCacheMode;
};

export type SakModelCallResult = {
  content: string;
  promptChars: number;
  modelCall: { model: string } & Record<string, unknown>;
};

export type SakDraftJob = {
  id?: string | number | null;
  name: string;
  data: SakDraftJobData;
  attemptsMade: number;
  opts: { attempts?: number };
};

type SakVersionWriteData = {
  status: string;
  articleJson?: Prisma.InputJsonValue;
  userInstruction?: string | null;
  changeNote?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  errorText?: string | null;
  validationJson?: Prisma.InputJsonValue;
  generationRunId?: string | null;
  generatedAt?: Date | null;
};

type GenerationRunUpdateData = {
  status?: string;
  phase?: GenerationPhase;
  phaseUpdatedAt?: Date;
  jobId?: string | null;
  jobName?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  promptChars?: number | null;
  startedAt?: Date;
  finishedAt?: Date | null;
  errorText?: string | null;
  inputJson?: Prisma.InputJsonValue;
  outputJson?: Prisma.InputJsonValue;
  validationJson?: Prisma.InputJsonValue;
};

export type SakDraftPrismaClient = {
  sakDraft: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; activeGenerationRunId: true };
    }): Promise<{ id: string; activeGenerationRunId: string | null } | null>;
    updateMany(args: {
      where: { id: string; activeGenerationRunId: string };
      data: { activeGenerationRunId: null; lastActivityAt: Date };
    }): Promise<{ count: number }>;
  };
  sakVersion: {
    upsert(args: {
      where: { sakId_version: { sakId: string; version: number } };
      create: SakVersionWriteData & { sakId: string; version: number };
      update: SakVersionWriteData;
    }): Promise<unknown>;
  };
};

export type SakDraftLogClient = {
  generationRun: {
    update(args: { where: { id: string }; data: GenerationRunUpdateData }): Promise<unknown>;
  };
};

export type SakDraftDeps = {
  prisma: SakDraftPrismaClient;
  logPrisma: SakDraftLogClient;
  callModelForJson: (input: SakModelCallInput) => Promise<SakModelCallResult>;
  promptCacheMode: OpenAIPromptCacheMode;
  config: {
    OPENAI_SAK_REASONING_EFFORT: OpenAIReasoningEffort;
    OPENAI_SAK_TIMEOUT_MS: number;
  };
  /** Pulls telemetry off a failed model call; returns its prompt chars. */
  collectFailedModelCall?: (error: unknown, modelCalls: unknown[]) => number;
  log?: (line: string) => void;
  now?: () => Date;
};

export type SakDraftStage = "draft" | "revision" | "repair";

export function sakReasoningEffort(
  data: Pick<SakDraftJobData, "reasoningEffortOverride">,
  config: SakDraftDeps["config"],
  stage: SakDraftStage
): OpenAIReasoningEffort {
  if (data.reasoningEffortOverride === "xhigh") return "xhigh";
  return stage === "draft" ? config.OPENAI_SAK_REASONING_EFFORT : SAK_REVISION_REASONING_EFFORT;
}

export function buildSakPromptPayload(data: SakDraftJobData): SakPromptPayload {
  const materials: SakMaterialPayload[] = data.materials.map((material) => ({
    sourceId: material.sourceId,
    kind: material.kind,
    title: material.title,
    url: material.url,
    text: material.text,
    textChars: material.textChars,
    status: material.status,
    failureReason: material.errorText
  }));
  return {
    sakId: data.sakId,
    materials,
    instruction: data.instruction ?? null,
    titleOverride: data.titleOverride ?? null,
    targetChars: data.targetChars,
    todayIso: data.todayIso
  };
}

export function parsePreviousSakArticle(json: unknown): SakArticle | null {
  // Lenient: a stored version may carry an owner title override or a quote
  // grown by its sitatstrek, which the strict model schema would reject.
  return parseStoredSakArticle(json);
}

export function parseSakArticleResponse(content: string): SakArticle {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `SAK_ARTICLE_PARSE_FAILED: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = sakArticleSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `SAK_ARTICLE_SCHEMA_FAILED: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid"}`
    );
  }
  return parsed.data;
}

export type SakRepairAudit = {
  attempted: boolean;
  applied: boolean;
  blockingBefore: string[];
  blockingAfter: string[];
  error: string | null;
};

function emptyRepairAudit(): SakRepairAudit {
  return { attempted: false, applied: false, blockingBefore: [], blockingAfter: [], error: null };
}

function jsonLog(deps: SakDraftDeps, event: string, fields: Record<string, unknown>): void {
  (deps.log ?? console.log)(
    JSON.stringify({ service: "worker", queue: QUEUE_NAMES.sak, event, ...fields })
  );
}

export async function processSakDraft(job: SakDraftJob, deps: SakDraftDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const { sakId, generationRunId, targetVersion } = job.data;
  const jobId = job.id != null ? String(job.id) : null;
  const maxAttempts = job.opts.attempts ?? 1;
  const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
  const modelCalls: unknown[] = [];
  let promptChars = 0;
  let model: string | null = null;

  const payload = buildSakPromptPayload(job.data);
  const previousArticle = parsePreviousSakArticle(job.data.previousArticleJson);
  const userInstruction = job.data.instruction?.trim() || null;
  // "Ny versjon" without an instruction is still a revision of the previous
  // version, never a fresh brief: keep the angle and sources, tighten the text.
  const instruction =
    userInstruction ?? (previousArticle ? SAK_DEFAULT_REVISION_INSTRUCTION : null);
  const isRevision = Boolean(previousArticle && instruction);
  const isFirstDraft = !previousArticle;
  const promptCacheKey = `newsweb:sak:${SAK_PROMPT_VERSION}`;

  const runInputJson = (): Prisma.InputJsonValue =>
    toPrismaJsonValue({
      sakId,
      targetVersion,
      isRevision,
      instruction,
      titleOverride: job.data.titleOverride ?? null,
      targetChars: job.data.targetChars,
      reasoningEffortOverride: job.data.reasoningEffortOverride ?? null,
      materials: job.data.materials.map((material) => ({
        id: material.id,
        sourceId: material.sourceId,
        kind: material.kind,
        title: material.title,
        url: material.url,
        status: material.status,
        textChars: material.textChars
      })),
      previousArticle,
      modelCalls
    });

  const persistVersion = async (data: SakVersionWriteData): Promise<void> => {
    await deps.prisma.sakVersion.upsert({
      where: { sakId_version: { sakId, version: targetVersion } },
      create: {
        sakId,
        version: targetVersion,
        userInstruction,
        generationRunId,
        ...data
      },
      update: { generationRunId, ...data }
    });
  };

  const releaseSlot = async (): Promise<void> => {
    await deps.prisma.sakDraft.updateMany({
      where: { id: sakId, activeGenerationRunId: generationRunId },
      data: { activeGenerationRunId: null, lastActivityAt: now() }
    });
  };

  await deps.logPrisma.generationRun.update({
    where: { id: generationRunId },
    data: {
      status: "started",
      phase: "reading_notice",
      phaseUpdatedAt: now(),
      jobId,
      jobName: job.name,
      promptVersion: SAK_PROMPT_VERSION,
      startedAt: now(),
      inputJson: runInputJson()
    }
  });

  try {
    const draft = await deps.prisma.sakDraft.findUnique({
      where: { id: sakId },
      select: { id: true, activeGenerationRunId: true }
    });
    if (!draft) {
      throw new SakDraftFatalError("SAK_DELETED", "Saken er slettet eller utløpt.");
    }
    if (draft.activeGenerationRunId !== generationRunId) {
      // Another generation owns the draft now (the API evicted a stale run).
      // Leave the slot alone and close this run out quietly.
      await persistVersion({
        status: "failed",
        errorText: "SAK_SUPERSEDED"
      });
      await deps.logPrisma.generationRun.update({
        where: { id: generationRunId },
        data: {
          status: "superseded",
          phase: "failed",
          phaseUpdatedAt: now(),
          errorText: `SAK_SUPERSEDED_BY:${draft.activeGenerationRunId ?? "none"}`,
          finishedAt: now()
        }
      });
      jsonLog(deps, "superseded", { sakId, generationRunId, targetVersion });
      return;
    }
    if (!job.data.materials.some((material) => material.status === "ready" && material.text.trim())) {
      throw new SakDraftFatalError(
        "SAK_NO_MATERIALS",
        "Ingen lesbare materialer å skrive fra."
      );
    }

    await setGenerationPhase(deps.logPrisma, generationRunId, "analyzing_content");
    const systemPrompt = createSakSystemPrompt();
    const developerPrompt = createSakDeveloperPrompt();
    const userPrompt =
      isRevision && previousArticle && instruction
        ? createSakRevisionUserPrompt(
            payload,
            previousArticle,
            appendRevisionChecklist(instruction) ?? instruction
          )
        : createSakUserPrompt(payload);
    const stage: SakDraftStage = isRevision ? "revision" : "draft";
    const reasoningEffort = sakReasoningEffort(job.data, deps.config, stage);

    const callModel = async (
      prompt: string,
      effort: OpenAIReasoningEffort
    ): Promise<SakArticle> => {
      const result = await deps.callModelForJson({
        schemaName: SAK_SCHEMA_NAME,
        schema: sakArticleJsonSchema as unknown as Record<string, unknown>,
        systemPrompt,
        developerPrompt,
        userPrompt: prompt,
        reasoningEffort: effort,
        timeoutMs: deps.config.OPENAI_SAK_TIMEOUT_MS,
        maxOutputTokens: SAK_MAX_OUTPUT_TOKENS,
        promptCacheKey,
        promptCacheMode: deps.promptCacheMode
      });
      modelCalls.push(result.modelCall);
      promptChars += result.promptChars;
      model = result.modelCall.model;
      return parseSakArticleResponse(result.content);
    };

    await setGenerationPhase(deps.logPrisma, generationRunId, "writing_notice");
    const rawArticle = await callModel(userPrompt, reasoningEffort);

    await setGenerationPhase(deps.logPrisma, generationRunId, "checking_references");
    const validationContext = {
      titleOverride: job.data.titleOverride ?? null,
      targetChars: job.data.targetChars,
      previousArticle,
      instruction,
      isFirstDraft
    };
    let validation: SakValidationResult = validateSakArticle(
      rawArticle,
      payload,
      validationContext
    );
    const repair = emptyRepairAudit();

    if (validation.blockingErrors.length > 0) {
      repair.attempted = true;
      repair.blockingBefore = validation.blockingErrors;
      try {
        const repairPrompt = createSakRevisionUserPrompt(
          payload,
          validation.article,
          buildSakRepairInstruction(validation.issues)
        );
        const repairedRaw = await callModel(
          repairPrompt,
          sakReasoningEffort(job.data, deps.config, "repair")
        );
        const repaired = validateSakArticle(repairedRaw, payload, validationContext);
        repair.blockingAfter = repaired.blockingErrors;
        if (repaired.blockingErrors.length <= validation.blockingErrors.length) {
          validation = repaired;
          repair.applied = true;
        }
      } catch (error) {
        if (deps.collectFailedModelCall) {
          promptChars += deps.collectFailedModelCall(error, modelCalls);
        }
        repair.error = error instanceof Error ? error.message : String(error);
        repair.blockingAfter = validation.blockingErrors;
        jsonLog(deps, "repair_failed", { sakId, generationRunId, error: repair.error });
      }
    }

    await setGenerationPhase(deps.logPrisma, generationRunId, "finalizing");
    const status = validation.blockingErrors.length > 0 ? "needs_review" : "ready";
    const validationJson = toPrismaJsonValue(
      sakValidationJson(validation, { repair, promptChars, isRevision })
    );
    const articleJson = toPrismaJsonValue(validation.article);
    const generatedAt = now();

    await persistVersion({
      status,
      articleJson,
      changeNote: validation.article.change_note,
      promptVersion: SAK_PROMPT_VERSION,
      model,
      errorText: null,
      validationJson,
      generatedAt
    });
    await releaseSlot();
    await deps.logPrisma.generationRun.update({
      where: { id: generationRunId },
      data: {
        status: "published",
        phase: "published",
        phaseUpdatedAt: now(),
        finishedAt: now(),
        model,
        promptChars,
        inputJson: runInputJson(),
        outputJson: articleJson,
        validationJson,
        errorText: null
      }
    });
    jsonLog(deps, "completed", {
      sakId,
      generationRunId,
      targetVersion,
      status,
      visibleChars: validation.visibleChars,
      blocking: validation.blockingErrors.length,
      warnings: validation.warnings.length,
      repairAttempted: repair.attempted
    });
  } catch (error) {
    if (deps.collectFailedModelCall) {
      promptChars += deps.collectFailedModelCall(error, modelCalls);
    }
    const failure = classifySakFailure(error, finalAttempt);
    const validationJson = toPrismaJsonValue({
      valid: false,
      errorCode: failure.code,
      errors: [failure.errorText],
      promptChars
    });

    // A deleted or expired draft has no rows left to update (cascade) and no
    // slot to release; only the log-DB run is closed out below.
    const draftGone = failure.code === "SAK_DELETED";
    if (!draftGone) {
      try {
        await persistVersion({
          status: failure.status,
          errorText: sakVersionErrorText(failure),
          validationJson,
          model
        });
      } catch (persistError) {
        jsonLog(deps, "persist_failed", {
          sakId,
          generationRunId,
          targetVersion,
          error: persistError instanceof Error ? persistError.message : String(persistError)
        });
      }
    }

    if (failure.status === "failed") {
      if (!draftGone) {
        await releaseSlot();
      }
      await deps.logPrisma.generationRun.update({
        where: { id: generationRunId },
        data: {
          status: "failed",
          phase: "failed",
          phaseUpdatedAt: now(),
          finishedAt: now(),
          errorText: `${failure.code}: ${failure.errorText}`,
          model,
          promptChars,
          inputJson: runInputJson(),
          validationJson
        }
      });
    } else {
      await deps.logPrisma.generationRun.update({
        where: { id: generationRunId },
        data: {
          status: "needs_retry",
          phase: "queued",
          phaseUpdatedAt: now(),
          errorText: `${failure.code}: ${failure.errorText}`,
          model,
          promptChars,
          inputJson: runInputJson(),
          validationJson
        }
      });
    }
    jsonLog(deps, failure.status === "failed" ? "final_failed" : "attempt_failed", {
      sakId,
      generationRunId,
      targetVersion,
      errorCode: failure.code,
      error: failure.errorText,
      attempt: job.attemptsMade + 1,
      maxAttempts
    });
    if (failure.rethrow) {
      throw error;
    }
  }
}
