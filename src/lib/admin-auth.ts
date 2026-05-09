import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName, isAdminUser, verifySessionToken } from "@/lib/auth";

export async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  const token = request.cookies.get(getSessionCookieName())?.value;
  const user = await verifySessionToken(token);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  return null;
}
