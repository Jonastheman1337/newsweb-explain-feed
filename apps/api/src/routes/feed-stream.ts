import { REDIS_CHANNELS } from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
import type { FastifyPluginAsync } from "fastify";
import { Redis } from "ioredis";
import { mapDbItemToFeedItem } from "../services/feed-item-mapper.js";

export const feedStreamRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/feed/stream",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      // Tell Fastify we are taking over the response — it should not
      // try to serialize or end the reply after the handler returns.
      reply.hijack();

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });

      // Flush an initial comment so the client sees the connection is open
      reply.raw.write(": connected\n\n");

      const subscriber = new Redis(fastify.config.REDIS_URL, {
        maxRetriesPerRequest: null
      });

      await subscriber.subscribe(REDIS_CHANNELS.feedNewItem);

      subscriber.on("message", async (_channel: string, message: string) => {
        try {
          const { messageId } = JSON.parse(message) as { messageId: number };

          const dbItem = await prisma.feedItem.findUnique({
            where: { messageId },
            include: {
              sourceNotice: {
                include: {
                  rewrites: {
                    orderBy: { generatedAt: "desc" },
                    take: 1
                  }
                }
              }
            }
          });

          if (!dbItem) return;

          const feedItem = mapDbItemToFeedItem(dbItem);
          if (!feedItem) return;

          reply.raw.write(`data: ${JSON.stringify(feedItem)}\n\n`);
        } catch (err) {
          fastify.log.error(err, "SSE feed-stream message error");
        }
      });

      const heartbeat = setInterval(() => {
        reply.raw.write(": heartbeat\n\n");
      }, 30_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        subscriber.unsubscribe().catch(() => {});
        subscriber.quit().catch(() => {});
      });
    }
  );
};
