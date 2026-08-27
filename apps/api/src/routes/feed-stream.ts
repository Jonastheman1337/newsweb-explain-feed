import {
  REDIS_CHANNELS,
  isGenerationPhase,
  type FeedItem,
  type GenerationPhase
} from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
import type { FastifyPluginAsync } from "fastify";
import { Redis } from "ioredis";
import type { ServerResponse } from "node:http";
import { getMutedCategories } from "../services/app-settings.js";
import { mapDbItemToFeedItem } from "../services/feed-item-mapper.js";

type FeedUpdateState = "source" | "processing" | "published" | "failed";

export function parseFeedUpdate(message: string): {
  messageId: number;
  state?: FeedUpdateState;
  phase?: GenerationPhase;
} {
  const parsed = JSON.parse(message) as {
    messageId: number;
    state?: string;
    phase?: string;
  };
  return {
    messageId: parsed.messageId,
    state:
      parsed.state === "source" ||
      parsed.state === "processing" ||
      parsed.state === "published" ||
      parsed.state === "failed"
        ? parsed.state
        : undefined,
    phase: isGenerationPhase(parsed.phase) ? parsed.phase : undefined
  };
}

export function applyFeedUpdateState(
  item: FeedItem,
  state: FeedUpdateState | undefined,
  phase?: GenerationPhase
): FeedItem {
  if (state === "source") {
    if (item.isFinal) return item;
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
      processing: false,
      regenerating: false
    };
  }

  if (state === "processing") {
    if (
      item.isFinal
    ) {
      return {
        ...item,
        processing: false,
        regenerating: true,
        ...(phase ? { phase } : {})
      };
    }

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
      processing: true,
      regenerating: false,
      ...(phase ? { phase } : {})
    };
  }

  return item;
}

export type BufferedFeedEvent = {
  id: string;
  frame: string;
};

export function appendToRingBuffer(
  buffer: BufferedFeedEvent[],
  event: BufferedFeedEvent,
  cap = 256
): void {
  buffer.push(event);
  while (buffer.length > cap) {
    buffer.shift();
  }
}

/**
 * Events emitted after the given id, or null when the id is unknown
 * (evicted from the buffer, or from a previous process epoch) — the
 * caller must then tell the client to do a full resync.
 */
export function eventsAfter(
  buffer: BufferedFeedEvent[],
  lastEventId: string
): BufferedFeedEvent[] | null {
  const index = buffer.findIndex((event) => event.id === lastEventId);
  if (index < 0) {
    return null;
  }
  return buffer.slice(index + 1);
}

export const feedStreamRoutes: FastifyPluginAsync = async (fastify) => {
  // Event ids are epoch-prefixed so a Last-Event-ID from before a restart
  // never matches and the client falls back to a full resync.
  const processEpoch = Date.now();
  let seq = 0;
  const eventBuffer: BufferedFeedEvent[] = [];
  const connections = new Set<ServerResponse>();

  // One Redis subscription shared by every SSE connection.
  const subscriber = new Redis(fastify.config.REDIS_URL, {
    maxRetriesPerRequest: null
  });
  subscriber.on("error", (err) => {
    fastify.log.error(err, "feed-stream redis subscriber error");
  });
  // ioredis restores subscriptions itself on reconnect; this is belt-and-braces.
  subscriber.on("ready", () => {
    subscriber.subscribe(REDIS_CHANNELS.feedNewItem).catch((err) => {
      fastify.log.error(err, "feed-stream redis resubscribe error");
    });
  });
  await subscriber.subscribe(REDIS_CHANNELS.feedNewItem);

  // Serializes event processing AND connection registration so a replaying
  // client can neither miss nor double-receive an event around registration.
  let writeChain = Promise.resolve();
  function enqueue(task: () => Promise<void> | void): void {
    writeChain = writeChain.then(async () => {
      try {
        await task();
      } catch (err) {
        fastify.log.error(err, "SSE feed-stream task error");
      }
    });
  }

  function writeToConnection(raw: ServerResponse, chunk: string): void {
    if (raw.writableEnded || raw.destroyed) {
      connections.delete(raw);
      return;
    }
    try {
      raw.write(chunk);
    } catch {
      connections.delete(raw);
    }
  }

  async function broadcastFeedUpdate(message: string): Promise<void> {
    const { messageId, state, phase } = parseFeedUpdate(message);

    const dbItem = await prisma.feedItem.findUnique({
      where: { messageId },
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
              orderBy: { generatedAt: "desc" },
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

    if (!dbItem) return;
    // The /feed query filters on visibilityStatus; the stream must agree,
    // or hidden items (e.g. bilingual duplicates) get pushed live.
    if (dbItem.visibilityStatus !== "published") return;

    const feedItem = mapDbItemToFeedItem(dbItem);
    if (!feedItem) return;

    // Muting must hold for every live subscriber (including desktop
    // notifications), not just the paginated feed query.
    const mutedCategories = await getMutedCategories();
    if (
      mutedCategories.length > 0 &&
      feedItem.categories.some((category) => mutedCategories.includes(category))
    ) {
      return;
    }

    const id = `${processEpoch}-${++seq}`;
    const frame = `id: ${id}\ndata: ${JSON.stringify(
      applyFeedUpdateState(feedItem, state, phase)
    )}\n\n`;
    appendToRingBuffer(eventBuffer, { id, frame });

    for (const raw of connections) {
      writeToConnection(raw, frame);
    }
  }

  subscriber.on("message", (_channel: string, message: string) => {
    enqueue(() => broadcastFeedUpdate(message));
  });

  fastify.addHook("onClose", async () => {
    await subscriber.quit().catch(() => {});
  });

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
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });

      // Flush an initial comment so the client sees the connection is open
      reply.raw.write(": connected\n\n");

      const rawLastEventId = request.headers["last-event-id"];
      const lastEventId = Array.isArray(rawLastEventId)
        ? rawLastEventId[0]
        : rawLastEventId;

      const heartbeat = setInterval(() => {
        writeToConnection(reply.raw, ": heartbeat\n\n");
      }, 30_000);

      enqueue(() => {
        if (lastEventId) {
          const missed = eventsAfter(eventBuffer, lastEventId);
          if (missed) {
            writeToConnection(reply.raw, `event: control\ndata: {"type":"resumed"}\n\n`);
            for (const event of missed) {
              writeToConnection(reply.raw, event.frame);
            }
          } else {
            writeToConnection(reply.raw, `event: control\ndata: {"type":"reset"}\n\n`);
          }
        }
        connections.add(reply.raw);
      });

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        connections.delete(reply.raw);
      });
    }
  );
};
