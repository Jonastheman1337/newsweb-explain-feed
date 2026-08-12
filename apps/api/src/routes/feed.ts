import {
  feedQuerySchema,
  feedResponseSchema,
  isGenerationPhase
} from "@newsweb/shared";
import { logPrisma, prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { getMutedCategories } from "../services/app-settings.js";
import {
  shouldMarkFeedItemRegenerating,
  type FeedRewriteStateRecord
} from "../services/feed-regeneration.js";
import { mapDbItemToFeedItem } from "../services/feed-item-mapper.js";
import { GENERATION_RUN_STALE_MS } from "../services/generation-status.js";

type FeedRegenerationState = {
  activeIds: Set<number>;
  phaseByMessageId: Map<number, string | null>;
};

async function findRegenerationState(
  messageIds: number[],
  rewritesByMessageId: Map<number, FeedRewriteStateRecord[]>
): Promise<FeedRegenerationState> {
  if (messageIds.length === 0) {
    return { activeIds: new Set(), phaseByMessageId: new Map() };
  }

  const runs = await logPrisma.generationRun.findMany({
    where: {
      messageId: { in: messageIds },
      reason: { in: ["new-message", "manual-reprocess"] },
      phaseUpdatedAt: { gt: new Date(Date.now() - GENERATION_RUN_STALE_MS) }
    },
    orderBy: { requestedAt: "desc" },
    select: {
      messageId: true,
      id: true,
      status: true,
      phase: true,
      phaseUpdatedAt: true,
      requestedAt: true
    }
  });

  const activeIds = new Set<number>();
  const phaseByMessageId = new Map<number, string | null>();
  for (const run of runs) {
    if (phaseByMessageId.has(run.messageId)) {
      continue;
    }
    phaseByMessageId.set(run.messageId, run.phase);
    if (
      shouldMarkFeedItemRegenerating(
        run,
        rewritesByMessageId.get(run.messageId) ?? []
      )
    ) {
      activeIds.add(run.messageId);
    }
  }

  return { activeIds, phaseByMessageId };
}

export const feedRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/feed",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const query = feedQuerySchema.parse(request.query);
      const cursorDate = query.cursor ? new Date(query.cursor) : undefined;

      const conditions: Prisma.FeedItemWhereInput[] = [
        {
          visibilityStatus: "published"
        }
      ];

      if (cursorDate) {
        // Compound keyset cursor: the messageId tiebreaker keeps items with
        // identical publishedAt from being skipped at page boundaries.
        // Datetime-only fallback keeps old bookmarked URLs working.
        conditions.push(
          query.cursorId != null
            ? {
                OR: [
                  { publishedAt: { lt: cursorDate } },
                  { publishedAt: cursorDate, messageId: { lt: query.cursorId } }
                ]
              }
            : { publishedAt: { lt: cursorDate } }
        );
      }

      const mutedCategories = await getMutedCategories();
      if (mutedCategories.length > 0) {
        conditions.push({
          sourceNotice: {
            NOT: mutedCategories.map((category) => ({
              categoriesJson: { array_contains: [category] }
            }))
          }
        });
      }

      if (query.issuer) {
        conditions.push({
          sourceNotice: {
            issuerSign: {
              equals: query.issuer
            }
          }
        });
      }

      if (query.market) {
        conditions.push({
          sourceNotice: {
            marketsJson: {
              array_contains: [query.market]
            }
          }
        });
      }

      if (query.category) {
        conditions.push({
          sourceNotice: {
            categoriesJson: {
              array_contains: [query.category]
            }
          }
        });
      }

      if (query.q) {
        conditions.push({
          OR: [
            {
              sourceNotice: {
                title: {
                  contains: query.q,
                  mode: "insensitive"
                }
              }
            },
            {
              sourceNotice: {
                bodyText: {
                  contains: query.q,
                  mode: "insensitive"
                }
              }
            }
          ]
        });
      }

      const items = await prisma.feedItem.findMany({
        where: {
          AND: conditions
        },
        orderBy: [{ publishedAt: "desc" }, { messageId: "desc" }],
        take: query.limit + 1,
        include: {
          sourceNotice: {
            include: {
              rewrites: {
                orderBy: {
                  generatedAt: "desc"
                },
                // The mapper and regeneration check use only these fields;
                // validation_json in particular is large and never leaves the DB.
                select: {
                  status: true,
                  generatedAt: true,
                  version: true,
                  rewriteJson: true
                }
              }
            }
          }
        }
      });

      const hasNext = items.length > query.limit;
      const slice = hasNext ? items.slice(0, query.limit) : items;
      const rewritesByMessageId = new Map<number, FeedRewriteStateRecord[]>(
        slice.map((item) => [
          item.messageId,
          item.sourceNotice.rewrites.map((rewrite) => ({
            status: rewrite.status,
            generatedAt: rewrite.generatedAt
          }))
        ])
      );

      const { activeIds, phaseByMessageId } = await findRegenerationState(
        slice.map((item) => item.messageId),
        rewritesByMessageId
      );

      const responseItems = slice
        .map((item) => {
          let mapped = mapDbItemToFeedItem(item);
          if (!mapped) {
            return mapped;
          }
          if (activeIds.has(mapped.messageId)) {
            mapped = { ...mapped, regenerating: true };
          }
          if (mapped.processing || mapped.regenerating) {
            const phase = phaseByMessageId.get(mapped.messageId);
            if (isGenerationPhase(phase)) {
              mapped = { ...mapped, phase };
            }
          }
          return mapped;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      const lastSliceItem = slice.length ? slice[slice.length - 1] : null;
      const payload = {
        items: responseItems,
        nextCursor:
          hasNext && lastSliceItem ? lastSliceItem.publishedAt.toISOString() : null,
        nextCursorId: hasNext && lastSliceItem ? lastSliceItem.messageId : null
      };

      const parsed = feedResponseSchema.parse(payload);
      return reply.send(parsed);
    }
  );
};
