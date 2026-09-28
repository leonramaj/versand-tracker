// Gemeinsame Hilfsfunktionen für die Tracking-Anbieter.

import { STATUS, isValidStatus } from '../../shared/status.js';

export class ProviderError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = 'ProviderError';
    this.status = status;
  }
}

const TIMEOUT_MS = 20_000;

/** fetch mit Timeout; liefert { res, body } und wirft ProviderError bei Netzwerkfehlern. */
export async function fetchJson(fetchImpl, providerName, url, init = {}) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderError(`${providerName} ist nicht erreichbar.`, { cause: err });
  }
  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { res, body };
}

export function httpError(providerName, res) {
  if (res.status === 401 || res.status === 403) {
    return new ProviderError(`${providerName}: API-Schlüssel ungültig oder nicht freigeschaltet.`, { status: 502 });
  }
  if (res.status === 429) {
    return new ProviderError(`${providerName}: Abfragelimit erreicht – bitte später erneut versuchen.`, { status: 429 });
  }
  return new ProviderError(`${providerName} antwortete mit Fehler ${res.status}.`);
}

export function cleanText(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;

/**
 * Parst Zeitangaben tolerant. Ortszeiten ohne Zeitzone (typisch bei Paketdiensten) bleiben
 * unverändert, damit der Browser sie als Ortszeit anzeigt; alles andere wird zu ISO/UTC.
 */
export function toIso(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (LOCAL_DATETIME.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function timeValue(time) {
  const t = time ? Date.parse(time) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/** Neueste Ereignisse zuerst, doppelte Einträge entfernen. */
export function finalizeEvents(events) {
  const seen = new Set();
  const result = [];
  for (const e of events) {
    const event = {
      time: toIso(e.time),
      description: cleanText(e.description),
      location: cleanText(e.location),
      status: isValidStatus(e.status) ? e.status : null,
    };
    if (!event.description && !event.location) continue;
    const key = `${event.time}|${event.description}|${event.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result.sort((a, b) => timeValue(b.time) - timeValue(a.time));
}

/** Leitet aus dem Beschreibungstext einen genaueren Status ab (für Anbieter mit groben Codes). */
export function refineStatusFromText(status, text) {
  const t = cleanText(text).toLowerCase();
  if (!t || status === STATUS.DELIVERED) return status;
  if (/zustellfahrzeug|in zustellung|wird heute zugestellt|out for delivery|with delivery courier/.test(t)) {
    return STATUS.OUT_FOR_DELIVERY;
  }
  if (/zustellversuch|konnte nicht zugestellt|nicht angetroffen|delivery attempt|could not be delivered/.test(t)) {
    return STATUS.FAILED_ATTEMPT;
  }
  if (/abholbereit|zur abholung|liegt .* (filiale|packstation|paketshop)|ready for (pick ?up|collection)/.test(t)) {
    return STATUS.AVAILABLE_FOR_PICKUP;
  }
  return status;
}

export function joinLocation(...parts) {
  return parts.map(cleanText).filter(Boolean).join(', ');
}
