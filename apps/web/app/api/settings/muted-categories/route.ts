import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../lib/session-cookie";

const API_BASE_URL = getApiBaseUrl();

async function authHeaders(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function GET() {
  const response = await fetch(`${API_BASE_URL}/settings/muted-categories`, {
    headers: await authHeaders(),
    cache: "no-store"
  });

  if (!response.ok) {
    return NextResponse.json(
      { message: "Kunne ikke hente skjulte kategorier." },
      { status: response.status }
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}

export async function PUT(request: Request) {
  const body = await request.json();

  const response = await fetch(`${API_BASE_URL}/settings/muted-categories`, {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return NextResponse.json(
      { message: "Kunne ikke lagre skjulte kategorier." },
      { status: response.status }
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
