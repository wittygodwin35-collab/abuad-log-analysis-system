import { NextResponse } from "next/server";
import { getDemoLogs } from "@/lib/demo-data";

export const runtime = "nodejs";

export async function GET() {
  const demoLogs = getDemoLogs().map(({ id, filename, title, description }) => ({
    id,
    filename,
    title,
    description,
  }));

  return NextResponse.json({ demoLogs });
}
