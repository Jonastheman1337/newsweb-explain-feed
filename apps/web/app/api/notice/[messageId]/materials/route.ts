import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../../lib/session-cookie";

const API_BASE_URL = getApiBaseUrl();

async function authHeaders(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const response = await fetch(`${API_BASE_URL}/notice/${messageId}/materials`, {
    headers: await authHeaders(),
    cache: "no-store"
  });

  return NextResponse.json(await response.json(), { status: response.status });
}
