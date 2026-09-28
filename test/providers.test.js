import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { finalizeEvents, refineStatusFromText, toIso } from '../server/providers/common.js';
import { demoTracking } from '../server/providers/demo.js';
import { createDhlProvider, normalizeDhl } from '../server/providers/dhl.js';
import { create17TrackProvider, normalize17Track } from '../server/providers/seventeentrack.js';
import { createShip24Provider, normalizeShip24 } from '../server/providers/ship24.js';
import { dhlResponse, fakeFetch, ship24Response, track17Response } from './helpers.js';

describe('Hilfsfunktionen', () => {
  it('lässt Ortszeiten ohne Zeitzone unverändert und normalisiert den Rest', () => {
    assert.equal(toIso('2026-09-26T08:10:00'), '2026-09-26T08:10:00');
    assert.equal(toIso('2026-09-29'), '2026-09-29');
    assert.equal(toIso('2026-09-27T09:12:00+02:00'), '2026-09-27T07:12:00.000Z');
    assert.equal(toIso('kein datum'), null);
    assert.equal(toIso(null), null);
  });

  it('sortiert Ereignisse absteigend und entfernt Duplikate und leere Einträge', () => {
    const events = finalizeEvents([
      { time: '2026-09-01T10:00:00Z', description: 'A', location: '' },
      { time: '2026-09-02T10:00:00Z', description: 'B', location: 'X' },
      { time: '2026-09-01T10:00:00Z', description: 'A', location: '' },
      { time: '2026-09-03T10:00:00Z', description: '  ', location: '' },
    ]);
    assert.deepEqual(events.map((e) => e.description), ['B', 'A']);
  });

  it('verfeinert grobe Status anhand des Textes', () => {
    assert.equal(refineStatusFromText('in_transit', 'Die Sendung wurde in das Zustellfahrzeug geladen.'), 'out_for_delivery');
    assert.equal(refineStatusFromText('in_transit', 'Die Sendung liegt in der Filiale zur Abholung bereit.'), 'available_for_pickup');
    assert.equal(refineStatusFromText('in_transit', 'Zustellversuch nicht erfolgreich'), 'failed_attempt');
    assert.equal(refineStatusFromText('delivered', 'Zustellfahrzeug'), 'delivered');
  });
});

describe('DHL', () => {
  it('normalisiert die Unified-API-Antwort', () => {
    const r = normalizeDhl(dhlResponse);
    assert.equal(r.status, 'out_for_delivery');
    assert.equal(r.statusText, 'Die Sendung wurde in das Zustellfahrzeug geladen.');
    assert.equal(r.estimatedDelivery, '2026-09-27');
    assert.equal(r.events.length, 3);
    assert.equal(r.events[0].location, 'Köln');
    assert.equal(r.events[2].status, 'info_received');
  });

  it('sendet den API-Schlüssel und liefert null, wenn DHL die Nummer nicht kennt', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 404, body: { title: 'No result found' } }));
    const dhl = createDhlProvider({ apiKey: 'k', fetchImpl });
    assert.equal(await dhl.track('00340434161094042557'), null);
    const [call] = fetchImpl.calls;
    assert.equal(call.headers['DHL-API-Key'], 'k');
    assert.match(call.url, /api-eu\.dhl\.com\/track\/shipments\?trackingNumber=00340434161094042557&language=de/);
  });

  it('meldet einen ungültigen Schlüssel verständlich', async () => {
    const dhl = createDhlProvider({ apiKey: 'falsch', fetchImpl: fakeFetch(() => ({ status: 401 })) });
    await assert.rejects(dhl.track('00340434161094042557'), /API-Schlüssel ungültig/);
  });

  it('ist nur für DHL-Dienste zuständig', () => {
    const dhl = createDhlProvider({ apiKey: 'k', fetchImpl: fakeFetch(() => ({})) });
    assert.equal(dhl.supports('dhl'), true);
    assert.equal(dhl.supports('deutsche-post'), true);
    assert.equal(dhl.supports('dpd'), false);
  });
});

describe('Ship24', () => {
  it('normalisiert die Antwort und nimmt den Status der Sendung', () => {
    const r = normalizeShip24(ship24Response);
    assert.equal(r.status, 'delivered');
    assert.equal(r.events[0].description, 'Zugestellt an Empfänger');
    assert.equal(r.events[0].time, '2026-09-26T14:32:00');
    assert.equal(r.carrierName, 'dpd-de');
  });

  it('nutzt Bearer-Auth und den passenden Endpunkt je Tarif', async () => {
    const fetchImpl = fakeFetch(() => ({ body: ship24Response }));
    await createShip24Provider({ apiKey: 's', fetchImpl }).track('01234567890123');
    await createShip24Provider({ apiKey: 's', plan: 'per-call', fetchImpl }).track('01234567890123');
    assert.equal(fetchImpl.calls[0].url, 'https://api.ship24.com/public/v1/trackers/track');
    assert.equal(fetchImpl.calls[1].url, 'https://api.ship24.com/public/v1/tracking/search');
    assert.equal(fetchImpl.calls[0].method, 'POST');
    assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer s');
    assert.deepEqual(fetchImpl.calls[0].body, { trackingNumber: '01234567890123' });
  });

  it('gibt Fehlermeldungen von Ship24 weiter', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 400, body: { errors: [{ code: 'invalid', message: 'Tracking number is invalid' }] } }));
    await assert.rejects(createShip24Provider({ apiKey: 's', fetchImpl }).track('XX'), /Ship24: Tracking number is invalid/);
  });
});

describe('17TRACK', () => {
  it('normalisiert die Antwort inkl. mehrerer Paketdienste', () => {
    const r = normalize17Track(track17Response.data.accepted[0]);
    assert.equal(r.status, 'in_transit');
    assert.equal(r.events.length, 2);
    assert.equal(r.events[0].location, 'Frankfurt, DE');
    assert.equal(r.events[1].location, 'Shenzhen');
    assert.equal(r.estimatedDelivery, '2026-09-30T22:00:00.000Z');
    assert.equal(r.carrierName, 'China Post');
  });

  it('registriert unbekannte Nummern automatisch', async () => {
    const fetchImpl = fakeFetch(({ url }) => {
      if (url.endsWith('/gettrackinfo')) {
        return { body: { code: 0, data: { accepted: [], rejected: [{ number: 'RR123456785CN', error: { code: -18019902, message: 'not registered' } }] } } };
      }
      return { body: { code: 0, data: { accepted: [{ number: 'RR123456785CN' }], rejected: [] } } };
    });
    const r = await create17TrackProvider({ apiKey: 't', fetchImpl }).track('RR123456785CN');
    assert.equal(r.status, 'pending');
    assert.match(r.message, /angemeldet/);
    assert.deepEqual(fetchImpl.calls.map((c) => c.url.split('/').at(-1)), ['gettrackinfo', 'register']);
    assert.equal(fetchImpl.calls[0].headers['17token'], 't');
    assert.deepEqual(fetchImpl.calls[1].body, [{ number: 'RR123456785CN' }]);
  });

  it('meldet API-Fehler', async () => {
    const fetchImpl = fakeFetch(() => ({ body: { code: -18010002, data: { errors: [{ code: -18010002, message: 'Invalid access key.' }] } } }));
    await assert.rejects(create17TrackProvider({ apiKey: 't', fetchImpl }).track('RR123456785CN'), /17TRACK: Invalid access key/);
  });
});

describe('Demo', () => {
  it('liefert je nach Endziffer unterschiedliche Status', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    assert.equal(demoTracking('DEMO2', now).status, 'delivered');
    assert.equal(demoTracking('DEMO3', now).status, 'out_for_delivery');
    assert.equal(demoTracking('DEMO4', now).status, 'available_for_pickup');
    assert.equal(demoTracking('DEMO', now).status, 'in_transit');
    const r = demoTracking('DEMO1', now);
    assert.ok(Date.parse(r.events[0].time) < now);
    assert.ok(Date.parse(r.events[0].time) > Date.parse(r.events[1].time));
  });
});
