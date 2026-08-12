/**
 * One-time backfill: repair double-encoded UTF-8 in stored category arrays.
 *
 * Rows ingested before the worker started fixing Newsweb's double-encoding
 * still hold mojibake in source_notices.categories_json (e.g. "Ã…RSRAPPORTER"),
 * so the category filter and mute list can never match them. This rewrites
 * every affected row using the same fixDoubleEncodedUtf8 as ingest.
 *
 * Usage: npx tsx apps/worker/src/scripts/fix-category-encoding.ts [--dry-run]
 */
import { fixDoubleEncodedUtf8 } from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";

const dryRun = process.argv.includes("--dry-run");
const BATCH_SIZE = 500;

async function main() {
  let cursor: number | undefined;
  let scanned = 0;
  let fixed = 0;

  for (;;) {
    const rows = await prisma.sourceNotice.findMany({
      select: { messageId: true, categoriesJson: true },
      orderBy: { messageId: "asc" },
      take: BATCH_SIZE,
      ...(cursor != null
        ? { cursor: { messageId: cursor }, skip: 1 }
        : {})
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].messageId;
    scanned += rows.length;

    for (const row of rows) {
      if (!Array.isArray(row.categoriesJson)) continue;
      const categories = row.categoriesJson.filter(
        (value): value is string => typeof value === "string"
      );
      const repaired = categories.map(fixDoubleEncodedUtf8);
      const changed = repaired.some((value, index) => value !== categories[index]);
      if (!changed) continue;

      fixed += 1;
      if (dryRun) {
        console.log(
          `[dry-run] ${row.messageId}: ${JSON.stringify(categories)} -> ${JSON.stringify(repaired)}`
        );
      } else {
        await prisma.sourceNotice.update({
          where: { messageId: row.messageId },
          data: { categoriesJson: repaired }
        });
        console.log(`fixed ${row.messageId}`);
      }
    }
  }

  console.log(
    `\nScanned ${scanned} notices; ${dryRun ? "would fix" : "fixed"} ${fixed} with mojibake categories`
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
