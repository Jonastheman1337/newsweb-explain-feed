import {
  CACHE_KEYS,
  META_CACHE_TTL_SECONDS,
  newswebMetaCategoriesSchema,
  newswebMetaIssuersSchema,
  newswebMetaMarketsSchema
} from "@newsweb/shared";
import type { Redis } from "ioredis";

const NEWSWEB_BASE_URL = "https://api3.oslo.oslobors.no/v1/newsreader";

type MetaFilters = {
  categories: Array<{ id: number; categoryNo: string; categoryEn: string }>;
  markets: Array<{ id: number; symbol: string; name: string }>;
  issuers: Array<{ issuerId: number; symbol: string; name: string }>;
};

type ParsedIssuer = {
  issuerId?: number | null;
  symbol?: string | null;
  name?: string | null;
};

async function postJson(path: string): Promise<unknown> {
  const response = await fetch(`${NEWSWEB_BASE_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Newsweb ${path} failed with ${response.status}`);
  }

  return response.json();
}

export async function getMetaFilters(redis: Redis): Promise<MetaFilters> {
  const cached = await redis.get(CACHE_KEYS.metaFilters);
  if (cached) {
    return JSON.parse(cached) as MetaFilters;
  }

  const [rawCategories, rawMarkets, rawIssuers] = await Promise.all([
    postJson("categories"),
    postJson("markets"),
    postJson("issuers")
  ]);

  const categories = newswebMetaCategoriesSchema.parse(rawCategories).data.categories;
  const markets = newswebMetaMarketsSchema.parse(rawMarkets).data.markets;
  const issuers = newswebMetaIssuersSchema.parse(rawIssuers).data.issuers;

  const payload: MetaFilters = {
    categories: categories.map((item) => ({
      id: item.id,
      categoryNo: item.category_no,
      categoryEn: item.category_en
    })),
    markets: markets.map((item) => ({
      id: item.id,
      symbol: item.symbol,
      name: item.name
    })),
    issuers: issuers
      .filter(
        (item: ParsedIssuer): item is { issuerId: number; symbol: string; name: string } =>
          typeof item.issuerId === "number" &&
          typeof item.symbol === "string" &&
          item.symbol.trim().length > 0 &&
          typeof item.name === "string" &&
          item.name.trim().length > 0
      )
      .map((item) => ({
        issuerId: item.issuerId,
        symbol: item.symbol,
        name: item.name
      }))
  };

  await redis.set(
    CACHE_KEYS.metaFilters,
    JSON.stringify(payload),
    "EX",
    META_CACHE_TTL_SECONDS
  );

  return payload;
}
