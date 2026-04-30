import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({
  messageId: z.coerce.number().int().positive()
});

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/admin/reprocess/:messageId", async (request, reply) => {
    const adminKey = request.headers["x-admin-key"];
    if (!adminKey || adminKey !== fastify.config.ADMIN_API_KEY) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const { messageId } = paramsSchema.parse(request.params);

    await fastify.rewriteQueue.add(
      "rewrite-manual",
      {
        messageId,
        reason: "manual-reprocess"
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000
        },
        removeOnComplete: 2000,
        removeOnFail: 2000
      }
    );

    return reply.send({ queued: true });
  });
};
