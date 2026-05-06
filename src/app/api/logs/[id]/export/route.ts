import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { PipelineMetadata } from "@/lib/pipeline-types";

export const runtime = "nodejs";

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parsePipelineMetadata(value: string | null): PipelineMetadata | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as PipelineMetadata;
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const logFile = await db.logFile.findUnique({
      where: { id },
      include: {
        activities: {
          orderBy: {
            createdAt: "desc",
          },
        },
        parsedEntries: {
          orderBy: {
            lineNumber: "asc",
          },
        },
      },
    });

    if (!logFile) {
      return NextResponse.json({ error: "Log file not found." }, { status: 404 });
    }

    const summary = {
      total: logFile.activities.length,
      critical: logFile.activities.filter((activity) => activity.severity === "critical").length,
      high: logFile.activities.filter((activity) => activity.severity === "high").length,
      medium: logFile.activities.filter((activity) => activity.severity === "medium").length,
      low: logFile.activities.filter((activity) => activity.severity === "low").length,
    };

    const payload = {
      exportedAt: new Date().toISOString(),
      logFile: {
        id: logFile.id,
        filename: logFile.filename,
        originalName: logFile.originalName,
        fileType: logFile.fileType,
        logSource: logFile.logSource,
        fileSize: logFile.fileSize,
        status: logFile.status,
        createdAt: logFile.createdAt,
        updatedAt: logFile.updatedAt,
        lastAnalyzedAt: logFile.lastAnalyzedAt,
      },
      summary,
      pipeline: parsePipelineMetadata(logFile.pipelineMetadata),
      activities: logFile.activities,
      parsedEntries: logFile.parsedEntries,
    };

    const filename = `${safeFilename(logFile.originalName || logFile.filename || "analysis")}.analysis.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting log file:", error);
    return NextResponse.json({ error: "Failed to export log file." }, { status: 500 });
  }
}
