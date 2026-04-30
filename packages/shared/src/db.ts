import { PrismaClient } from "@prisma/client";

type GlobalForPrisma = typeof globalThis & {
  __newsweb_prisma__?: PrismaClient;
};

const globalForPrisma = globalThis as GlobalForPrisma;

export const prisma =
  globalForPrisma.__newsweb_prisma__ ??
  new PrismaClient({
    log: ["warn", "error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__newsweb_prisma__ = prisma;
}
