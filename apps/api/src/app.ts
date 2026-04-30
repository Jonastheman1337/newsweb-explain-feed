import { QUEUE_NAMES, parseRedisUrl } from "@newsweb/shared";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { Queue } from "bullmq";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { feedRoutes } from "./routes/feed.js";
import { feedStreamRoutes } from "./routes/feed-stream.js";
import { healthRoutes } from "./routes/health.js";
import { metaRoutes } from "./routes/meta.js";
import { noticeRoutes } from "./routes/notice.js";

function isLocalHostRequest(hostHeader?: string): boolean {
  if (!hostHeader) {
    return false;
  }

  const host = hostHeader.split(",")[0]?.trim().toLowerCase() ?? "";
  return (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]") ||
    host.startsWith("::1")
  );
}

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug"
    }
  });

  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null
  });
  const rewriteQueue = new Queue(QUEUE_NAMES.rewrite, {
    connection: parseRedisUrl(config.REDIS_URL)
  });

  app.decorate("config", config);
  app.decorate("redis", redis);
  app.decorate("rewriteQueue", rewriteQueue);

  await app.register(cors, {
    origin: true,
    credentials: true
  });
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.SESSION_SECRET
  });

  app.decorate("authenticate", async (request, reply) => {
    const hostHeader =
      (request.headers["x-forwarded-host"] as string | undefined) ??
      request.headers.host;
    const allowDevBypass =
      config.NODE_ENV !== "production" &&
      config.DEV_AUTH_BYPASS &&
      isLocalHostRequest(hostHeader);

    if (allowDevBypass) {
      return;
    }

    try {
      await request.jwtVerify();
    } catch {
      await reply.code(401).send({ message: "Uautorisert." });
    }
  });

  await app.register(authRoutes);
  await app.register(feedRoutes);
  await app.register(feedStreamRoutes);
  await app.register(noticeRoutes);
  await app.register(metaRoutes);
  await app.register(adminRoutes);
  await app.register(healthRoutes);

  app.addHook("onClose", async () => {
    await rewriteQueue.close();
    await redis.quit();
  });

  return app;
}
