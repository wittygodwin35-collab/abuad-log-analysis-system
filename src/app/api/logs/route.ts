import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { PipelineMetadata } from '@/lib/pipeline-types';

export const runtime = 'nodejs';

// GET - List all log files
export async function GET() {
  try {
    const logFiles = await db.logFile.findMany({
      select: {
        id: true,
        filename: true,
        originalName: true,
        fileType: true,
        logSource: true,
        fileSize: true,
        status: true,
        pipelineMetadata: true,
        createdAt: true,
        _count: {
          select: {
            activities: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const compactLogFiles = logFiles.map((logFile) => {
      let pipelineMetadata: PipelineMetadata | null = null;
      try {
        pipelineMetadata = logFile.pipelineMetadata
          ? (JSON.parse(logFile.pipelineMetadata) as PipelineMetadata)
          : null;
      } catch {
        pipelineMetadata = null;
      }

      return {
        id: logFile.id,
        filename: logFile.filename,
        originalName: logFile.originalName,
        fileType: logFile.fileType,
        logSource: logFile.logSource,
        fileSize: logFile.fileSize,
        status: logFile.status,
        pipelineMetadata: logFile.pipelineMetadata,
        createdAt: logFile.createdAt,
        activities: [],
        activityCount: pipelineMetadata?.activityCount ?? logFile._count.activities,
        activitiesTruncated: Boolean(pipelineMetadata?.activitiesTruncated),
      };
    });

    return NextResponse.json({ logFiles: compactLogFiles });
  } catch (error) {
    console.error('Error fetching log files:', error);
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to fetch log files', details },
      { status: 500 }
    );
  }
}
