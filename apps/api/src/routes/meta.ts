import type { FastifyPluginAsync } from "fastify";
import { getMetaFilters } from "../services/newsweb-meta.js";

export const metaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/meta/filters",
    {
      preHandler: fastify.authenticate
    },
    async (_request, reply) => {
      const filters = await getMetaFilters(fastify.redis);
      return reply.send(filters);
    }
  );
};

