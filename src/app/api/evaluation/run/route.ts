import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runMlEvaluation } from '@/lib/ml-service';
import {
  buildRuleHitMetrics,
  calculateConfusionMatrixMetrics,
  type ConfusionMatrixCounts,
} from '@/lib/evaluation';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      datasetDir?: string;
      sampleMin?: number;
      sampleMax?: number;
      confusionMatrix?: ConfusionMatrixCounts;
    };

    const datasetDir = body.datasetDir || process.env.EVALUATION_DATASET_DIR;
    if (!datasetDir) {
      return NextResponse.json(
        {
          error:
            'datasetDir is required. Set EVALUATION_DATASET_DIR to a real log dataset directory or pass datasetDir in the request body.',
        },
        { status: 400 },
      );
    }

    const sampleMin = body.sampleMin ?? 300;
    const sampleMax = body.sampleMax ?? 500;

    const mlResult = await runMlEvaluation({
      datasetDir,
      sampleMin,
      sampleMax,
    });

    if (!mlResult.available) {
      return NextResponse.json(
        {
          error: 'ML evaluation service unavailable',
          details: mlResult.error,
        },
        { status: 503 },
      );
    }

    if (!mlResult.data) {
      return NextResponse.json(
        {
          error: 'ML evaluation failed',
          details: mlResult.error,
        },
        { status: mlResult.status && mlResult.status >= 400 ? mlResult.status : 502 },
      );
    }

    const ruleMetrics = await buildRuleHitMetrics({
      datasetDir,
      sampleMin,
      sampleMax,
    });

    const mergedMetrics = {
      ...(mlResult.data.metrics || {}),
      ruleHitCounts: ruleMetrics.ruleHitCounts,
      ruleSampleCount: ruleMetrics.sampleCount,
      ...(body.confusionMatrix
        ? { confusionMatrix: calculateConfusionMatrixMetrics(body.confusionMatrix) }
        : {}),
    };

    const evaluation = await db.evaluationRun.create({
      data: {
        datasetDir,
        sampleCount:
          (typeof mergedMetrics.sampleCount === 'number' && mergedMetrics.sampleCount) ||
          ruleMetrics.sampleCount,
        summary: JSON.stringify(mergedMetrics),
      },
    });

    return NextResponse.json({
      success: true,
      evaluationId: evaluation.id,
      metrics: mergedMetrics,
    });
  } catch (error) {
    console.error('Error running evaluation:', error);
    return NextResponse.json(
      { error: 'Failed to run evaluation' },
      { status: 500 },
    );
  }
}
