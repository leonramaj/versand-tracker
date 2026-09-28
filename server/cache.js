// Kleiner In-Memory-Cache mit Ablaufzeit, damit API-Kontingente geschont werden.

export class TtlCache {
  constructor({ maxEntries = 1000, now = () => Date.now() } = {}) {
    this.maxEntries = maxEntries;
    this.now = now;
    this.map = new Map();
  }

  /** @returns {{value: any, storedAt: number} | undefined} */
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key, value, ttlMs) {
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value);
    const storedAt = this.now();
    this.map.set(key, { value, storedAt, expiresAt: storedAt + ttlMs });
  }
}

/** Einfaches Rate-Limit pro Schlüssel (z. B. IP) mit festem Zeitfenster. */
export class RateLimiter {
  constructor({ limit, windowMs = 60_000, now = () => Date.now() }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.windows = new Map();
  }

  allow(key) {
    if (!this.limit) return true;
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      if (this.windows.size > 10_000) this.windows.clear();
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    w.count += 1;
    return w.count <= this.limit;
  }
}
