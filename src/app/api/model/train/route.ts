import { NextRequest, NextResponse } from 'next/server';
import { stat } from 'fs/promises';
import {
  DEFAULT_NORMAL_LOG_DIR,
  ensureBundledDatasetDir,
  isBundledDatasetPath,
} from '@/lib/demo-data';
import { trainMlModel } from '@/lib/ml-service';

export const runtime = 'nodejs';

async function directoryExists(path: string): Promise<boolean> {
  const fileStat = await stat(path).catch(() => null);
  return Boolean(fileStat?.isDirectory());
}

async function resolveNormalLogDir(normalLogDir?: string): Promise<string> {
  const requested = normalLogDir?.trim();
  const configured = process.env.NORMAL_LOG_DIR?.trim();
  const candidate = requested || configured || DEFAULT_NORMAL_LOG_DIR;

  if (isBundledDatasetPath(candidate, "normal")) {
    return ensureBundledDatasetDir("normal");
  }

  if (await directoryExists(candidate)) {
    return candidate;
  }

  if (!requested) {
    return ensureBundledDatasetDir("normal");
  }

  return candidate;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      datasetName?: string;
      normalLogDir?: string;
      normalLogContent?: string;
      maxSamples?: number;
    };
    const normalLogContent =
      typeof body.normalLogContent === 'string' ? body.normalLogContent : undefined;

    const result = await trainMlModel({
      normalLogContent,
      normalLogDir: normalLogContent
        ? body.datasetName || 'uploaded-training-dataset'
        : await resolveNormalLogDir(body.normalLogDir),
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
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to train model', details },
      { status: 500 },
    );
  }
}
