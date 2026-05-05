import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { analyzeExistingLogFile } from '@/lib/analysis-storage';

export const runtime = 'nodejs';

// POST - Re-analyze a log file
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the log file
    const logFile = await db.logFile.findUnique({
      where: { id },
    });

    if (!logFile) {
      return NextResponse.json(
        { error: 'Log file not found' },
        { status: 404 }
      );
    }

    const analysis = await analyzeExistingLogFile({
      id,
      source: logFile.logSource === 'collector' ? 'collector' : 'upload',
    });

    return NextResponse.json({
      logFile: analysis.logFile,
      summary: analysis.summary,
      pipeline: analysis.pipeline,
    });
  } catch (error) {
    console.error('Error re-analyzing log file:', error);
    return NextResponse.json(
      { error: 'Failed to re-analyze log file' },
      { status: 500 }
    );
  }
}
