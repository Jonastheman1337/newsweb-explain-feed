import { cookies } from "next/headers";
import { getApiBaseUrl } from "../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../lib/session-cookie";

export const dynamic = "force-dynamic";

const API_BASE_URL = getApiBaseUrl();

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no"
} as const;

const UNAVAILABLE_RETRY_MS = 5_000;

/**
 * EventSource never reconnects after a non-200 response, so upstream
 * failures must not surface as HTTP errors. Instead return a 200 stream
 * that ends immediately with a retry hint; the browser then keeps
 * reconnecting on its own until the API is reachable again.
 */
function unavailableResponse(): Response {
  return new Response(`retry: ${UNAVAILABLE_RETRY_MS}\n\n`, {
    headers: SSE_HEADERS
  });
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Browser-native reconnects send the header; hook-managed reconnects can
  // only pass a query param (manually created EventSources cannot set headers).
  const lastEventId =
    request.headers.get("last-event-id") ??
    new URL(request.url).searchParams.get("lastEventId");
  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/feed/stream`, {
      headers,
      cache: "no-store"
    });
  } catch {
    return unavailableResponse();
  }

  if (!upstream.ok || !upstream.body) {
    return unavailableResponse();
  }

  // Pipe the upstream SSE stream through to the client.
  // We create a new ReadableStream that reads from the upstream body
  // to ensure Next.js doesn't buffer the response.
  const reader = upstream.body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel().catch(() => {});
    }
  });

  return new Response(stream, {
    headers: SSE_HEADERS
  });
}
