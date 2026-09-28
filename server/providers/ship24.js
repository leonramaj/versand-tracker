// Ship24 – Tracking-Aggregator für über 1.500 Versanddienstleister weltweit.
// Schlüssel: https://www.ship24.com → Dashboard → API.

import { STATUS, isValidStatus } from '../../shared/status.js';
import { ProviderError, cleanText, fetchJson, finalizeEvents, httpError, toIso } from './common.js';

const BASE = 'https://api.ship24.com/public/v1';

function mapMilestone(milestone) {
  return isValidStatus(milestone) ? milestone : STATUS.UNKNOWN;
}

export function normalizeShip24(body) {
  const tracking = body?.data?.trackings?.[0];
  if (!tracking) return null;
  const { shipment = {}, events = [], tracker = {} } = tracking;

  const normalizedEvents = finalizeEvents(
    events.map((e) => ({
      time: e.occurrenceDatetime ?? e.datetime,
      description: e.status,
      location: e.location,
      status: mapMilestone(e.statusMilestone),
    })),
  );

  const courier = events.find((e) => e.courierCode)?.courierCode ?? tracker.courierCode?.[0] ?? null;
  return {
    status: mapMilestone(shipment.statusMilestone ?? (normalizedEvents.length ? STATUS.IN_TRANSIT : STATUS.PENDING)),
    statusText: normalizedEvents[0]?.description ?? '',
    estimatedDelivery: toIso(shipment.delivery?.estimatedDeliveryDate),
    events: normalizedEvents,
    carrierName: courier ? cleanText(courier) : null,
  };
}

export function createShip24Provider({ apiKey, plan = 'per-shipment', fetchImpl = fetch }) {
  const name = 'Ship24';
  // Tarif „pro Sendung“: Tracker anlegen und Ergebnis direkt abholen.
  // Tarif „pro Abfrage“: reine Suche ohne dauerhaften Tracker.
  const path = plan === 'per-call' ? '/tracking/search' : '/trackers/track';
  return {
    id: 'ship24',
    name: 'Ship24',
    supports: () => true,
    async track(number) {
      const { res, body } = await fetchJson(fetchImpl, name, `${BASE}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ trackingNumber: number }),
        timeoutMs: 65_000, // die erste Abfrage kann laut Ship24 bis zu einer Minute dauern
      });
      if (!res.ok) {
        const detail = body?.errors?.[0]?.message;
        if (detail && res.status !== 401 && res.status !== 403 && res.status !== 429) {
          throw new ProviderError(`Ship24: ${cleanText(detail)}`);
        }
        throw httpError(name, res);
      }
      return normalizeShip24(body);
    },
  };
}
