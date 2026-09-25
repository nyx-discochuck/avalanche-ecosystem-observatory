import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, jsonReplacer, 2)}\n`);
  await rename(temp, file);
}

export function jsonReplacer(_key, value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

export async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.COLLECT_TIMEOUT_MS || 30_000);
  const retries = Number(options.retries ?? 2);
  const started = Date.now();
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'avalanche-ecosystem-dashboard/1.0',
          ...options.headers,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText}`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        error.retryAfterMs = Math.min(30_000, Math.max(0, Number(response.headers.get('retry-after')) || 0) * 1000);
        throw error;
      }
      return {
        ok: true,
        data: await response.json(),
        url,
        latencyMs: Date.now() - started,
        fetchedAt: new Date().toISOString(),
        responseDate: response.headers.get('date'),
        lastModified: response.headers.get('last-modified'),
        attempts: attempt + 1,
      };
    } catch (error) {
      if (attempt >= retries || error.retryable === false) {
        return {
          ok: false,
          data: null,
          url,
          latencyMs: Date.now() - started,
          fetchedAt: new Date().toISOString(),
          attempts: attempt + 1,
          error: error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(error?.message || error),
        };
      }
      const delay = error.retryAfterMs || Math.min(8_000, 500 * (2 ** attempt));
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function fetchText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.COLLECT_TIMEOUT_MS || 30_000);
  const retries = Number(options.retries ?? 2);
  const started = Date.now();
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'avalanche-ecosystem-dashboard/1.0',
          ...options.headers,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText}`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        error.retryAfterMs = Math.min(30_000, Math.max(0, Number(response.headers.get('retry-after')) || 0) * 1000);
        throw error;
      }
      return {
        ok: true,
        data: await response.text(),
        url,
        latencyMs: Date.now() - started,
        fetchedAt: new Date().toISOString(),
        responseDate: response.headers.get('date'),
        lastModified: response.headers.get('last-modified'),
        attempts: attempt + 1,
      };
    } catch (error) {
      if (attempt >= retries || error.retryable === false) {
        return {
          ok: false,
          data: null,
          url,
          latencyMs: Date.now() - started,
          fetchedAt: new Date().toISOString(),
          attempts: attempt + 1,
          error: error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(error?.message || error),
        };
      }
      const delay = error.retryAfterMs || Math.min(8_000, 500 * (2 ** attempt));
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function rpc(endpoint, method, params = []) {
  const timeoutMs = Number(process.env.COLLECT_TIMEOUT_MS || 30_000);
  const started = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'avalanche-ecosystem-dashboard/1.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const body = await response.json();
      if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
      return { ok: true, data: body.result, latencyMs: Date.now() - started, fetchedAt: new Date().toISOString(), attempts: attempt + 1 };
    } catch (error) {
      if (attempt === 2) {
        return {
          ok: false,
          data: null,
          latencyMs: Date.now() - started,
          fetchedAt: new Date().toISOString(),
          attempts: attempt + 1,
          error: error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(error?.message || error),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function unixDate(value) {
  if (value == null) return null;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function latestValue(rows, field = 'value') {
  return [...(rows || [])].reverse().find((row) => Number.isFinite(Number(row?.[field])))?.[field] ?? null;
}

export function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

export function safeNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sourceState(result, id) {
  return {
    id,
    ok: Boolean(result?.ok),
    fetchedAt: result?.fetchedAt || new Date().toISOString(),
    latencyMs: result?.latencyMs ?? null,
    attempts: result?.attempts ?? 1,
    error: result?.error || null,
  };
}
