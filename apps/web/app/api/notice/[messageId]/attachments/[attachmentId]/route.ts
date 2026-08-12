import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../../../lib/session-cookie";

const API_BASE_URL = getApiBaseUrl();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string; attachmentId: string }> }
) {
  const { messageId, attachmentId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `${API_BASE_URL}/notice/${messageId}/attachments/${attachmentId}`,
    {
      headers,
      cache: "no-store"
    }
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return NextResponse.json(
      { message: body?.message ?? "Kunne ikke laste ned vedlegg." },
      { status: response.status }
    );
  }

  const responseHeaders = new Headers();
  for (const header of [
    "content-type",
    "content-length",
    "content-disposition",
    "cache-control"
  ]) {
    const value = response.headers.get(header);
    if (value) {
      responseHeaders.set(header, value);
    }
  }
  responseHeaders.set("cache-control", "private, no-store");

  return new Response(response.body ?? (await response.arrayBuffer()), {
    status: response.status,
    headers: responseHeaders
  });
}
