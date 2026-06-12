import {
  feedQuerySchema,
  feedResponseSchema
} from "@newsweb/shared";
import { logPrisma, prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import {
  shouldMarkFeedItemRegenerating,
  type FeedRewriteStateRecord
} from "../services/feed-regeneration.js";
import { mapDbItemToFeedItem } from "../services/feed-item-mapper.js";
import { GENERATION_RUN_STALE_MS } from "../services/generation-status.js";

async function findRegeneratingMessageIds(
  messageIds: number[],
  rewritesByMessageId: Map<number, FeedRewriteStateRecord[]>
): Promise<Set<number>> {
  if (messageIds.length === 0) {
    return new Set();
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
  const seenIds = new Set<number>();
  for (const run of runs) {
    if (seenIds.has(run.messageId)) {
      continue;
    }
    seenIds.add(run.messageId);
    if (
      shouldMarkFeedItemRegenerating(
        run,
        rewritesByMessageId.get(run.messageId) ?? []
      )
    ) {
      activeIds.add(run.messageId);
    }
  }

  return activeIds;
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
        conditions.push({
          publishedAt: { lt: cursorDate }
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
        orderBy: {
          publishedAt: "desc"
        },
        take: query.limit + 1,
        include: {
          sourceNotice: {
            include: {
              rewrites: {
                orderBy: {
                  generatedAt: "desc"
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

      const regeneratingMessageIds = await findRegeneratingMessageIds(
        slice.map((item) => item.messageId),
        rewritesByMessageId
      );

      const responseItems = slice
        .map((item) => {
          const mapped = mapDbItemToFeedItem(item);
          if (!mapped || !regeneratingMessageIds.has(mapped.messageId)) {
            return mapped;
          }
          return { ...mapped, regenerating: true };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      const payload = {
        items: responseItems,
        nextCursor:
          hasNext && responseItems.length
            ? responseItems[responseItems.length - 1].publishedAt
            : null
      };

      const parsed = feedResponseSchema.parse(payload);
      return reply.send(parsed);
    }
  );
};
