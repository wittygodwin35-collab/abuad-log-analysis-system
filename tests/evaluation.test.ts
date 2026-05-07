import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLabelledEvaluationMetrics,
  buildRuleHitMetrics,
  calculateConfusionMatrixMetrics,
} from '../src/lib/evaluation';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, {
      recursive: true,
      force: true,
    });
    tempDir = null;
  }
});

describe('evaluation metrics', () => {
  it('calculates chapter-three confusion-matrix metrics', () => {
    const metrics = calculateConfusionMatrixMetrics({
      truePositive: 18,
      falsePositive: 2,
      falseNegative: 3,
      trueNegative: 27,
    });

    expect(metrics.accuracy).toBeCloseTo(0.9);
    expect(metrics.precision).toBeCloseTo(0.9);
    expect(metrics.recall).toBeCloseTo(18 / 21);
    expect(metrics.f1Score).toBeGreaterThan(0.87);
  });

  it('counts rule hits from log dataset samples', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'abuad-eval-'));
    await writeFile(
      join(tempDir, 'auth.log'),
      [
        'Jan 15 08:23:45 server sshd[12345]: Failed password for invalid user admin from 192.168.1.50 port 22',
        'Jan 15 08:23:46 server sshd[12345]: Failed password for invalid user root from 192.168.1.50 port 22',
        'Jan 15 08:23:47 server sshd[12345]: Failed password for invalid user test from 192.168.1.50 port 22',
        'Jan 15 08:23:48 server sshd[12345]: Failed password for invalid user demo from 192.168.1.50 port 22',
        'Jan 15 08:23:49 server sshd[12345]: Failed password for invalid user guest from 192.168.1.50 port 22',
      ].join('\n'),
      'utf-8',
    );

    const metrics = await buildRuleHitMetrics({
      datasetDir: tempDir,
      sampleMin: 5,
      sampleMax: 10,
    });

    expect(metrics.sampleCount).toBe(5);
    expect(metrics.ruleHitCounts.failed_login).toBeGreaterThanOrEqual(5);
    expect(metrics.ruleHitCounts.brute_force).toBe(1);
  });

  it('builds chapter-three metrics from labelled truth-table logs', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'abuad-eval-'));
    const labelledRows = [
      {
        label: 'safe',
        line: 'Jan 15 08:00:01 server sshd[21001]: Accepted password for analyst from 10.0.0.12 port 54120 ssh2',
      },
      {
        label: 'brute_force',
        line: 'Jan 15 08:01:00 server sshd[22001]: Failed password for invalid user admin from 192.168.1.50 port 40100 ssh2',
      },
      {
        label: 'brute_force',
        line: 'Jan 15 08:01:08 server sshd[22002]: Failed password for invalid user root from 192.168.1.50 port 40101 ssh2',
      },
      {
        label: 'brute_force',
        line: 'Jan 15 08:01:16 server sshd[22003]: Failed password for invalid user oracle from 192.168.1.50 port 40102 ssh2',
      },
      {
        label: 'brute_force',
        line: 'Jan 15 08:01:24 server sshd[22004]: Failed password for invalid user test from 192.168.1.50 port 40103 ssh2',
      },
      {
        label: 'brute_force',
        line: 'Jan 15 08:01:32 server sshd[22005]: Failed password for invalid user postgres from 192.168.1.50 port 40104 ssh2',
      },
      {
        label: 'sql_injection',
        line: '198.51.100.77 - - [15/Jan/2025:08:02:00 +0000] "GET /api/users?select=*%20FROM%20users-- HTTP/1.1" 400 64 "-" "Mozilla/5.0"',
      },
      {
        label: 'path_traversal',
        line: '203.0.113.42 - - [15/Jan/2025:08:03:00 +0000] "GET /../../../../etc/passwd HTTP/1.1" 403 512 "-" "Mozilla/5.0"',
      },
    ];
    await writeFile(
      join(tempDir, 'chapter-3.truth.jsonl'),
      labelledRows.map((row) => JSON.stringify(row)).join('\n'),
      'utf-8',
    );

    const metrics = await buildLabelledEvaluationMetrics({
      datasetDir: tempDir,
    });

    expect(metrics?.labelledSampleCount).toBe(labelledRows.length);
    expect(metrics?.confusionMatrix.truePositive).toBe(7);
    expect(metrics?.confusionMatrix.trueNegative).toBe(1);
    expect(metrics?.confusionMatrix.accuracy).toBe(1);
    expect(metrics?.confusionMatrix.precision).toBe(1);
    expect(metrics?.confusionMatrix.recall).toBe(1);
    expect(metrics?.confusionMatrix.f1Score).toBe(1);
    expect(metrics?.classConfusionMatrix.brute_force.brute_force).toBe(5);
    expect(metrics?.classConfusionMatrix.sql_injection.sql_injection).toBe(1);
    expect(metrics?.classConfusionMatrix.path_traversal.path_traversal).toBe(1);
  });

  it('fails clearly when the requested sample minimum is not met', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'abuad-eval-'));
    await writeFile(join(tempDir, 'small.log'), 'one usable line\n', 'utf-8');

    await expect(
      buildRuleHitMetrics({
        datasetDir: tempDir,
        sampleMin: 2,
        sampleMax: 10,
      }),
    ).rejects.toThrow('below the requested minimum');
  });
});
