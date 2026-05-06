import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName, verifySessionToken } from "@/lib/auth";

const PUBLIC_AUTH_PAGES = new Set(["/login", "/signup", "/forgot-password"]);

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_AUTH_PAGES.has(pathname) ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/access-requests" ||
    pathname === "/api/password-reset-requests" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    if (PUBLIC_AUTH_PAGES.has(pathname)) {
      const token = request.cookies.get(getSessionCookieName())?.value;
      const user = await verifySessionToken(token);
      if (user) {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }

    return NextResponse.next();
  }

  const token = request.cookies.get(getSessionCookieName())?.value;
  const user = await verifySessionToken(token);
  if (user) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
