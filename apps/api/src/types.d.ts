import type { Queue } from "bullmq";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { AppConfig } from "./config.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    redis: Redis;
    rewriteQueue: Queue;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
