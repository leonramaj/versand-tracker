import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTrackingService } from '../server/tracking.js';
import { baseConfig, dhlResponse, fakeFetch, ship24Response } from './helpers.js';

function clock(start = Date.parse('2026-09-28T12:00:00Z')) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

describe('Tracking-Service', () => {
  it('liefert ohne API-Schlüssel Anbieter, Link und einen Hinweis', async () => {
    const service = createTrackingService({ config: baseConfig, fetchImpl: fakeFetch(() => assert.fail('kein Netz')) });
    const r = await service.track('0034 0434 1610 9404 2557');
    assert.equal(r.number, '00340434161094042557');
    assert.equal(r.carrier.id, 'dhl');
    assert.equal(r.status, 'unknown');
    assert.equal(r.provider, null);
    assert.match(r.trackingUrl, /dhl\.de.*piececode=00340434161094042557/);
    assert.match(r.message, /API-Schlüssel fehlt/);
  });

  it('beantwortet Demo-Nummern ohne Netzwerk', async () => {
    const fetchImpl = fakeFetch(() => assert.fail('kein Netz'));
    const service = createTrackingService({ config: { ...baseConfig, ship24ApiKey: 's' }, fetchImpl });
    const r = await service.track('demo2');
    assert.equal(r.status, 'delivered');
    assert.equal(r.provider, 'Demo');
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('fragt DHL-Nummern zuerst bei DHL ab', async () => {
    const fetchImpl = fakeFetch(({ url }) => (url.includes('dhl.com') ? { body: dhlResponse } : assert.fail('nicht Ship24')));
    const service = createTrackingService({ config: { ...baseConfig, dhlApiKey: 'd', ship24ApiKey: 's' }, fetchImpl });
    const r = await service.track('00340434161094042557');
    assert.equal(r.provider, 'DHL API');
    assert.equal(r.status, 'out_for_delivery');
  });

  it('weicht auf den Aggregator aus, wenn DHL nichts findet oder ausfällt', async () => {
    for (const dhlStatus of [404, 500]) {
      const fetchImpl = fakeFetch(({ url }) => (url.includes('dhl.com') ? { status: dhlStatus, body: {} } : { body: ship24Response }));
      const service = createTrackingService({ config: { ...baseConfig, dhlApiKey: 'd', ship24ApiKey: 's' }, fetchImpl });
      const r = await service.track('00340434161094042557');
      assert.equal(r.provider, 'Ship24', `bei DHL-Status ${dhlStatus}`);
      assert.equal(fetchImpl.calls.length, 2);
    }
  });

  it('nutzt für andere Paketdienste direkt den Aggregator', async () => {
    const fetchImpl = fakeFetch(({ url }) => (url.includes('ship24') ? { body: ship24Response } : assert.fail('nicht DHL')));
    const service = createTrackingService({ config: { ...baseConfig, dhlApiKey: 'd', ship24ApiKey: 's' }, fetchImpl });
    const r = await service.track('01234567890123');
    assert.equal(r.carrier.id, 'dpd');
    assert.equal(r.status, 'delivered');
  });

  it('wirft den Fehler weiter, wenn kein Anbieter antwortet', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 429 }));
    const service = createTrackingService({ config: { ...baseConfig, ship24ApiKey: 's' }, fetchImpl });
    await assert.rejects(service.track('01234567890123'), (err) => err.status === 429);
  });

  it('cached Ergebnisse und erlaubt erzwungene Aktualisierung frühestens nach einer Minute', async () => {
    const now = clock();
    const fetchImpl = fakeFetch(() => ({ body: ship24Response }));
    const service = createTrackingService({ config: { ...baseConfig, ship24ApiKey: 's' }, fetchImpl, now });

    await service.track('01234567890123');
    await service.track('01234567890123');
    await service.track('01234567890123', { force: true });
    assert.equal(fetchImpl.calls.length, 1);

    now.advance(61_000);
    await service.track('01234567890123', { force: true });
    assert.equal(fetchImpl.calls.length, 2);

    now.advance(601_000);
    await service.track('01234567890123');
    assert.equal(fetchImpl.calls.length, 3);
  });

  it('bündelt gleichzeitige Abfragen derselben Nummer', async () => {
    const fetchImpl = fakeFetch(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { body: ship24Response };
    });
    const service = createTrackingService({ config: { ...baseConfig, ship24ApiKey: 's' }, fetchImpl });
    await Promise.all([service.track('01234567890123'), service.track('01234567890123')]);
    assert.equal(fetchImpl.calls.length, 1);
  });

  it('respektiert einen manuell gewählten Paketdienst', async () => {
    const service = createTrackingService({ config: baseConfig });
    const r = await service.track('01234567890123', { carrierId: 'hermes' });
    assert.equal(r.carrier.id, 'hermes');
    assert.match(r.trackingUrl, /myhermes\.de/);
  });

  it('lehnt ungültige Eingaben ab', async () => {
    const service = createTrackingService({ config: baseConfig });
    await assert.rejects(service.track('ab'), { name: 'InputError', status: 400 });
    await assert.rejects(service.track('01234567890123', { carrierId: 'xyz' }), /Unbekannter Anbieter/);
  });
});
