import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const accessRequestSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(160),
  department: z.string().trim().max(120).optional().or(z.literal("")),
  useCase: z.string().trim().min(12).max(1200),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = accessRequestSchema.parse(body);

    const accessRequest = await db.accessRequest.create({
      data: {
        fullName: parsed.fullName,
        email: parsed.email,
        department: parsed.department || null,
        useCase: parsed.useCase,
      },
    });

    return NextResponse.json({
      success: true,
      requestId: accessRequest.id,
      reference: `AR-${accessRequest.id.slice(-6).toUpperCase()}`,
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
      { error: "Failed to submit access request", details },
      { status: 500 },
    );
  }
}
