import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "./api-base-url";
import { SESSION_COOKIE } from "./session-cookie";

// Headers copied from the browser request to the API as-is.
const FORWARDED_HEADERS = ["x-sak-owner"] as const;
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

export type UpstreamBody =
  | { kind: "form"; data: FormData }
  | { kind: "text"; text: string; contentType: string };

/** Upstream URL: API base + path, with the incoming query string forwarded. */
export function buildUpstreamUrl(
  baseUrl: string,
  upstreamPath: string,
  request: Request
): string {
  const url = new URL(`${baseUrl}${upstreamPath}`);
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });
  return url.toString();
}

/**
 * Pure: method, bearer token, forwarded headers and body. Multipart bodies
 * are passed through as FormData so fetch sets the boundary itself.
 */
export function buildUpstreamInit(
  request: Request,
  token: string | null,
  body?: UpstreamBody | null
): RequestInit {
  const method = request.method.toUpperCase();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const init: RequestInit = { method, headers };
  if (method === "GET") {
    init.cache = "no-store";
  }

  if (body && !BODYLESS_METHODS.has(method)) {
    if (body.kind === "form") {
      init.body = body.data as unknown as BodyInit;
    } else {
      headers["Content-Type"] = body.contentType;
      init.body = body.text;
    }
  }

  return init;
}

export async function readUpstreamBody(request: Request): Promise<UpstreamBody | null> {
  if (BODYLESS_METHODS.has(request.method.toUpperCase())) return null;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    return { kind: "form", data: await request.formData() };
  }

  const text = await request.text();
  if (!text) return null;
  return { kind: "text", text, contentType: contentType || "application/json" };
}

/**
 * Forward a browser request to the API and return status and body verbatim,
 * so `{message}` from the API reaches the client unchanged.
 */
export async function proxyToApi(
  request: Request,
  upstreamPath: string
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? null;
  const body = await readUpstreamBody(request);

  let upstream: Response;
  try {
    upstream = await fetch(
      buildUpstreamUrl(getApiBaseUrl(), upstreamPath, request),
      buildUpstreamInit(request, token, body)
    );
  } catch {
    return NextResponse.json({ message: "API-et svarer ikke." }, { status: 502 });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const responseBody = upstream.status === 204 ? null : await upstream.text();
  return new NextResponse(responseBody, { status: upstream.status, headers });
}
