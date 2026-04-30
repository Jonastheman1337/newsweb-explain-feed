import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../../lib/session-cookie";

const API_BASE_URL = getApiBaseUrl();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(`${API_BASE_URL}/notice/${messageId}/status`);
  const jobId = requestUrl.searchParams.get("jobId");
  if (jobId) {
    upstreamUrl.searchParams.set("jobId", jobId);
  }

  const response = await fetch(upstreamUrl, { headers, cache: "no-store" });

  if (!response.ok) {
    return NextResponse.json(
      { ready: false, generatedAt: null },
      { status: response.status }
    );
  }

  const body = await response.json();
  return NextResponse.json(body);
}
