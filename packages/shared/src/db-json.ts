import type { Prisma } from "@prisma/client";

const POSTGRES_NULL_CHARACTER = /\u0000/g;

export function stripPostgresNullCharacters(value: string): string {
  return value.includes("\0")
    ? value.replace(POSTGRES_NULL_CHARACTER, "")
    : value;
}

export function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value ?? null, (_key, nestedValue) =>
    typeof nestedValue === "string"
      ? stripPostgresNullCharacters(nestedValue)
      : nestedValue
  );
  return JSON.parse(serialized ?? "null") as Prisma.InputJsonValue;
}

