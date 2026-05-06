import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// GET - List all log files
export async function GET() {
  try {
    const logFiles = await db.logFile.findMany({
      include: {
        activities: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ logFiles });
  } catch (error) {
    console.error('Error fetching log files:', error);
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to fetch log files', details },
      { status: 500 }
    );
  }
}
