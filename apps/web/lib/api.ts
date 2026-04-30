import type { FeedQuery, FeedResponse, RewriteOutput } from "@newsweb/shared";
import { getApiBaseUrl } from "./api-base-url";

const API_BASE_URL = getApiBaseUrl();

function createUrl(path: string, params?: Record<string, string | undefined>): string {
  if (typeof window !== "undefined") {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`/api${normalizedPath}`, window.location.origin);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(normalizedPath, base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

export async function apiGet<T>(
  token: string | null | undefined,
  path: string,
  params?: Record<string, string | undefined>
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(createUrl(path, params), {
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function getFeed(token: string | null | undefined, query: Partial<FeedQuery>) {
  return apiGet<FeedResponse>(token, "/feed", {
    cursor: query.cursor,
    limit: query.limit ? String(query.limit) : undefined,
    market: query.market,
    category: query.category,
    issuer: query.issuer,
    q: query.q
  });
}

type NoticeSource = {
  messageId: number;
  title: string;
  issuerName: string;
  issuerSign: string;
  publishedAt: string;
  categories: string[];
  markets: string[];
  bodyText: string;
  hasAttachments: boolean;
};

type RewriteVersion = {
  version: number;
  rewrite: RewriteOutput;
  userInstruction: string | null;
  generatedAt: string;
};

type NoticeResponse =
  | { source: NoticeSource; rewrite: RewriteOutput; rewrites?: RewriteVersion[]; skipped?: false; processing?: false }
  | { source: NoticeSource; skipped: true }
  | { source: NoticeSource; processing: true };

export async function getNotice(token: string | null | undefined, messageId: number) {
  return apiGet<NoticeResponse>(token, `/notice/${messageId}`);
}

export async function getMetaFilters(token: string | null | undefined) {
  return apiGet<{
    categories: Array<{ id: number; categoryNo: string; categoryEn: string }>;
    markets: Array<{ id: number; symbol: string; name: string }>;
    issuers: Array<{ issuerId: number; symbol: string; name: string }>;
  }>(token, "/meta/filters");
}

export async function requestMagicLink(email: string): Promise<{
  ok: true;
  bypassLogin?: {
    sessionToken: string;
    user: {
      id: string;
      email: string;
    };
  };
}> {
  const response = await fetch(createUrl("/auth/request-magic-link"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email })
  });

  if (!response.ok) {
    throw new Error("Kunne ikke sende innloggingslenke.");
  }

  return response.json() as Promise<{
    ok: true;
    bypassLogin?: {
      sessionToken: string;
      user: {
        id: string;
        email: string;
      };
    };
  }>;
}

export async function loginWithPassword(username: string, password: string): Promise<{
  sessionToken: string;
  user: { id: string; username: string };
}> {
  const response = await fetch(createUrl("/auth/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });

  if (!response.ok) {
    throw new Error("Innlogging feilet.");
  }

  return response.json() as Promise<{
    sessionToken: string;
    user: { id: string; username: string };
  }>;
}

export async function verifyMagicLink(token: string): Promise<{
  sessionToken: string;
  user: { id: string; email: string };
}> {
  const response = await fetch(createUrl("/auth/verify-magic-link"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token })
  });

  if (!response.ok) {
    throw new Error("Innlogging feilet.");
  }

  return response.json() as Promise<{
    sessionToken: string;
    user: { id: string; email: string };
  }>;
}
