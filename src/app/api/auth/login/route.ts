import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieName,
  getSessionCookieOptions,
  isValidCredentialAttempt,
} from "@/lib/auth";
import { authenticateUserCredential } from "@/lib/user-credentials";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      username?: string;
      password?: string;
    };

    const username = body.username?.trim() || "";
    const password = body.password || "";

    const adminLogin = isValidCredentialAttempt(username, password);
    const userLogin = adminLogin
      ? null
      : await authenticateUserCredential({
          username,
          password,
        });

    if (!adminLogin && !userLogin) {
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401 },
      );
    }

    const sessionUser = adminLogin
      ? {
          id: username,
          name: username,
          role: "admin" as const,
        }
      : {
          id: userLogin!.id,
          name: userLogin!.name,
          role: "user" as const,
        };

    const token = await createSessionToken({
      id: sessionUser.id,
      name: sessionUser.name,
      role: sessionUser.role,
    });

    const response = NextResponse.json({
      authenticated: true,
      user: {
        name: sessionUser.name,
        role: sessionUser.role,
      },
    });

    response.cookies.set(getSessionCookieName(), token, getSessionCookieOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
