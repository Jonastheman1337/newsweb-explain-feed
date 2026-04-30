import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../../lib/session-cookie";

const API_BASE_URL = getApiBaseUrl();

export async function POST(
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

  // Forward request body (may contain instruction)
  let body: string | undefined;
  try {
    const json = await request.json();
    if (json && typeof json === "object") {
      body = JSON.stringify(json);
      headers["Content-Type"] = "application/json";
    }
  } catch {
    // No body or invalid JSON — that's fine (backward compat with ReprocessButton)
  }

  const response = await fetch(
    `${API_BASE_URL}/notice/${messageId}/generate`,
    {
      method: "POST",
      headers,
      ...(body ? { body } : {})
    }
  );

  if (!response.ok) {
    return NextResponse.json(
      { message: "Kunne ikke starte generering." },
      { status: response.status }
    );
  }

  const responseBody = await response.json();
  return NextResponse.json(responseBody);
}
