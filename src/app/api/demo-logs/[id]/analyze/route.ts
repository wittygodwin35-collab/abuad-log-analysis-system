import { NextRequest, NextResponse } from "next/server";
import { createAndAnalyzeLogFile } from "@/lib/analysis-storage";
import { getDemoLogById } from "@/lib/demo-data";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const demoLog = getDemoLogById(id);

    if (!demoLog) {
      return NextResponse.json({ error: "Demo log not found." }, { status: 404 });
    }

    const analysis = await createAndAnalyzeLogFile({
      originalName: demoLog.filename,
      fileSize: Buffer.byteLength(demoLog.content, "utf-8"),
      content: demoLog.content,
      source: "upload",
    });

    return NextResponse.json({
      logFile: analysis.logFile,
      summary: analysis.summary,
      pipeline: analysis.pipeline,
    });
  } catch (error) {
    console.error("Error analyzing demo log:", error);
    return NextResponse.json(
      { error: "Failed to analyze demo log." },
      { status: 500 },
    );
  }
}
