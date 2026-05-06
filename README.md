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
- Netlify-hosted internal ML mode with state persisted across deploys via Netlify Blobs.

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
   - Internal Netlify-compatible ML engine: `src/lib/ml-engine.ts`
   - Optional Python companion service: `mini-services/ml-analyzer`

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

Authentication is configured with environment variables:

- `AUTH_SECRET`: signing secret for the app session cookie. `NEXTAUTH_SECRET` is also accepted as an alias.
- `APP_USERNAME`: dashboard username.
- `APP_PASSWORD`: dashboard password.

Start the Next.js app:

```bash
npm run dev:local
```

Open `http://localhost:3000`.

Sign in with the credentials from `.env`.

The app now runs its ML analysis internally by default, including on Netlify. The Python mini-service is optional and only needed when you explicitly set `ML_SERVICE_MODE=external`.

Optional external Python service:

```bash
cd mini-services/ml-analyzer
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

## Using The App

You do not need your own log file to get started.

1. Sign in on `/login`.
2. Use one of the bundled demo incidents from the upload panel if you do not have a real log file yet.
3. Or upload a `.log`, `.txt`, or `.json` file for analysis.
4. Review the alert summary, parsed entries, and suspicious activity timeline.
5. Use `Export` to download the current analysis as a real JSON file.

The dashboard also supports:

- Collector runs against configured server log paths.
- Model training using the bundled normal-log dataset or a custom directory.
- Evaluation using the bundled evaluation dataset or a custom directory.

## ML Service Notes

The default `ML_SERVICE_MODE=internal` path runs the anomaly model inside the Next.js app, so uploaded log analysis, model training, and evaluation all work inside a single Netlify deployment.

When deployed on Netlify, trained model state is stored in Netlify Blobs so it survives new function instances and new deploys. During local development, the same state falls back to `mini-services/ml-analyzer/state/ml-model-state.json`.

If you want to keep using the Python service instead, set `ML_SERVICE_MODE=external` and provide a reachable `ML_SERVICE_URL`.

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

If you do not supply a dataset directory, the app falls back to `EVALUATION_DATASET_DIR`, and if that value is left at `examples/evaluation-dataset`, a bundled demo dataset is materialized automatically.

## Deploying To Netlify

This repository now includes [netlify.toml](./netlify.toml), which uses:

- build command: `npm run build:netlify`
- publish directory: `.next`

Before deploying, keep these platform constraints in mind:

1. The Next.js app is a good fit for Netlify.
2. The PostgreSQL database is a good fit for Netlify Functions when you keep using the pooled Supabase runtime URL.
3. The ML service can now stay inside this same Netlify deployment when you keep `ML_SERVICE_MODE=internal`. Netlify Functions handle the inference and Netlify Blobs persist the trained model state.
4. The optional Python service remains available for self-hosted or compatibility scenarios when you explicitly switch to `ML_SERVICE_MODE=external`.
5. The log collector is mainly useful on self-hosted Linux infrastructure where `/var/log/...` paths exist. On Netlify it will usually scan zero files unless you intentionally point it at another readable path source.

Recommended deployment flow:

1. Push the repo to GitHub.
2. Create a new Netlify site from that repository.
3. Add the environment variables from `.env` in Netlify with Build and Functions scope as appropriate. At minimum:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `AUTH_SECRET`
   - `NEXTAUTH_SECRET` if you use that name instead of `AUTH_SECRET`
   - `APP_USERNAME`
   - `APP_PASSWORD`
   - `ML_SERVICE_MODE`
   - `NORMAL_LOG_DIR`
   - `EVALUATION_DATASET_DIR`
4. Keep `NORMAL_LOG_DIR="examples/normal-training-dataset"` and `EVALUATION_DATASET_DIR="examples/evaluation-dataset"` if you want the bundled datasets.
5. Leave `ML_SERVICE_MODE="internal"` to host the ML path on Netlify. Only add `ML_SERVICE_URL` if you are deliberately routing to the optional external Python service.
6. Trigger a deploy.

The public access request and password recovery forms prefer PostgreSQL when `DATABASE_URL` is configured. On Netlify, they fall back to site-scoped Netlify Blobs so those requests can still be captured before a database is connected.

If you use the Netlify CLI, import environment variables before deploying:

```bash
npx netlify-cli env:import .env
npx netlify-cli deploy --prod
```

## Verification

```bash
npx tsc --noEmit
npm run test
npm run lint
npm run build:local
```
