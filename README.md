# ABUAD Log Analysis System

This project is a revised implementation of the "Development of a Log Analysis System for Detecting Suspicious Activities from Linux Servers and Web-Based Logs" proposal. The code follows the chapter-two literature gap and the chapter-three methodology:

- Unified Linux and web log analysis instead of separate, fragmented tools.
- Data acquisition for uploaded files and collector-read server logs.
- Normalization of raw log lines into structured timestamp, source IP, event type, status code, and request fields.
- Hybrid detection using fast signatures, behavioural thresholds, cross-source correlation, Drain3 templates, and Isolation Forest anomaly scoring.
- Privacy-aware ML handoff that redacts IP addresses, usernames, emails, and hostnames before external analysis.
- PostgreSQL-backed history for log files, detections, parsed entries, collector offsets, and evaluation runs.
- Dashboard summaries for critical, high, medium, and low risk findings.
- Evaluation support for rule-hit counts and chapter-three confusion-matrix metrics.

## Architecture

The system is split into the three layers described in chapter three:

1. Data acquisition layer
   - Upload endpoint: `POST /api/logs/upload`
   - Collector endpoint: `POST /api/collector/run`
   - Collector status: `GET /api/collector/status`

2. Analysis engine
   - Rule and heuristic engine: `src/lib/log-analyzer.ts`
   - Hybrid orchestration: `src/lib/hybrid-analysis.ts`
   - Privacy sanitizer: `src/lib/privacy.ts`
   - ML client: `src/lib/ml-service.ts`
   - Python service: `mini-services/ml-analyzer`

3. Presentation layer
   - Dashboard: `src/app/page.tsx`
   - Log history and detail APIs: `src/app/api/logs`
   - Evaluation API: `POST /api/evaluation/run`
   - Model training API: `POST /api/model/train`

## Detection Coverage

The rule engine detects:

- Failed Linux logins and unknown-user attempts.
- Brute force behaviour using a threshold and time window.
- Direct root login and sudo privilege escalation.
- SQL injection, path traversal, XSS, web shell probes, and suspicious scanners.
- Reconnaissance bursts from repeated web probes.
- Data exfiltration probes against backup/export/dump paths.
- Kernel and service-level anomalies from syslog.
- Multi-step attacks by correlating web and Linux events from the same IP.

## Setup

Create an environment file from `env.sample`.

For Supabase, use two connection strings:

- `DATABASE_URL`: the Supabase pooler URL for normal app traffic.
- `DIRECT_URL`: the direct database URL for `prisma db push` and future migrations.

On the Supabase free tier, keep the runtime URL on the pooler host and keep `sslmode=require`. For Prisma, `connection_limit=1` and `pgbouncer=true` are the safe defaults for the pooled runtime URL.

If your dashboard only gives you the direct connection string at first, you can temporarily reuse that direct host in `DATABASE_URL` as well. That works for local development and `next build`, but the pooler URL is still the better long-term runtime choice.

If the direct host is IPv6-only from your network, use the Supabase session pooler on port `5432` as the `DIRECT_URL` fallback for Prisma schema commands.

```bash
cp env.sample .env
npm install
npm run db:check
npm run db:generate
npm run db:push
```

If you are not using Supabase, any reachable PostgreSQL instance will work as long as `DATABASE_URL` and `DIRECT_URL` both point to the same database.

Start the Python ML service:

```bash
cd mini-services/ml-analyzer
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

Start the Next.js app:

```bash
npm run dev:local
```

Open `http://localhost:3000`.

## Evaluation

The evaluation endpoint expects a dataset directory containing `.log`, `.txt`, or `.json` files. It samples 300-500 usable lines by default and returns:

- Template count.
- Isolation Forest anomaly count and anomaly rate.
- Score quantiles.
- Rule-hit counts by suspicious activity type.
- Optional accuracy, precision, recall, and F1 when truth-table counts are supplied.

Example confusion-matrix payload:

```json
{
  "datasetDir": "C:/datasets/log-eval",
  "confusionMatrix": {
    "truePositive": 18,
    "falsePositive": 2,
    "falseNegative": 3,
    "trueNegative": 27
  }
}
```

## Verification

```bash
npm run test
npm run lint
```
