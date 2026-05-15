import { REDIS_CHANNELS, type FeedItem } from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
import type { FastifyPluginAsync } from "fastify";
import { Redis } from "ioredis";
import { mapDbItemToFeedItem } from "../services/feed-item-mapper.js";

type FeedUpdateState = "source" | "processing" | "published";

function parseFeedUpdate(message: string): {
  messageId: number;
  state?: FeedUpdateState;
} {
  const parsed = JSON.parse(message) as {
    messageId: number;
    state?: string;
  };
  return {
    messageId: parsed.messageId,
    state:
      parsed.state === "source" ||
      parsed.state === "processing" ||
      parsed.state === "published"
        ? parsed.state
        : undefined
  };
}

function applyFeedUpdateState(
  item: FeedItem,
  state: FeedUpdateState | undefined
): FeedItem {
  if (state === "source") {
    return {
      ...item,
      lead: "",
      body: [],
      keyFacts: [],
      negativeOrSurprising: [],
      sourceLimitations: [],
      importance: "uviktig",
      notGenerated: true,
      skipped: false,
      failed: false,
      processing: false
    };
  }

  if (state === "processing") {
    return {
      ...item,
      lead: "",
      body: [],
      keyFacts: [],
      negativeOrSurprising: [],
      sourceLimitations: [],
      importance: "uviktig",
      notGenerated: false,
      skipped: false,
      failed: false,
      processing: true
    };
  }

  return item;
}

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

      let writeChain = Promise.resolve();

      async function writeFeedUpdate(message: string): Promise<void> {
        try {
          const { messageId, state } = parseFeedUpdate(message);

          const dbItem = await prisma.feedItem.findUnique({
            where: { messageId },
            include: {
              sourceNotice: {
                include: {
                  rewrites: {
                    orderBy: { generatedAt: "desc" }
                  }
                }
              }
            }
          });

          if (!dbItem) return;

          const feedItem = mapDbItemToFeedItem(dbItem);
          if (!feedItem) return;

          reply.raw.write(
            `data: ${JSON.stringify(applyFeedUpdateState(feedItem, state))}\n\n`
          );
        } catch (err) {
          fastify.log.error(err, "SSE feed-stream message error");
        }
      }

      subscriber.on("message", (_channel: string, message: string) => {
        writeChain = writeChain.then(() => writeFeedUpdate(message));
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
