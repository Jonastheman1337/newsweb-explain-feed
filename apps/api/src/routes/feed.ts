import {
  feedQuerySchema,
  feedResponseSchema
} from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { getMutedCategories } from "../services/app-settings.js";
import { mapDbItemToFeedItem } from "../services/feed-item-mapper.js";
import { loadFastDrafts } from "../services/fast-drafts.js";
import { applyFeedGenerationState, loadFeedGenerationRuns } from "../services/feed-generation-state.js";

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
          activePublishedRewrite: {
            select: {
              id: true,
              version: true,
              rewriteJson: true,
              contentHash: true,
              finalizedAt: true
            }
          },
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
                  version: true
                }
              }
            }
          }
        }
      });

      const hasNext = items.length > query.limit;
      const slice = hasNext ? items.slice(0, query.limit) : items;
      const generationRuns = await loadFeedGenerationRuns(slice.map((item) => item.messageId));

      const drafts = fastify.config.FAST_DRAFT_ENABLED && query.ui === "v2" ? await loadFastDrafts(slice.map((item) => item.messageId)) : new Map();
      const responseItems = slice
        .map((item) => {
          let mapped = mapDbItemToFeedItem(item);
          if (!mapped) {
            return mapped;
          }
          mapped = applyFeedGenerationState(mapped, generationRuns.get(item.messageId), item.sourceNotice.rewrites);
          const fastDraft = drafts.get(mapped.messageId);
          return fastDraft ? { ...mapped, fastDraft } : mapped;
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
