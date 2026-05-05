import { readdir, readFile, stat } from 'fs/promises';
import { extname, join } from 'path';
import { analyzeLogContent } from '@/lib/log-analyzer';

const SUPPORTED_EXTENSIONS = new Set(['.log', '.txt', '.json']);

export interface ConfusionMatrixCounts {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
}

export interface ConfusionMatrixMetrics extends ConfusionMatrixCounts {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function calculateConfusionMatrixMetrics(
  counts: ConfusionMatrixCounts,
): ConfusionMatrixMetrics {
  const truePositive = Math.max(0, counts.truePositive || 0);
  const falsePositive = Math.max(0, counts.falsePositive || 0);
  const falseNegative = Math.max(0, counts.falseNegative || 0);
  const trueNegative = Math.max(0, counts.trueNegative || 0);
  const total = truePositive + falsePositive + falseNegative + trueNegative;
  const precision = safeDivide(truePositive, truePositive + falsePositive);
  const recall = safeDivide(truePositive, truePositive + falseNegative);

  return {
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    accuracy: safeDivide(truePositive + trueNegative, total),
    precision,
    recall,
    f1Score: safeDivide(2 * precision * recall, precision + recall),
  };
}

function countRuleHits(content: string): Record<string, number> {
  const { activities } = analyzeLogContent(content);
  const counts: Record<string, number> = {};
  for (const activity of activities) {
    counts[activity.activityType] = (counts[activity.activityType] || 0) + 1;
  }
  return counts;
}

export async function collectEvaluationSample(input: {
  datasetDir: string;
  sampleMax: number;
}): Promise<string[]> {
  const root = await stat(input.datasetDir).catch(() => null);
  if (!root?.isDirectory()) {
    throw new Error(
      `Evaluation dataset directory does not exist or is not a directory: ${input.datasetDir}`,
    );
  }

  const lines: string[] = [];
  const queue = [input.datasetDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const entries = await readdir(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!SUPPORTED_EXTENSIONS.has(extname(fullPath).toLowerCase())) {
        continue;
      }

      const content = await readFile(fullPath, {
        encoding: 'utf-8',
      });
      for (const line of content.split('\n')) {
        if (line.trim()) {
          lines.push(line.trim());
        }
        if (lines.length >= input.sampleMax) {
          return lines;
        }
      }
    }
  }

  return lines;
}

export async function buildRuleHitMetrics(input: {
  datasetDir: string;
  sampleMin?: number;
  sampleMax: number;
}): Promise<{
  sampleCount: number;
  ruleHitCounts: Record<string, number>;
}> {
  const sampledLines = await collectEvaluationSample(input);
  if (input.sampleMin && sampledLines.length < input.sampleMin) {
    throw new Error(
      `Evaluation dataset has ${sampledLines.length} usable log lines, below the requested minimum of ${input.sampleMin}.`,
    );
  }

  const content = sampledLines.join('\n');
  return {
    sampleCount: sampledLines.length,
    ruleHitCounts: countRuleHits(content),
  };
}
