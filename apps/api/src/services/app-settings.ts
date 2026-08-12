import { toPrismaJsonValue } from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
import { z } from "zod";

const MUTED_CATEGORIES_KEY = "mutedCategories";

// A corrupt stored value degrades to "nothing muted", never a 500.
const mutedCategoriesValueSchema = z.array(z.string()).catch([]);

export async function getMutedCategories(): Promise<string[]> {
  const row = await prisma.appSetting.findUnique({
    where: { key: MUTED_CATEGORIES_KEY }
  });
  if (!row) {
    return [];
  }
  return mutedCategoriesValueSchema.parse(row.valueJson);
}

export async function setMutedCategories(values: string[]): Promise<string[]> {
  const deduped = [...new Set(values)];
  await prisma.appSetting.upsert({
    where: { key: MUTED_CATEGORIES_KEY },
    create: { key: MUTED_CATEGORIES_KEY, valueJson: toPrismaJsonValue(deduped) },
    update: { valueJson: toPrismaJsonValue(deduped) }
  });
  return deduped;
}
