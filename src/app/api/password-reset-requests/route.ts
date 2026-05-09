import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildRequestReference, savePasswordResetRequest } from "@/lib/request-storage";

export const runtime = "nodejs";

const passwordResetRequestSchema = z.object({
  fullName: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email().max(160),
  username: z.string().trim().min(3).max(120),
  note: z.string().trim().max(1200).optional().or(z.literal("")),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = passwordResetRequestSchema.parse(body);

    const resetRequest = await savePasswordResetRequest({
      fullName: parsed.fullName || null,
      email: parsed.email,
      username: parsed.username,
      note: parsed.note || null,
    });

    return NextResponse.json({
      success: true,
      requestId: resetRequest.id,
      reference: buildRequestReference("PR", resetRequest.id),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request details." },
        { status: 400 },
      );
    }

    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to submit password reset request", details },
      { status: 500 },
    );
  }
}
