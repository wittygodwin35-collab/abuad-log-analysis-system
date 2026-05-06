import { NextResponse } from 'next/server';
import { runCollectorCycle } from '@/lib/collector';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const result = await runCollectorCycle();

    return NextResponse.json({
      success: result.success,
      filesScanned: result.filesScanned,
      linesIngested: result.linesIngested,
      logFilesCreated: result.logFilesCreated,
      errors: result.errors,
    });
  } catch (error) {
    console.error('Error running collector:', error);
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to run collector cycle', details },
      { status: 500 },
    );
  }
}
