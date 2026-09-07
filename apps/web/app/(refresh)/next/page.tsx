import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFeed, getMetaFilters, getMutedCategories, isApiAuthError } from "../../../lib/api";
import { getSessionToken } from "../../../lib/session";
import { FeedConnection } from "../../../components/refresh/feed-connection";
import { Preferences } from "../../../components/refresh/preferences";
import { RefreshFeed } from "../../../components/refresh/refresh-feed";
import styles from "../../../components/refresh/refresh.module.css";

import { readUiFeatures } from "../../../lib/ui-features";

type Params = {
  q?: string;
  market?: string;
  category?: string;
  issuer?: string;
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
        <div className={styles.heading}>
          <h1>Børsmeldinger</h1>
          <div className={styles.headingTools}>
            <FeedConnection fixtures={process.env.UI_PREVIEW_FIXTURES === "true"} />
            <Preferences
              categories={filters.categories.map((category) => category.categoryNo)}
              defaultMuted={muted.mutedCategories}
            />
          </div>
        </div>
        <form className={styles.filters} action="/next">
          <div className={styles.search}>
            <input
              name="q"
              aria-label="Søk i børsmeldinger"
              placeholder="Søk"
              defaultValue={params.q}
            />
            <button type="submit">Søk</button>
          </div>
          <details open={!!(params.market || params.category || params.issuer)}>
            <summary>Filter</summary>
            <div className={styles.filterFields}>
              <select name="market" aria-label="Marked" defaultValue={params.market ?? ""}>
                <option value="">Alle markeder</option>
                {filters.markets.map((m) => (
                  <option key={m.id} value={m.symbol}>
                    {m.name}
                  </option>
                ))}
              </select>
              <select name="category" aria-label="Kategori" defaultValue={params.category ?? ""}>
                <option value="">Alle kategorier</option>
                {filters.categories.map((c) => (
                  <option key={c.id} value={c.categoryNo}>
                    {c.categoryNo}
                  </option>
                ))}
              </select>
              <select name="issuer" aria-label="Utsteder" defaultValue={params.issuer ?? ""}>
                <option value="">Alle utstedere</option>
                {filters.issuers.map((i) => (
                  <option key={i.issuerId} value={i.symbol}>
                    {i.name}
                  </option>
                ))}
              </select>
              <button type="submit">Vis</button>
              <Link href="/next">Nullstill</Link>
            </div>
          </details>
        </form>
        <RefreshFeed
          key={JSON.stringify(params)}
          initialItems={feed.items}
          mutedCategories={muted.mutedCategories}
          filtered={Object.values(params).some(Boolean)}
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
