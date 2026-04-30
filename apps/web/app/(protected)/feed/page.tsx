import Link from "next/link";
import { redirect } from "next/navigation";
import { BackButton } from "../../../components/back-button";
import { LiveFeedList } from "../../../components/live-feed-list";
import { SearchableSelect } from "../../../components/searchable-select";
import { getFeed, getMetaFilters } from "../../../lib/api";
import { getSessionToken } from "../../../lib/session";

type FeedData = Awaited<ReturnType<typeof getFeed>>;

type FeedPageProps = {
  searchParams: Promise<{
    cursor?: string;
    limit?: string;
    market?: string;
    category?: string;
    issuer?: string;
    q?: string;
  }>;
};

function withParams(
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
): string {
  const url = new URL("http://localhost/feed");
  const merged = { ...params, ...overrides };
  Object.entries(merged).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return `/feed?${url.searchParams.toString()}`;
}

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const params = await searchParams;
  const token = await getSessionToken();
  if (!token) {
    redirect("/login");
  }

  const normalized = {
    cursor: params.cursor || undefined,
    market: params.market || undefined,
    category: params.category || undefined,
    issuer: params.issuer || undefined,
    q: params.q || undefined
  };
  const requestedQuery = {
    cursor: normalized.cursor,
    limit: params.limit ? Number(params.limit) : 30,
    market: normalized.market,
    category: normalized.category,
    issuer: normalized.issuer,
    q: normalized.q
  };

  const [feedResult, filtersResult] = await Promise.allSettled([
    getFeed(token, requestedQuery),
    getMetaFilters(token)
  ]);

  let feedUnavailable = false;
  let feed: FeedData = {
    items: [],
    nextCursor: null
  };

  if (feedResult.status === "fulfilled") {
    feed = feedResult.value;
  } else if (requestedQuery.cursor) {
    try {
      feed = await getFeed(token, { ...requestedQuery, cursor: undefined });
    } catch {
      feedUnavailable = true;
    }
  } else {
    feedUnavailable = true;
  }

  const filters =
    filtersResult.status === "fulfilled"
      ? filtersResult.value
      : { categories: [], markets: [], issuers: [] };

  if (!feedUnavailable && feed.items.length === 0 && requestedQuery.cursor) {
    try {
      feed = await getFeed(token, {
        ...requestedQuery,
        cursor: undefined
      });
    } catch {
      feedUnavailable = true;
      feed = {
        items: [],
        nextCursor: null
      };
    }
  }

  return (
    <section>
      <form className="panel filterGrid" method="get">
        <input type="text" name="q" placeholder="Sok i tittel eller tekst" defaultValue={params.q} />
        <SearchableSelect
          name="market"
          placeholder="Alle markeder"
          searchPlaceholder="Sok etter marked..."
          defaultValue={params.market}
          options={filters.markets.map((m) => ({
            value: m.symbol,
            label: `${m.symbol} - ${m.name}`
          }))}
        />
        <SearchableSelect
          name="category"
          placeholder="Alle kategorier"
          searchPlaceholder="Sok etter kategori..."
          defaultValue={params.category}
          options={filters.categories.map((c) => ({
            value: c.categoryNo,
            label: c.categoryNo
          }))}
        />
        <SearchableSelect
          name="issuer"
          placeholder="Alle utstedere"
          searchPlaceholder="Sok etter utsteder..."
          defaultValue={params.issuer}
          options={filters.issuers.map((i) => ({
            value: i.symbol,
            label: `${i.symbol} - ${i.name}`
          }))}
        />
        <button type="submit">Oppdater feed</button>
      </form>

      <div className="feedList">
        {feedUnavailable ? (
          <article className="card">
            <h2>Feed er midlertidig utilgjengelig</h2>
            <p className="muted">
              Sjekk at API, database og Redis kjører, og last siden på nytt.
            </p>
            <Link href="/feed" className="ghostButton" style={{ display: "inline-block" }}>
              Last inn igjen
            </Link>
          </article>
        ) : feed.items.length === 0 ? (
          <article className="card">
            <h2>Ingen saker matcher filtrene</h2>
            <p className="muted">
              Nullstill filtre eller sok for a vise siste borsnyheter.
            </p>
            <Link href="/feed" className="ghostButton" style={{ display: "inline-block" }}>
              Nullstill filtre
            </Link>
          </article>
        ) : (
          <LiveFeedList initialItems={feed.items} filters={normalized} />
        )}
      </div>

      <div className="topBar" style={{ marginTop: "1rem" }}>
        {normalized.cursor ? <BackButton /> : <span />}
        <span className="muted">{feed.items.length} notiser vist</span>
        {feed.nextCursor ? (
          <Link
            className="ghostButton"
            href={withParams(
              {
                market: normalized.market,
                category: normalized.category,
                issuer: normalized.issuer,
                q: normalized.q,
                limit: params.limit
              },
              { cursor: feed.nextCursor }
            )}
          >
            Neste side
          </Link>
        ) : (
          <span className="muted">Ingen flere notiser</span>
        )}
      </div>
    </section>
  );
}
