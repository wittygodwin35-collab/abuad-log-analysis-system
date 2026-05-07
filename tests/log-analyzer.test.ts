import { describe, expect, it } from 'vitest';
import { analyzeLogContent, generateSampleLog } from '../src/lib/log-analyzer';
import { sanitizeLogContentForAi } from '../src/lib/privacy';
import { countNonEmptyLines, getReadOffset } from '../src/lib/collector';

describe('rule-based log analysis', () => {
  it('keeps known auth detections active', () => {
    const result = analyzeLogContent(generateSampleLog('auth'));
    const types = result.activities.map((activity) => activity.activityType);

    expect(result.logType).toBe('auth');
    expect(types).toContain('failed_login');
    expect(types).toContain('brute_force');
    expect(types).toContain('privilege_escalation');
    expect(types).toContain('unauthorized_access');
  });

  it('correlates Linux and web activity from the same source in mixed logs', () => {
    const result = analyzeLogContent(generateSampleLog('mixed'));
    const types = result.activities.map((activity) => activity.activityType);

    expect(result.logType).toBe('mixed');
    expect(types).toContain('web_attack');
    expect(types).toContain('brute_force');
    expect(types).toContain('multi_step_attack');
  });

  it('recognizes real Loghub Linux pam_unix authentication failures', () => {
    const result = analyzeLogContent(
      [
        'Jun 15 02:04:59 combo sshd(pam_unix)[20882]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=220-135-151-1.hinet-ip.hinet.net  user=root',
        'Jun 15 02:04:59 combo sshd(pam_unix)[20884]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=220-135-151-1.hinet-ip.hinet.net  user=root',
        'Jun 15 02:04:59 combo sshd(pam_unix)[20883]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=220-135-151-1.hinet-ip.hinet.net  user=root',
        'Jun 15 02:04:59 combo sshd(pam_unix)[20885]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=220-135-151-1.hinet-ip.hinet.net  user=root',
        'Jun 15 02:04:59 combo sshd(pam_unix)[20886]: authentication failure; logname= uid=0 euid=0 tty=NODEVssh ruser= rhost=220-135-151-1.hinet-ip.hinet.net  user=root',
      ].join('\n'),
    );
    const types = result.activities.map((activity) => activity.activityType);

    expect(result.logType).toBe('auth');
    expect(types).toContain('failed_login');
    expect(types).toContain('brute_force');
  });

  it('sanitizes identifiers before AI or ML handoff', () => {
    const sanitized = sanitizeLogContentForAi(
      'Jan 15 08:23:45 server sshd[1]: Failed password for invalid user admin from 192.168.1.50 port 22',
    );

    expect(sanitized.content).not.toContain('192.168.1.50');
    expect(sanitized.content).not.toContain('admin');
    expect(sanitized.metadata.replacements.ipAddresses).toBe(1);
    expect(sanitized.metadata.replacements.usernames).toBe(1);
  });
});

describe('collector helpers', () => {
  it('resets the read offset when a file is truncated or rotated', () => {
    expect(getReadOffset(1200, 80)).toBe(0);
  });

  it('continues reading from the previous offset for appended content', () => {
    expect(getReadOffset(1200, 1800)).toBe(1200);
  });

  it('counts only usable log lines', () => {
    expect(countNonEmptyLines('\nfirst\n \nsecond\n')).toBe(2);
  });
});
