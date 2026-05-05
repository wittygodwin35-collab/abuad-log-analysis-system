import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
