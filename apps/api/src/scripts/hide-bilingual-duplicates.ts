/**
 * One-time backfill: mark bilingual duplicate rewrites as skipped.
 *
 * Finds pairs of notices from the same issuer published within 10 seconds.
 * For each pair, keeps the first one's rewrite and marks the second one's
 * latest rewrite as "skipped" so it shows as a grayed-out stub in the feed.
 *
 * Usage: npx tsx apps/api/src/scripts/hide-bilingual-duplicates.ts [--dry-run]
 */
import { prisma } from "@newsweb/shared/db";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  // Find bilingual pairs: same issuer, published within 10 seconds,
  // where the second notice has a non-skipped rewrite (i.e. wasn't already caught)
  const pairs = await prisma.$queryRaw<
    Array<{
      a_id: number;
      b_id: number;
      a_title: string;
      b_title: string;
      issuer_sign: string;
    }>
  >`
    SELECT
      a.message_id AS a_id,
      b.message_id AS b_id,
      a.title AS a_title,
      b.title AS b_title,
      a.issuer_sign
    FROM source_notices a
    JOIN source_notices b
      ON a.issuer_sign = b.issuer_sign
      AND a.message_id < b.message_id
      AND ABS(EXTRACT(EPOCH FROM (a.published_at - b.published_at))) < 10
    JOIN feed_items fa ON fa.message_id = a.message_id
    JOIN feed_items fb ON fb.message_id = b.message_id
    WHERE EXISTS (
      SELECT 1 FROM rewrites r
      WHERE r.message_id = b.message_id AND r.status = 'published'
    )
    ORDER BY a.message_id DESC
  `;

  console.log(`Found ${pairs.length} bilingual pairs where the duplicate has a published rewrite\n`);

  let skipped = 0;
  for (const pair of pairs) {
    if (dryRun) {
      console.log(`[dry-run] Would skip rewrite for ${pair.b_id} (${pair.b_title.substring(0, 50)}), keep ${pair.a_id}`);
    } else {
      // Mark the latest rewrite of the duplicate as skipped
      await prisma.rewrite.updateMany({
        where: { messageId: pair.b_id, status: "published" },
        data: { status: "skipped" }
      });
      console.log(`Skipped ${pair.b_id} (${pair.b_title.substring(0, 50)}), kept ${pair.a_id}`);
    }
    skipped++;
  }

  console.log(`\n${dryRun ? "Would skip" : "Skipped"} ${skipped} duplicate rewrites`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
