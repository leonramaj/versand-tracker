// Tracking-Service: wählt passende Anbieter, fragt sie der Reihe nach ab und cached Ergebnisse.

import {
  detectCarriers, getCarrier, isPlausibleTrackingNumber, normalizeTrackingNumber, trackingUrl,
} from '../shared/carriers.js';
import { STATUS } from '../shared/status.js';
import { TtlCache } from './cache.js';
import { createDemoProvider, isDemoNumber } from './providers/demo.js';
import { createDhlProvider } from './providers/dhl.js';
import { create17TrackProvider } from './providers/seventeentrack.js';
import { createShip24Provider } from './providers/ship24.js';

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.status = 400;
  }
}

const MIN_FORCE_INTERVAL_MS = 60_000;
const PENDING_TTL_MS = 120_000;

function hasData(result) {
  return result.events.length > 0 || (result.status !== STATUS.PENDING && result.status !== STATUS.UNKNOWN);
}

export function createTrackingService({ config, fetchImpl = fetch, now = () => Date.now() }) {
  const demo = config.demo ? createDemoProvider({ now }) : null;
  const providers = [];
  if (config.dhlApiKey) providers.push(createDhlProvider({ apiKey: config.dhlApiKey, language: config.language, fetchImpl }));
  if (config.ship24ApiKey) providers.push(createShip24Provider({ apiKey: config.ship24ApiKey, plan: config.ship24Plan, fetchImpl }));
  if (config.track17ApiKey) providers.push(create17TrackProvider({ apiKey: config.track17ApiKey, fetchImpl }));

  const cache = new TtlCache({ now });
  const inflight = new Map();
  const ttlMs = config.cacheTtlSeconds * 1000;

  function resolve(numberInput, carrierId) {
    const number = normalizeTrackingNumber(numberInput);
    if (!isPlausibleTrackingNumber(number)) {
      throw new InputError('Ungültige Sendungsnummer – erlaubt sind 5 bis 40 Buchstaben und Ziffern.');
    }
    const candidates = detectCarriers(number);
    let carrier = candidates[0]?.carrier ?? null;
    if (carrierId) {
      carrier = getCarrier(carrierId);
      if (!carrier) throw new InputError(`Unbekannter Anbieter „${carrierId}“.`);
    }
    return { number, carrier, candidates };
  }

  async function queryProviders(number, carrier) {
    const chain = demo && isDemoNumber(number) ? [demo] : providers.filter((p) => p.supports(carrier?.id ?? null, number));
    if (chain.length === 0) {
      return {
        status: STATUS.UNKNOWN, statusText: '', estimatedDelivery: null, events: [], carrierName: null, provider: null,
        message: providers.length
          ? 'Für diesen Anbieter ist keine Live-Abfrage eingerichtet – nutze den Link zur Sendungsverfolgung.'
          : 'Live-Status ist noch nicht eingerichtet (API-Schlüssel fehlt). Nutze den Link zur Sendungsverfolgung des Anbieters.',
      };
    }

    const errors = [];
    let fallback = null;
    for (const provider of chain) {
      try {
        const result = await provider.track(number, carrier);
        if (!result) continue;
        const tagged = { message: null, ...result, provider: provider.name };
        if (hasData(tagged)) return tagged;
        fallback ??= tagged;
      } catch (err) {
        errors.push(err);
      }
    }
    if (fallback) return fallback;
    if (errors.length) throw errors[0];
    return {
      status: STATUS.PENDING, statusText: '', estimatedDelivery: null, events: [], carrierName: null,
      provider: chain.map((p) => p.name).join(', '),
      message: 'Zu dieser Sendungsnummer liegen noch keine Informationen vor. Neue Sendungen erscheinen oft erst nach einigen Stunden.',
    };
  }

  async function track(numberInput, { carrierId = null, force = false } = {}) {
    const { number, carrier, candidates } = resolve(numberInput, carrierId);
    const key = `${number}|${carrier?.id ?? ''}`;

    const cached = cache.get(key);
    if (cached && !(force && now() - cached.storedAt >= MIN_FORCE_INTERVAL_MS)) return cached.value;

    if (!inflight.has(key)) {
      const promise = (async () => {
        const result = await queryProviders(number, carrier);
        const value = {
          number,
          carrier: carrier ? { id: carrier.id, name: carrier.name } : null,
          candidates: candidates.slice(0, 5).map((c) => ({ id: c.carrier.id, name: c.carrier.name, score: c.score, checksumValid: c.checksumValid })),
          trackingUrl: trackingUrl(carrier, number),
          ...result,
          fetchedAt: new Date(now()).toISOString(),
        };
        if (value.provider) cache.set(key, value, hasData(value) ? ttlMs : Math.min(ttlMs, PENDING_TTL_MS));
        return value;
      })().finally(() => inflight.delete(key));
      inflight.set(key, promise);
    }
    return inflight.get(key);
  }

  function detect(numberInput) {
    const number = normalizeTrackingNumber(numberInput);
    return {
      number,
      valid: isPlausibleTrackingNumber(number),
      candidates: detectCarriers(number).map((c) => ({
        id: c.carrier.id, name: c.carrier.name, score: c.score, checksumValid: c.checksumValid,
        trackingUrl: trackingUrl(c.carrier, number),
      })),
    };
  }

  return {
    track,
    detect,
    info: () => ({ providers: providers.map((p) => p.name), demo: Boolean(demo) }),
  };
}
