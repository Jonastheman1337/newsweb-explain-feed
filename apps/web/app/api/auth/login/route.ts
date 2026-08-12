import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../lib/session-cookie";

const SESSION_MAX_AGE_SECONDS = 604800;

export async function POST(request: Request) {
  const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: await request.text()
  });

  if (!response.ok) {
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json"
      }
    });
  }

  const data = (await response.json()) as {
    sessionToken?: string;
    user?: { id: string; username: string };
  };

  if (!data.sessionToken) {
    return NextResponse.json({ message: "Innlogging feilet." }, { status: 502 });
  }

  const res = NextResponse.json({ user: data.user ?? null }, { status: response.status });
  res.cookies.set(SESSION_COOKIE, data.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
  return res;
}
