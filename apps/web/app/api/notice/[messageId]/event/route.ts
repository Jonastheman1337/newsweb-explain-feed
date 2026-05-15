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

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const body = await request.json();
  const response = await fetch(`${API_BASE_URL}/notice/${messageId}/event`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return NextResponse.json(
      { message: "Kunne ikke lagre hendelse." },
      { status: response.status }
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
