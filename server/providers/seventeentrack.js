// 17TRACK Tracking API v2.2 – Aggregator für über 3.000 Versanddienstleister.
// Schlüssel: https://api.17track.net → Einstellungen → Security → Access Key.
// Nummern müssen einmalig registriert werden; 17TRACK lädt die Daten dann im Hintergrund.

import { STATUS } from '../../shared/status.js';
import { ProviderError, cleanText, fetchJson, finalizeEvents, httpError, joinLocation, toIso } from './common.js';

const BASE = 'https://api.17track.net/track/v2.2';
const ERR_NOT_REGISTERED = -18019902;
const ERR_ALREADY_REGISTERED = -18019901;

const STATUS_MAP = {
  NotFound: STATUS.PENDING,
  InfoReceived: STATUS.INFO_RECEIVED,
  InTransit: STATUS.IN_TRANSIT,
  Expired: STATUS.EXPIRED,
  AvailableForPickup: STATUS.AVAILABLE_FOR_PICKUP,
  OutForDelivery: STATUS.OUT_FOR_DELIVERY,
  DeliveryFailure: STATUS.FAILED_ATTEMPT,
  Delivered: STATUS.DELIVERED,
  Exception: STATUS.EXCEPTION,
};

/** "InTransit_PickedUp" → in_transit */
function mapStatus(value) {
  if (!value) return STATUS.UNKNOWN;
  return STATUS_MAP[String(value).split('_')[0]] ?? STATUS.UNKNOWN;
}

function formatEventLocation(e) {
  if (e.location) return e.location;
  const a = e.address ?? {};
  return joinLocation(a.city, a.state, a.country);
}

export function normalize17Track(item) {
  const info = item?.track_info;
  if (!info) return null;
  const providers = info.tracking?.providers ?? [];

  const events = finalizeEvents(
    providers.flatMap((p) =>
      (p.events ?? []).map((e) => ({
        time: e.time_iso ?? e.time_utc,
        description: e.description,
        location: formatEventLocation(e),
        status: mapStatus(e.sub_status ?? e.stage),
      })),
    ),
  );

  const eta = info.time_metrics?.estimated_delivery_date;
  const carrierName = providers.map((p) => p.provider?.name).find(Boolean) ?? null;
  return {
    status: mapStatus(info.latest_status?.status),
    statusText: cleanText(info.latest_event?.description) || events[0]?.description || '',
    estimatedDelivery: toIso(eta?.to ?? eta?.from),
    events,
    carrierName: carrierName ? cleanText(carrierName) : null,
  };
}

function apiError(body) {
  const e = body?.data?.errors?.[0];
  return new ProviderError(`17TRACK: ${cleanText(e?.message) || `Fehlercode ${body?.code}`}`);
}

export function create17TrackProvider({ apiKey, fetchImpl = fetch }) {
  const name = '17TRACK';

  async function call(action, payload) {
    const { res, body } = await fetchJson(fetchImpl, name, `${BASE}/${action}`, {
      method: 'POST',
      headers: { '17token': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw httpError(name, res);
    if (!body || body.code !== 0) throw apiError(body);
    return body.data ?? {};
  }

  const pending = (message) => ({ status: STATUS.PENDING, statusText: '', estimatedDelivery: null, events: [], carrierName: null, message });

  return {
    id: '17track',
    name: '17TRACK',
    supports: () => true,
    async track(number) {
      const data = await call('gettrackinfo', [{ number }]);
      const accepted = data.accepted?.find((a) => a.number === number) ?? data.accepted?.[0];
      if (accepted) return normalize17Track(accepted) ?? pending('17TRACK hat noch keine Daten zu dieser Sendung.');

      const rejected = data.rejected?.[0]?.error;
      if (rejected?.code === ERR_NOT_REGISTERED) {
        const reg = await call('register', [{ number }]);
        const regError = reg.rejected?.[0]?.error;
        if (regError && regError.code !== ERR_ALREADY_REGISTERED) {
          throw new ProviderError(`17TRACK: ${cleanText(regError.message)}`);
        }
        return pending('Sendung wurde bei 17TRACK angemeldet – die Daten erscheinen in wenigen Minuten.');
      }
      if (rejected) return pending(`17TRACK: ${cleanText(rejected.message)}`);
      return null;
    },
  };
}
