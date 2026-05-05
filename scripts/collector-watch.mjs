const intervalSeconds = Number(process.env.COLLECTOR_INTERVAL_SECONDS || '300');
const apiBase = process.env.COLLECTOR_API_BASE || 'http://127.0.0.1:3000';
const endpoint = `${apiBase.replace(/\/$/, '')}/api/collector/run`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCycle() {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`[collector-watch] ${startedAt} failed`, payload);
      return;
    }
    console.log(`[collector-watch] ${startedAt} completed`, payload);
  } catch (error) {
    console.error(`[collector-watch] ${startedAt} error`, error);
  }
}

async function main() {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error('[collector-watch] COLLECTOR_INTERVAL_SECONDS must be a positive number.');
    process.exit(1);
  }

  console.log(`[collector-watch] Starting poller. Interval: ${intervalSeconds}s. Endpoint: ${endpoint}`);
  while (true) {
    await runCycle();
    await wait(intervalSeconds * 1000);
  }
}

main().catch((error) => {
  console.error('[collector-watch] fatal error', error);
  process.exit(1);
});

