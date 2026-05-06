import { NextResponse } from 'next/server';
import { getCollectorStatus } from '@/lib/collector';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const status = await getCollectorStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Error fetching collector status:', error);
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to fetch collector status', details },
      { status: 500 },
    );
  }
}
