import {
  feedQuerySchema,
  feedResponseSchema
} from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { mapDbItemToFeedItem } from "../services/feed-item-mapper.js";

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

      const responseItems = slice
        .map(mapDbItemToFeedItem)
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
