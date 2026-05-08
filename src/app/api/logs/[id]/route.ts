import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchLogFileResponse } from '@/lib/analysis-storage';

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
    const response = await fetchLogFileResponse(id);
    if (!response) {
      return NextResponse.json(
        { error: 'Log file not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      logFile: response.logFile,
      summary: response.summary,
      pipeline: response.pipeline,
    });
  } catch (error) {
    console.error('Error fetching log file:', error);
    return NextResponse.json(
      { error: 'Failed to fetch log file' },
      { status: 500 }
    );
  }
}
