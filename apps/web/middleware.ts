import { type NextRequest, NextResponse } from "next/server";

const LEGACY_HOST = "autoweb-f4dw.onrender.com";
const CANONICAL_ORIGIN = "https://autoweb24.no";

function requestHost(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost?.split(",")[0] ?? request.headers.get("host") ?? "";

  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

export function middleware(request: NextRequest) {
  if (
    requestHost(request) !== LEGACY_HOST ||
    request.nextUrl.pathname === "/api" ||
    request.nextUrl.pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  const destination = new URL(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
    CANONICAL_ORIGIN
  );

  return NextResponse.redirect(destination, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
