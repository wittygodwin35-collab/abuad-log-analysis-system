import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// DELETE - Delete a log file
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db.logFile.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting log file:', error);
    return NextResponse.json(
      { error: 'Failed to delete log file' },
      { status: 500 }
    );
  }
}

// GET - Get a single log file
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const logFile = await db.logFile.findUnique({
      where: { id },
      include: {
        activities: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        parsedEntries: {
          orderBy: {
            lineNumber: 'asc',
          },
        },
      },
    });

    if (!logFile) {
      return NextResponse.json(
        { error: 'Log file not found' },
        { status: 404 }
      );
    }

    const summary = {
      total: logFile.activities.length,
      critical: logFile.activities.filter((a) => a.severity === 'critical').length,
      high: logFile.activities.filter((a) => a.severity === 'high').length,
      medium: logFile.activities.filter((a) => a.severity === 'medium').length,
      low: logFile.activities.filter((a) => a.severity === 'low').length,
    };

    return NextResponse.json({
      logFile,
      summary,
    });
  } catch (error) {
    console.error('Error fetching log file:', error);
    return NextResponse.json(
      { error: 'Failed to fetch log file' },
      { status: 500 }
    );
  }
}
