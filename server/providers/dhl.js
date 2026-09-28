// Offizielle DHL Shipment Tracking – Unified API (DHL Paket, DHL Express, Deutsche Post).
// Kostenloser Schlüssel: https://developer.dhl.com → App anlegen → „Shipment Tracking - Unified“.

import { STATUS } from '../../shared/status.js';
import { cleanText, fetchJson, finalizeEvents, httpError, joinLocation, refineStatusFromText, toIso } from './common.js';

const ENDPOINT = 'https://api-eu.dhl.com/track/shipments';
const DHL_CARRIERS = new Set(['dhl', 'dhl-express', 'deutsche-post']);

const STATUS_MAP = {
  'pre-transit': STATUS.INFO_RECEIVED,
  transit: STATUS.IN_TRANSIT,
  delivered: STATUS.DELIVERED,
  failure: STATUS.EXCEPTION,
  unknown: STATUS.UNKNOWN,
};

function mapStatus(statusCode, text) {
  return refineStatusFromText(STATUS_MAP[statusCode] ?? STATUS.UNKNOWN, text);
}

function formatLocation(location) {
  const a = location?.address;
  if (!a) return '';
  return joinLocation(a.addressLocality, a.countryCode && a.countryCode !== 'DE' ? a.countryCode : '');
}

export function normalizeDhl(body) {
  const s = body?.shipments?.[0];
  if (!s) return null;

  const events = finalizeEvents(
    (s.events ?? []).map((e) => {
      const text = e.description || e.status;
      return { time: e.timestamp, description: text, location: formatLocation(e.location), status: mapStatus(e.statusCode, text) };
    }),
  );

  const latestText = s.status?.description || s.status?.status;
  return {
    status: mapStatus(s.status?.statusCode, latestText),
    statusText: cleanText(latestText),
    estimatedDelivery: toIso(s.estimatedTimeOfDelivery) ?? toIso(s.estimatedDeliveryTimeFrame?.estimatedThrough),
    events,
    carrierName: s.service ? `DHL (${s.service})` : 'DHL',
  };
}

export function createDhlProvider({ apiKey, language = 'de', fetchImpl = fetch }) {
  const name = 'DHL';
  return {
    id: 'dhl',
    name: 'DHL API',
    supports: (carrierId) => DHL_CARRIERS.has(carrierId),
    async track(number) {
      const url = new URL(ENDPOINT);
      url.searchParams.set('trackingNumber', number);
      url.searchParams.set('language', language);
      const { res, body } = await fetchJson(fetchImpl, name, url, {
        headers: { 'DHL-API-Key': apiKey, Accept: 'application/json' },
      });
      if (res.status === 404) return null; // DHL kennt die Nummer nicht → nächster Anbieter
      if (!res.ok) throw httpError(name, res);
      return normalizeDhl(body);
    },
  };
}
