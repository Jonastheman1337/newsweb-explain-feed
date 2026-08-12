import {
  mutedCategoriesResponseSchema,
  mutedCategoriesUpdateSchema
} from "@newsweb/shared";
import type { FastifyPluginAsync } from "fastify";
import { getMutedCategories, setMutedCategories } from "../services/app-settings.js";

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/settings/muted-categories",
    { preHandler: fastify.authenticate },
    async (_request, reply) => {
      const mutedCategories = await getMutedCategories();
      return reply.send(mutedCategoriesResponseSchema.parse({ mutedCategories }));
    }
  );

  fastify.put(
    "/settings/muted-categories",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const body = mutedCategoriesUpdateSchema.parse(request.body);
      const mutedCategories = await setMutedCategories(body.mutedCategories);
      return reply.send(mutedCategoriesResponseSchema.parse({ mutedCategories }));
    }
  );
};
