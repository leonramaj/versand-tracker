// Test-Helfer: ein fetch-Ersatz, der vorbereitete Antworten liefert und Aufrufe protokolliert.

export function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const { status = 200, body = {} } = (await handler(call)) ?? {};
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

export const baseConfig = Object.freeze({
  dhlApiKey: null,
  ship24ApiKey: null,
  ship24Plan: 'per-shipment',
  track17ApiKey: null,
  language: 'de',
  cacheTtlSeconds: 600,
  rateLimitPerMinute: 60,
  trustProxy: false,
  demo: true,
});

// --- Beispielantworten der Anbieter (gekürzt, Struktur wie in den API-Dokumentationen) ---

export const dhlResponse = {
  shipments: [{
    id: '00340434161094042557',
    service: 'parcel-de',
    status: {
      timestamp: '2026-09-27T09:12:00+02:00',
      location: { address: { addressLocality: 'Köln' } },
      statusCode: 'transit',
      status: 'In Zustellung',
      description: 'Die Sendung wurde in das Zustellfahrzeug geladen.',
    },
    estimatedTimeOfDelivery: '2026-09-27',
    events: [
      {
        timestamp: '2026-09-27T09:12:00+02:00', location: { address: { addressLocality: 'Köln' } },
        statusCode: 'transit', description: 'Die Sendung wurde in das Zustellfahrzeug geladen.',
      },
      {
        timestamp: '2026-09-26T21:40:00+02:00', location: { address: { addressLocality: 'Köln', countryCode: 'DE' } },
        statusCode: 'transit', description: 'Die Sendung wurde im Ziel-Paketzentrum bearbeitet.',
      },
      {
        timestamp: '2026-09-25T18:00:00+02:00',
        statusCode: 'pre-transit', description: 'Die Auftragsdaten zu dieser Sendung wurden vom Absender elektronisch an DHL übermittelt.',
      },
    ],
  }],
};

export const ship24Response = {
  data: {
    trackings: [{
      tracker: { trackerId: 'abc', trackingNumber: '01234567890123', courierCode: ['dpd-de'] },
      shipment: {
        statusMilestone: 'delivered',
        delivery: { estimatedDeliveryDate: null },
      },
      events: [
        {
          eventId: '1', occurrenceDatetime: '2026-09-26T08:10:00', status: 'Zugestellt',
          location: 'Berlin', statusMilestone: 'in_transit', courierCode: 'dpd-de',
        },
        {
          eventId: '2', occurrenceDatetime: '2026-09-26T14:32:00', status: 'Zugestellt an Empfänger',
          location: 'Berlin', statusMilestone: 'delivered', courierCode: 'dpd-de',
        },
      ],
    }],
  },
};

export const track17Response = {
  code: 0,
  data: {
    accepted: [{
      number: 'RR123456785CN',
      carrier: 3011,
      track_info: {
        latest_status: { status: 'InTransit', sub_status: 'InTransit_Other' },
        latest_event: { description: 'Arrival at Destination', time_iso: '2026-09-25T10:00:00+02:00' },
        time_metrics: { estimated_delivery_date: { source: 'Official', from: '2026-09-29T00:00:00+02:00', to: '2026-10-01T00:00:00+02:00' } },
        tracking: {
          providers: [
            {
              provider: { key: 3011, name: 'China Post' },
              events: [
                { time_iso: '2026-09-20T08:00:00+08:00', description: 'Posting', location: 'Shenzhen', sub_status: 'InTransit_PickedUp' },
              ],
            },
            {
              provider: { key: 7041, name: 'Deutsche Post' },
              events: [
                { time_iso: '2026-09-25T10:00:00+02:00', description: 'Arrival at Destination', location: '', address: { city: 'Frankfurt', country: 'DE' }, sub_status: 'InTransit_Other' },
              ],
            },
          ],
        },
      },
    }],
    rejected: [],
  },
};
