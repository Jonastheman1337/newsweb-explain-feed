import Link from "next/link";
import { redirect } from "next/navigation";
import { BackButton } from "../../../components/back-button";
import { FeedUrlCleanup } from "../../../components/feed-url-cleanup";
import { LiveFeedList } from "../../../components/live-feed-list";
import { MuteCategoriesSelect } from "../../../components/mute-categories-select";
import { SearchableSelect } from "../../../components/searchable-select";
import {
  getFeed,
  getMetaFilters,
  getMutedCategories,
  isApiAuthError
} from "../../../lib/api";
import { formatCategoryLabel } from "../../../lib/format-category";
import { getSessionToken } from "../../../lib/session";

type FeedData = Awaited<ReturnType<typeof getFeed>>;

const RATE_FIXING_CATEGORY = "RENTEREGULERING";
const RATE_FIXING_MUTE_OPTION = {
  value: RATE_FIXING_CATEGORY,
  label: "Rentefastsettelser"
};

type FeedPageProps = {
  searchParams: Promise<{
    cursor?: string;
    cursorId?: string;
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
    cursorId: params.cursorId || undefined,
    market: params.market || undefined,
    category: params.category || undefined,
    issuer: params.issuer || undefined,
    q: params.q || undefined
  };
  const requestedQuery = {
    cursor: normalized.cursor,
    cursorId: normalized.cursorId ? Number(normalized.cursorId) : undefined,
    limit: params.limit ? Number(params.limit) : 30,
    market: normalized.market,
    category: normalized.category,
    issuer: normalized.issuer,
    q: normalized.q
  };

  const [feedResult, filtersResult, mutedResult] = await Promise.allSettled([
    getFeed(token, requestedQuery),
    getMetaFilters(token),
    getMutedCategories(token)
  ]);

  if (
    (feedResult.status === "rejected" && isApiAuthError(feedResult.reason)) ||
    (filtersResult.status === "rejected" && isApiAuthError(filtersResult.reason))
  ) {
    redirect("/login");
  }

  let feedUnavailable = false;
  let feed: FeedData = {
    items: [],
    nextCursor: null,
    nextCursorId: null
  };

  if (feedResult.status === "fulfilled") {
    feed = feedResult.value;
  } else if (requestedQuery.cursor) {
    try {
      feed = await getFeed(token, {
        ...requestedQuery,
        cursor: undefined,
        cursorId: undefined
      });
    } catch (error) {
      if (isApiAuthError(error)) {
        redirect("/login");
      }
      feedUnavailable = true;
    }
  } else {
    feedUnavailable = true;
  }

  const filters =
    filtersResult.status === "fulfilled"
      ? filtersResult.value
      : { categories: [], markets: [], issuers: [] };

  const mutedCategories =
    mutedResult.status === "fulfilled" ? mutedResult.value.mutedCategories : [];

  if (!feedUnavailable && feed.items.length === 0 && requestedQuery.cursor) {
    try {
      feed = await getFeed(token, {
        ...requestedQuery,
        cursor: undefined,
        cursorId: undefined
      });
    } catch (error) {
      if (isApiAuthError(error)) {
        redirect("/login");
      }
      feedUnavailable = true;
      feed = {
        items: [],
        nextCursor: null,
        nextCursorId: null
      };
    }
  }

  return (
    <section>
      <form className="panel filterGrid" method="get">
        <input
          type="text"
          name="q"
          placeholder="Søk i tittel eller tekst"
          defaultValue={params.q ?? ""}
        />
        <SearchableSelect
          name="market"
          placeholder="Alle markeder"
          searchPlaceholder="Søk etter marked..."
          defaultValue={params.market}
          options={filters.markets.map((m) => ({
            value: m.symbol,
            label: `${m.symbol} - ${m.name}`
          }))}
        />
        <SearchableSelect
          name="category"
          placeholder="Alle kategorier"
          searchPlaceholder="Søk etter kategori..."
          defaultValue={params.category}
          options={filters.categories.map((c) => ({
            value: c.categoryNo,
            label: formatCategoryLabel(c.categoryNo)
          }))}
        />
        <SearchableSelect
          name="issuer"
          placeholder="Alle utstedere"
          searchPlaceholder="Søk etter utsteder..."
          defaultValue={params.issuer}
          options={filters.issuers.map((i) => ({
            value: i.symbol,
            label: `${i.symbol} - ${i.name}`
          }))}
        />
        <MuteCategoriesSelect
          defaultMuted={mutedCategories}
          options={[
            RATE_FIXING_MUTE_OPTION,
            ...filters.categories
              .filter((c) => c.categoryNo !== RATE_FIXING_CATEGORY)
              .map((c) => ({
                value: c.categoryNo,
                label: formatCategoryLabel(c.categoryNo)
              }))
          ]}
        />
        <button type="submit">Oppdater feed</button>
      </form>
      <FeedUrlCleanup />

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
        ) : (
          <LiveFeedList
            initialItems={feed.items}
            filters={normalized}
            mutedCategories={mutedCategories}
            emptyState={
              <article className="card">
                <h2>Ingen saker matcher filtrene</h2>
                <p className="muted">
                  Nullstill filtre eller søk for å vise siste børsnyheter.
                </p>
                <Link href="/feed" className="ghostButton" style={{ display: "inline-block" }}>
                  Nullstill filtre
                </Link>
              </article>
            }
            emptyStateUnfiltered={
              <article className="card">
                <h2>Ingen notiser å vise ennå</h2>
                <p className="muted">Nye børsmeldinger dukker opp her automatisk.</p>
              </article>
            }
          />
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
                q: normalized.q,
                market: normalized.market,
                category: normalized.category,
                issuer: normalized.issuer,
                limit: params.limit
              },
              {
                cursor: feed.nextCursor,
                cursorId:
                  feed.nextCursorId != null ? String(feed.nextCursorId) : undefined
              }
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
