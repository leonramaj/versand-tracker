// Konfiguration aus Umgebungsvariablen (optional aus einer .env-Datei im Projektordner).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    dhlApiKey: env.DHL_API_KEY?.trim() || null,
    ship24ApiKey: env.SHIP24_API_KEY?.trim() || null,
    ship24Plan: env.SHIP24_PLAN === 'per-call' ? 'per-call' : 'per-shipment',
    track17ApiKey: env.TRACK17_API_KEY?.trim() || null,
    language: env.TRACKING_LANGUAGE || 'de',
    cacheTtlSeconds: int(env.CACHE_TTL_SECONDS, 600),
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 60),
    trustProxy: env.TRUST_PROXY === 'true',
    demo: env.DEMO_MODE !== 'false',
  };
}
