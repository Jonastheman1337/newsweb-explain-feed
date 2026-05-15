import { createHmac } from "node:crypto";
import { logPrisma, prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";

export const editorialTelemetrySchema = z
  .object({
    clientEventId: z.string().min(1).max(200).optional(),
    editorId: z.string().min(1).max(200).optional(),
    sessionId: z.string().min(1).max(200).optional(),
    version: z.number().int().positive().optional(),
    actionSource: z.string().min(1).max(120).optional()
  })
  .optional();

export const passiveEditorialActionSchema = z.enum([
  "notice_view",
  "rewrite_version_view",
  "source_link_open",
  "title_suggestion_generation_request"
]);

export type EditorialTelemetryInput = z.infer<typeof editorialTelemetrySchema>;

type RewriteContext = {
  id: string;
  version: number;
  promptVersion: string;
  model: string;
};

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function hashTelemetryId(secret: string, value?: string): string | null {
  if (!value) return null;
  return createHmac("sha256", secret).update(value).digest("hex");
}

async function resolveRewriteContext(
  messageId: number,
  version?: number | null
): Promise<RewriteContext | null> {
  if (version != null) {
    const exact = await prisma.rewrite.findFirst({
      where: { messageId, version },
      select: {
        id: true,
        version: true,
        promptVersion: true,
        model: true
      }
    });
    if (exact) return exact;
  }

  return prisma.rewrite.findFirst({
    where: {
      messageId,
      status: { in: ["published", "pending", "skipped", "failed"] }
    },
    orderBy: { generatedAt: "desc" },
    select: {
      id: true,
      version: true,
      promptVersion: true,
      model: true
    }
  });
}

export async function createUserActionEvent(args: {
  logger: FastifyBaseLogger;
  sessionSecret: string;
  messageId: number;
  action: string;
  telemetry?: EditorialTelemetryInput;
  version?: number | null;
  actionSource?: string | null;
  payload?: unknown;
}): Promise<{ id: string; rewriteContext: RewriteContext | null }> {
  const telemetry = editorialTelemetrySchema.parse(args.telemetry);
  const version = args.version ?? telemetry?.version ?? null;
  const rewriteContext = await resolveRewriteContext(args.messageId, version);
  const payload =
    args.payload && typeof args.payload === "object" && !Array.isArray(args.payload)
      ? args.payload
      : {
          value: args.payload ?? null
        };

  const event = await logPrisma.userActionEvent.create({
    data: {
      messageId: args.messageId,
      version: version ?? rewriteContext?.version ?? null,
      clientEventId: telemetry?.clientEventId ?? null,
      editorIdHash: hashTelemetryId(args.sessionSecret, telemetry?.editorId),
      sessionIdHash: hashTelemetryId(args.sessionSecret, telemetry?.sessionId),
      rewriteId: rewriteContext?.id ?? null,
      promptVersion: rewriteContext?.promptVersion ?? null,
      model: rewriteContext?.model ?? null,
      action: args.action,
      actionSource: args.actionSource ?? telemetry?.actionSource ?? null,
      payloadJson: toJsonValue(payload)
    }
  });

  args.logger.debug(
    {
      eventId: event.id,
      action: args.action,
      messageId: args.messageId,
      version: event.version
    },
    "Wrote editorial telemetry event"
  );

  return { id: event.id, rewriteContext };
}

export async function tryCreateUserActionEvent(args: Parameters<typeof createUserActionEvent>[0]): Promise<{
  id: string | null;
  rewriteContext: RewriteContext | null;
}> {
  try {
    return await createUserActionEvent(args);
  } catch (error) {
    args.logger.error(
      { err: error, action: args.action, messageId: args.messageId },
      "Failed to write editorial telemetry event"
    );
    return { id: null, rewriteContext: null };
  }
}
