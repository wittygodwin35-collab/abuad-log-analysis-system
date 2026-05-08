import { NextRequest, NextResponse } from 'next/server';
import { createAndAnalyzeLogFile } from '@/lib/analysis-storage';
import { readPublicSampleDatasetById } from '@/lib/sample-datasets.server';
import type { PublicSampleDatasetDefinition } from '@/lib/sample-datasets';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sampleDatasetId?: PublicSampleDatasetDefinition['id'];
    };
    const sampleDatasetId =
      typeof body.sampleDatasetId === 'string' ? body.sampleDatasetId : undefined;

    if (!sampleDatasetId) {
      return NextResponse.json(
        { error: 'sampleDatasetId is required' },
        { status: 400 },
      );
    }

    const dataset = await readPublicSampleDatasetById(sampleDatasetId);
    const analysis = await createAndAnalyzeLogFile({
      originalName: dataset.definition.filename,
      fileSize: Buffer.byteLength(dataset.content, 'utf-8'),
      content: dataset.content,
      source: 'upload',
    });

    return NextResponse.json({
      logFile: analysis.logFile,
      summary: analysis.summary,
      pipeline: analysis.pipeline,
    });
  } catch (error) {
    console.error('Error analyzing sample dataset:', error);
    return NextResponse.json(
      { error: 'Failed to analyze sample dataset' },
      { status: 500 },
    );
  }
}
