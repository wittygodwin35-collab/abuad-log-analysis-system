import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const envPath = path.join(cwd, '.env');

function parseEnvFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const result = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function fail(message) {
  console.error(`DB env check failed: ${message}`);
  process.exitCode = 1;
}

function warn(message) {
  console.warn(`DB env check warning: ${message}`);
}

if (!existsSync(envPath)) {
  fail('missing .env file. Copy env.sample to .env first.');
  process.exit(process.exitCode ?? 1);
}

const env = parseEnvFile(envPath);
const databaseUrl = env.DATABASE_URL || '';
const directUrl = env.DIRECT_URL || '';

if (!databaseUrl) {
  fail('DATABASE_URL is missing.');
}

if (!directUrl) {
  fail('DIRECT_URL is missing.');
}

const placeholderPattern = /change_me|<project-ref>|<password>|127\.0\.0\.1:5432\/log_analysis/i;
if (placeholderPattern.test(databaseUrl)) {
  fail('DATABASE_URL still contains placeholder values.');
}

if (placeholderPattern.test(directUrl)) {
  fail('DIRECT_URL still contains placeholder values.');
}

let database;
let direct;

try {
  database = new URL(databaseUrl);
} catch {
  fail('DATABASE_URL is not a valid URL.');
}

try {
  direct = new URL(directUrl);
} catch {
  fail('DIRECT_URL is not a valid URL.');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

const usingSupabase =
  database.hostname.includes('supabase') || direct.hostname.includes('supabase');

if (usingSupabase) {
  const pooledRuntime =
    database.hostname.includes('pooler.supabase.com') ||
    database.searchParams.get('pgbouncer') === 'true' ||
    database.port === '6543';
  const directConnection =
    direct.hostname.startsWith('db.') && !direct.hostname.includes('pooler');
  const sessionPoolerConnection =
    direct.hostname.includes('pooler.supabase.com') && direct.port === '5432';
  const runtimeUsesDirectHost =
    database.hostname === direct.hostname && database.port === direct.port;

  if (!pooledRuntime && !runtimeUsesDirectHost) {
    fail('Supabase runtime DATABASE_URL should use the pooler host or match DIRECT_URL.');
  }

  if (!directConnection && !sessionPoolerConnection) {
    fail(
      'Supabase DIRECT_URL should use the direct db.<project-ref>.supabase.co host or the session pooler on port 5432.'
    );
  }

  if (!pooledRuntime && runtimeUsesDirectHost) {
    warn(
      'DATABASE_URL is using the direct Supabase host. This is okay for now, but the pooler URL is preferred for runtime traffic.'
    );
  }

  if (sessionPoolerConnection) {
    warn(
      'DIRECT_URL is using the session pooler. This is a practical fallback when the direct host is IPv6-only from your network.'
    );
  }

  if (database.searchParams.get('sslmode') !== 'require') {
    warn('DATABASE_URL should usually include sslmode=require for Supabase.');
  }

  if (direct.searchParams.get('sslmode') !== 'require') {
    warn('DIRECT_URL should usually include sslmode=require for Supabase.');
  }

  if (database.searchParams.get('connection_limit') !== '1') {
    warn('DATABASE_URL should usually include connection_limit=1 on Supabase free tier.');
  }
}

console.log('DB env check passed.');
