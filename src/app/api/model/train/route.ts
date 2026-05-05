import { NextRequest, NextResponse } from 'next/server';
import { trainMlModel } from '@/lib/ml-service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      normalLogDir?: string;
      maxSamples?: number;
    };

    const result = await trainMlModel({
      normalLogDir: body.normalLogDir || process.env.NORMAL_LOG_DIR,
      maxSamples: body.maxSamples,
    });

    if (!result.available) {
      return NextResponse.json(
        {
          error: 'ML service unavailable',
          details: result.error,
        },
        { status: 503 },
      );
    }

    if (!result.data) {
      return NextResponse.json(
        {
          error: 'ML model training failed',
          details: result.error,
        },
        { status: result.status && result.status >= 400 ? result.status : 502 },
      );
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error('Error training model:', error);
    return NextResponse.json(
      { error: 'Failed to train model' },
      { status: 500 },
    );
  }
}
