const endpoint = process.env.HEALTHCHECK_URL || 'http://127.0.0.1:8876/api/health';
const maximumAgeSeconds = Number(process.env.MAX_SNAPSHOT_AGE_SECONDS || 7200);

try {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
  const payload = await response.json();
  if (!response.ok || payload.status !== 'ok') {
    throw new Error(`runtime reported ${response.status} ${payload.status || 'unknown'}`);
  }
  if (payload.ageSeconds > maximumAgeSeconds) {
    throw new Error(`snapshot is ${payload.ageSeconds}s old; maximum is ${maximumAgeSeconds}s`);
  }
  const failedSource = (payload.sourceHealth || []).find((source) => !source.ok);
  if (failedSource) {
    throw new Error(`source ${failedSource.id} is degraded`);
  }
  console.log(`healthy block=${payload.blockNumber} age=${payload.ageSeconds}s completeThrough=${payload.completeThrough}`);
} catch (error) {
  console.error(`healthcheck failed: ${error.message}`);
  process.exitCode = 1;
}
