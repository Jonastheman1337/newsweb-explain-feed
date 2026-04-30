import { cookies } from "next/headers";
import { getApiBaseUrl } from "../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../lib/session-cookie";

export const dynamic = "force-dynamic";

const API_BASE_URL = getApiBaseUrl();

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const upstream = await fetch(`${API_BASE_URL}/feed/stream`, {
    headers,
    cache: "no-store"
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Feed stream unavailable", { status: upstream.status });
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
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
