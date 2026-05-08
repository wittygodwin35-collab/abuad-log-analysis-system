import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLabelledEvaluationMetrics,
  buildRuleHitMetrics,
  calculateConfusionMatrixMetrics,
} from '../src/lib/evaluation';
import {
  APACHE_SAMPLE_NAME,
  LOGHUB_SAMPLE_NAME,
  SECREPO_AUTH_SAMPLE_NAME,
} from '../src/lib/sample-dataset-labels';

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
    expect(metrics?.classificationReport.find((row) => row.label === 'brute_force')?.support).toBe(5);
    expect(metrics?.precisionRecallCurve.length).toBeGreaterThan(0);
    expect(metrics?.rocCurve.length).toBeGreaterThan(0);
    expect(metrics?.confidenceCurve.length).toBeGreaterThan(0);
  });

  it('builds rule metrics from uploaded dataset content', async () => {
    const metrics = await buildRuleHitMetrics({
      datasetContent: [
        'Jan 15 08:23:45 server sshd[12345]: Failed password for invalid user admin from 192.168.1.50 port 22',
        'Jan 15 08:23:46 server sshd[12345]: Failed password for invalid user root from 192.168.1.50 port 22',
        'Jan 15 08:23:47 server sshd[12345]: Failed password for invalid user test from 192.168.1.50 port 22',
      ].join('\n'),
      sampleMin: 3,
      sampleMax: 10,
    });

    expect(metrics.sampleCount).toBe(3);
    expect(metrics.ruleHitCounts.failed_login).toBe(3);
  });

  it('builds labelled metrics from companion label content for uploads', async () => {
    const datasetContent = [
      'Jan 15 08:00:01 server sshd[21001]: Accepted password for analyst from 10.0.0.12 port 54120 ssh2',
      'Jan 15 08:01:00 server sshd[22001]: Failed password for invalid user admin from 192.168.1.50 port 40100 ssh2',
      'Jan 15 08:01:08 server sshd[22002]: Failed password for invalid user root from 192.168.1.50 port 40101 ssh2',
    ].join('\n');
    const labelContent = [
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
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    const metrics = await buildLabelledEvaluationMetrics({
      datasetContent,
      labelContent,
      sampleMax: 10,
    });

    expect(metrics?.labelledSampleCount).toBe(3);
    expect(metrics?.confusionMatrix.truePositive).toBe(2);
    expect(metrics?.confusionMatrix.trueNegative).toBe(1);
    expect(metrics?.precisionRecallCurve.length).toBeGreaterThan(0);
  });

  it('builds curated labelled metrics for the bundled loghub sample path', async () => {
    const metrics = await buildLabelledEvaluationMetrics({
      datasetContent: [
        'Jun 14 15:16:01 combo sshd(pam_unix)[19939]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=218.188.2.4',
        'Jun 14 15:16:02 combo sshd(pam_unix)[19939]: check pass; user unknown',
        'Jun 14 15:16:03 combo sshd(pam_unix)[19940]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=218.188.2.4',
        'Jun 14 15:16:04 combo sshd(pam_unix)[19941]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=218.188.2.4',
        'Jun 14 15:16:05 combo sshd(pam_unix)[19942]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=218.188.2.4',
        'Jun 14 15:16:06 combo sshd(pam_unix)[19943]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=218.188.2.4',
        'Jun 14 15:16:07 combo sshd(pam_unix)[19944]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=218.188.2.4',
        'Jun 15 04:06:18 combo su(pam_unix)[21416]: session opened for user cyrus by (uid=0)',
        'Jun 15 04:06:20 combo logrotate: ALERT exited abnormally with [1]',
      ].join('\n'),
      datasetName: LOGHUB_SAMPLE_NAME,
      sampleMax: 20,
    });

    expect(metrics?.labelledSampleCount).toBe(9);
    expect(metrics?.classificationReport?.some((row) => row.label === 'brute_force')).toBe(true);
    expect(metrics?.classificationReport?.some((row) => row.label === 'safe')).toBe(true);
    expect(metrics?.classificationReport?.some((row) => row.label === 'anomaly')).toBe(true);
  });

  it('builds curated labelled metrics for the Apache 2k sample path', async () => {
    const metrics = await buildLabelledEvaluationMetrics({
      datasetContent: [
        '[Sun Dec 04 04:47:44 2005] [notice] workerEnv.init() ok /etc/httpd/conf/workers2.properties',
        '[Sun Dec 04 04:47:44 2005] [error] mod_jk child workerEnv in error state 6',
        '[Sun Dec 04 04:51:08 2005] [notice] jk2_init() Found child 6725 in scoreboard slot 10',
        '[Sun Dec 04 04:52:19 2005] [warn] long lost child came home! (pid 6727)',
      ].join('\n'),
      datasetName: APACHE_SAMPLE_NAME,
      sampleMax: 10,
    });

    expect(metrics?.labelledSampleCount).toBe(4);
    expect(metrics?.classificationReport?.some((row) => row.label === 'safe')).toBe(true);
    expect(metrics?.classificationReport?.some((row) => row.label === 'anomaly')).toBe(true);
    expect(metrics?.confusionMatrix.truePositive).toBeGreaterThan(0);
  });

  it('builds curated labelled metrics for SecRepo auth logs', async () => {
    const metrics = await buildLabelledEvaluationMetrics({
      datasetContent: [
        'Nov 30 08:42:04 ip-172-31-27-153 sshd[22182]: Invalid user admin from 187.12.249.74',
        'Nov 30 08:42:04 ip-172-31-27-153 sshd[22182]: input_userauth_request: invalid user admin [preauth]',
        'Nov 30 08:42:08 ip-172-31-27-153 sshd[22184]: Invalid user guest from 187.12.249.74',
        'Nov 30 08:42:12 ip-172-31-27-153 sshd[22186]: Invalid user postgres from 187.12.249.74',
        'Nov 30 08:42:16 ip-172-31-27-153 sshd[22188]: Invalid user test from 187.12.249.74',
        'Nov 30 08:42:20 ip-172-31-27-153 sshd[22190]: Invalid user oracle from 187.12.249.74',
        'Nov 30 09:17:01 ip-172-31-27-153 CRON[22125]: pam_unix(cron:session): session opened for user root by (uid=0)',
      ].join('\n'),
      datasetName: SECREPO_AUTH_SAMPLE_NAME,
      sampleMax: 10,
    });

    expect(metrics?.labelledSampleCount).toBe(7);
    expect(metrics?.classificationReport?.some((row) => row.label === 'brute_force')).toBe(true);
    expect(metrics?.classificationReport?.some((row) => row.label === 'safe')).toBe(true);
    expect(metrics?.confusionMatrix.truePositive).toBe(5);
    expect(metrics?.confusionMatrix.trueNegative).toBe(2);
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
