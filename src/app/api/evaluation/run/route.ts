import { NextRequest, NextResponse } from 'next/server';
import { stat } from 'fs/promises';
import { db } from '@/lib/db';
import {
  DEFAULT_EVALUATION_DATASET_DIR,
  ensureBundledDatasetDir,
  isBundledDatasetPath,
} from '@/lib/demo-data';
import { runMlEvaluation } from '@/lib/ml-service';
import { readPublicSampleDatasetById } from '@/lib/sample-datasets.server';
import {
  buildLabelledEvaluationMetrics,
  buildRuleHitMetrics,
  calculateConfusionMatrixMetrics,
  type ConfusionMatrixCounts,
} from '@/lib/evaluation';
import type { PublicSampleDatasetDefinition } from '@/lib/sample-datasets';

export const runtime = 'nodejs';

async function directoryExists(path: string): Promise<boolean> {
  const fileStat = await stat(path).catch(() => null);
  return Boolean(fileStat?.isDirectory());
}

async function resolveEvaluationDatasetDir(datasetDir?: string): Promise<string> {
  const requested = datasetDir?.trim();
  const configured = process.env.EVALUATION_DATASET_DIR?.trim();
  const candidate = requested || configured || DEFAULT_EVALUATION_DATASET_DIR;

  if (isBundledDatasetPath(candidate, "evaluation")) {
    return ensureBundledDatasetDir("evaluation");
  }

  if (await directoryExists(candidate)) {
    return candidate;
  }

  if (!requested) {
    return ensureBundledDatasetDir("evaluation");
  }

  return candidate;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      datasetContent?: string;
      datasetDir?: string;
      datasetName?: string;
      sampleDatasetId?: PublicSampleDatasetDefinition['id'];
      labelContent?: string;
      sampleMin?: number;
      sampleMax?: number;
      confusionMatrix?: ConfusionMatrixCounts;
    };
    const sampleDatasetId =
      typeof body.sampleDatasetId === 'string' ? body.sampleDatasetId : undefined;
    const sampleDataset = sampleDatasetId
      ? await readPublicSampleDatasetById(sampleDatasetId)
      : null;
    const datasetContent =
      typeof body.datasetContent === 'string'
        ? body.datasetContent
        : sampleDataset?.content;
    const labelContent = typeof body.labelContent === 'string' ? body.labelContent : undefined;
    const datasetDir = datasetContent
      ? sampleDataset?.definition.filename || body.datasetName || 'uploaded-dataset'
      : await resolveEvaluationDatasetDir(body.datasetDir);
    if (!datasetDir) {
      return NextResponse.json(
        {
          error:
            'datasetDir is required. Set EVALUATION_DATASET_DIR to a valid log dataset directory or pass datasetDir in the request body.',
        },
        { status: 400 },
      );
    }

    const sampleMin = body.sampleMin ?? 300;
    const sampleMax = body.sampleMax ?? 500;

    const mlResult = await runMlEvaluation({
      datasetContent,
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
      datasetContent,
      datasetDir,
      sampleMin,
      sampleMax,
    });
    const labelledMetrics = await buildLabelledEvaluationMetrics({
      datasetContent,
      datasetDir,
      datasetName: sampleDataset?.definition.filename || body.datasetName,
      labelContent,
      sampleMax,
    });
    const manualConfusionMatrix = body.confusionMatrix
      ? calculateConfusionMatrixMetrics(body.confusionMatrix)
      : null;

    const mergedMetrics = {
      ...(mlResult.data.metrics || {}),
      ruleHitCounts: ruleMetrics.ruleHitCounts,
      ruleSampleCount: ruleMetrics.sampleCount,
      ...(labelledMetrics
        ? {
            classConfusionMatrix: labelledMetrics.classConfusionMatrix,
            classLabels: labelledMetrics.classLabels,
            classificationReport: labelledMetrics.classificationReport,
            confidenceCurve: labelledMetrics.confidenceCurve,
            labelledSampleCount: labelledMetrics.labelledSampleCount,
            multiclassAccuracy: labelledMetrics.multiclassAccuracy,
            precisionRecallCurve: labelledMetrics.precisionRecallCurve,
            rocCurve: labelledMetrics.rocCurve,
            thresholds: labelledMetrics.thresholds,
          }
        : {}),
      ...(manualConfusionMatrix || labelledMetrics?.confusionMatrix
        ? { confusionMatrix: manualConfusionMatrix || labelledMetrics?.confusionMatrix }
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
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to run evaluation', details },
      { status: 500 },
    );
  }
}
