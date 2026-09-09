import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFeed, getMetaFilters, getMutedCategories, isApiAuthError } from "../../../lib/api";
import { getSessionToken } from "../../../lib/session";
import { RefreshFilters, type RefreshFilterValues } from "../../../components/refresh/filters";
import { RefreshFeed } from "../../../components/refresh/refresh-feed";
import { formatCategoryLabel } from "../../../lib/format-category";
import styles from "../../../components/refresh/refresh.module.css";

import { readUiFeatures } from "../../../lib/ui-features";

type Params = RefreshFilterValues & {
  cursor?: string;
  cursorId?: string;
};
export default async function RefreshPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!readUiFeatures(process.env).uiV2) notFound();
  const params = await searchParams;
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/next");
  try {
    const [feed, filters, muted] = await Promise.all([
      getFeed(token, {
        ...params,
        ui: "v2",
        cursorId: params.cursorId ? Number(params.cursorId) : undefined,
        limit: 30
      }),
      getMetaFilters(token),
      getMutedCategories(token)
    ]);
    const next = new URLSearchParams(
      Object.entries(params).filter((entry): entry is [string, string] => !!entry[1])
    );
    if (feed.nextCursor) next.set("cursor", feed.nextCursor);
    if (feed.nextCursorId != null) next.set("cursorId", String(feed.nextCursorId));
    return (
      <>
        <h1 className={styles.visuallyHidden}>Børsmeldinger</h1>
        <RefreshFilters
          key={`filters:${JSON.stringify(params)}`}
          params={params}
          markets={filters.markets.map((market) => ({ value: market.symbol, label: market.name }))}
          categories={filters.categories.map((category) => ({ value: category.categoryNo, label: formatCategoryLabel(category.categoryNo) }))}
          issuers={filters.issuers.map((issuer) => ({ value: issuer.symbol, label: `${issuer.name} (${issuer.symbol})` }))}
          mutedCategories={muted.mutedCategories}
        />
        <RefreshFeed
          key={JSON.stringify(params)}
          initialItems={feed.items}
          mutedCategories={muted.mutedCategories}
          filtered={Object.entries(params).some(([key, value]) => key !== "important" && key !== "generated" && !!value)}
        />
        {feed.nextCursor && (
          <Link className={styles.nextPage} href={`/next?${next}`}>
            Eldre meldinger
          </Link>
        )}
      </>
    );
  } catch (error) {
    if (isApiAuthError(error)) redirect("/login?next=/next");
    return (
      <section className={styles.empty}>
        <h1>Feed utilgjengelig</h1>
        <Link href="/next">Prøv igjen</Link>
      </section>
    );
  }
}
