import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../lib/api-base-url";

export const dynamic = "force-dynamic";

const API_BASE_URL = getApiBaseUrl();
const API_HEALTH_TIMEOUT_MS = 5_000;

async function fetchApiHealth(): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, API_HEALTH_TIMEOUT_MS);

  try {
    return await fetch(`${API_BASE_URL}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  try {
    const upstream = await fetchApiHealth();
    const payload = (await upstream.json().catch(() => null)) as {
      ok?: unknown;
    } | null;
    const ok = upstream.ok && payload?.ok === true;

    return NextResponse.json(payload ?? { ok: false, api: "down" }, {
      status: ok ? 200 : 503
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        api: "down",
        error:
          error instanceof Error && error.name === "AbortError"
            ? "API_HEALTH_TIMEOUT"
            : "API_HEALTH_UNAVAILABLE"
      },
      { status: 503 }
    );
  }
}
