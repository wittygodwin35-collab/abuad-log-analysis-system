import { NextRequest, NextResponse } from 'next/server';
import { createAndAnalyzeLogFile } from '@/lib/analysis-storage';
import { readPublicSampleDatasetById } from '@/lib/sample-datasets.server';
import type { PublicSampleDatasetDefinition } from '@/lib/sample-datasets';
import type { PipelineMetadata } from '@/lib/pipeline-types';

export const runtime = 'nodejs';

const MAX_SAMPLE_ANALYSIS_LINES = 2500;

function prepareSampleAnalysisContent(content: string): {
  analysisScope: NonNullable<PipelineMetadata['analysisScope']>;
  content: string;
} {
  const lines = content.split(/\r?\n/);
  const nonEmptyLineCount = lines.filter((line) => line.trim()).length;

  if (nonEmptyLineCount <= MAX_SAMPLE_ANALYSIS_LINES) {
    return {
      analysisScope: {
        analyzedLineCount: nonEmptyLineCount,
        mode: 'full',
        originalFileSize: Buffer.byteLength(content, 'utf-8'),
        originalLineCount: nonEmptyLineCount,
      },
      content,
    };
  }

  const sampledLines: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    sampledLines.push(line);
    if (sampledLines.length >= MAX_SAMPLE_ANALYSIS_LINES) {
      break;
    }
  }

  return {
    analysisScope: {
      analyzedLineCount: sampledLines.length,
      mode: 'sample',
      originalFileSize: Buffer.byteLength(content, 'utf-8'),
      originalLineCount: nonEmptyLineCount,
    },
    content: sampledLines.join('\n'),
  };
}

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
    const preparedDataset = prepareSampleAnalysisContent(dataset.content);
    const analysis = await createAndAnalyzeLogFile({
      originalName: dataset.definition.filename,
      fileSize: preparedDataset.analysisScope.originalFileSize,
      content: preparedDataset.content,
      analysisScope: preparedDataset.analysisScope,
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
