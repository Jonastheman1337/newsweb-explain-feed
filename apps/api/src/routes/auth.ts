import { timingSafeEqual } from "node:crypto";
import {
  passwordLoginInputSchema,
  requestMagicLinkInputSchema,
  verifyMagicLinkInputSchema
} from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
import type { FastifyPluginAsync } from "fastify";
import { createMagicToken, sha256 } from "../utils/hash.js";
import { sendMail } from "../services/mailer.js";

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

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/auth/login", async (request, reply) => {
    const body = passwordLoginInputSchema.parse(request.body);
    const expectedUsername = fastify.config.LOGIN_USERNAME;
    const expectedPassword = fastify.config.LOGIN_PASSWORD;

    if (!expectedUsername || !expectedPassword) {
      return reply.code(503).send({ message: "Passordinnlogging er ikke konfigurert." });
    }

    if (!safeEqual(body.username, expectedUsername) || !safeEqual(body.password, expectedPassword)) {
      return reply.code(401).send({ message: "Ugyldig brukernavn eller passord." });
    }

    const sessionToken = await reply.jwtSign(
      {
        sub: `login:${expectedUsername}`,
        username: expectedUsername
      },
      {
        expiresIn: "7d"
      }
    );

    return reply.send({
      sessionToken,
      user: {
        id: expectedUsername,
        username: expectedUsername
      }
    });
  });

  fastify.post("/auth/request-magic-link", async (request, reply) => {
    const body = requestMagicLinkInputSchema.parse(request.body);
    const email = body.email.toLowerCase();

    const hostHeader =
      (request.headers["x-forwarded-host"] as string | undefined) ??
      request.headers.host;
    const allowDevBypass =
      fastify.config.NODE_ENV !== "production" &&
      fastify.config.DEV_AUTH_BYPASS &&
      isLocalHostRequest(hostHeader);

    if (allowDevBypass) {
      const now = new Date();
      const user = await prisma.user.upsert({
        where: { email },
        create: {
          email,
          lastLoginAt: now
        },
        update: {
          lastLoginAt: now
        }
      });

      await prisma.invite.upsert({
        where: { email },
        create: {
          email,
          acceptedAt: now
        },
        update: {
          acceptedAt: now
        }
      });

      const sessionToken = await reply.jwtSign(
        {
          sub: user.id,
          email: user.email
        },
        {
          expiresIn: "7d"
        }
      );

      return reply.send({
        ok: true,
        bypassLogin: {
          sessionToken,
          user: {
            id: user.id,
            email: user.email
          }
        }
      });
    }

    const invite = await prisma.invite.findUnique({
      where: { email }
    });

    // Do not expose invite status.
    if (!invite) {
      return reply.send({ ok: true });
    }

    const token = createMagicToken();
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

    await prisma.invite.update({
      where: { email },
      data: {
        tokenHash,
        expiresAt
      }
    });

    const link = `${fastify.config.MAGIC_LINK_BASE_URL}?token=${token}`;
    await sendMail(fastify.config, fastify.log, {
      to: email,
      subject: "Din innloggingslenke",
      text: `Klikk for å logge inn: ${link}\nLenken utløper ${expiresAt.toISOString()}.`
    });

    return reply.send({ ok: true });
  });

  fastify.post("/auth/verify-magic-link", async (request, reply) => {
    const body = verifyMagicLinkInputSchema.parse(request.body);
    const tokenHash = sha256(body.token);
    const now = new Date();

    const invite = await prisma.invite.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: now }
      }
    });

    if (!invite) {
      return reply.code(401).send({ message: "Ugyldig eller utløpt token." });
    }

    const user = await prisma.user.upsert({
      where: { email: invite.email },
      create: {
        email: invite.email,
        lastLoginAt: now
      },
      update: {
        lastLoginAt: now
      }
    });

    await prisma.invite.update({
      where: { email: invite.email },
      data: {
        acceptedAt: now,
        tokenHash: null,
        expiresAt: null
      }
    });

    const sessionToken = await reply.jwtSign(
      {
        sub: user.id,
        email: user.email
      },
      {
        expiresIn: "7d"
      }
    );

    return reply.send({
      sessionToken,
      user: {
        id: user.id,
        email: user.email
      }
    });
  });
};
