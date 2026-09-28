import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CARRIERS, detectCarriers, dhlExpressChecksumValid, getCarrier, isPlausibleTrackingNumber,
  normalizeTrackingNumber, s10CheckDigit, trackingUrl, upsChecksumValid,
} from '../shared/carriers.js';

const top = (number) => detectCarriers(number)[0]?.carrier.id ?? null;

describe('normalizeTrackingNumber', () => {
  it('entfernt Leerzeichen, Punkte und Bindestriche und wandelt in Großbuchstaben', () => {
    assert.equal(normalizeTrackingNumber(' rr 123 456 785 de '), 'RR123456785DE');
    assert.equal(normalizeTrackingNumber('99.00.123456.12345678'), '990012345612345678');
    assert.equal(normalizeTrackingNumber('1z-999-aa1'), '1Z999AA1');
  });

  it('prüft die Plausibilität', () => {
    assert.equal(isPlausibleTrackingNumber('ABCD'), false);
    assert.equal(isPlausibleTrackingNumber('ABCDE'), true);
    assert.equal(isPlausibleTrackingNumber('ABC<script>'), false);
    assert.equal(isPlausibleTrackingNumber('A'.repeat(41)), false);
  });
});

describe('Prüfziffern', () => {
  it('berechnet die UPU-S10-Prüfziffer', () => {
    assert.equal(s10CheckDigit('12345678'), 5);
    assert.equal(s10CheckDigit('47312482'), 9); // Beispiel aus dem S10-Standard: AA473124829GB
  });

  it('validiert UPS-1Z-Nummern', () => {
    assert.equal(upsChecksumValid('1Z999AA10123456784'), true);
    assert.equal(upsChecksumValid('1Z999AA10123456785'), false);
  });

  it('validiert DHL-Express-Luftfrachtbriefe (Modulo 7)', () => {
    assert.equal(dhlExpressChecksumValid('3318810025'), true);
    assert.equal(dhlExpressChecksumValid('3318810026'), false);
  });
});

describe('detectCarriers', () => {
  const cases = [
    ['00340434161094042557', 'dhl'],
    ['JJD000390007875465826', 'dhl'],
    ['3318810025', 'dhl-express'],
    ['JD014600003868712345', 'dhl-express'],
    ['RR123456785DE', 'deutsche-post'],
    ['CX123456785DE', 'dhl'],
    ['01234567890123', 'dpd'],
    ['H1001234567890123456', 'hermes'],
    ['12345678901', 'gls'],
    ['1Z999AA10123456784', 'ups'],
    ['9612345678901234567890', 'fedex'],
    ['TBA123456789000', 'amazon'],
    ['990012345612345678', 'swiss-post'],
    ['3SABCD1234567', 'postnl'],
    ['6A12345678901', 'laposte'],
    ['9400100000000000000000', 'usps'],
    ['LP00123456789012', 'cainiao'],
    ['YT1234567890123456', 'yunexpress'],
    ['AA473124829GB', 'royal-mail'],
    ['RR123456785AT', 'post-at'],
    ['RR123456785CH', 'swiss-post'],
  ];

  for (const [number, expected] of cases) {
    it(`${number} → ${expected}`, () => assert.equal(top(number), expected));
  }

  it('ordnet S10-Nummern unbekannter Länder einer generischen Landespost zu', () => {
    const [best] = detectCarriers('RR123456785LU');
    assert.equal(best.carrier.id, 'post-lu');
    assert.match(best.carrier.name, /Luxemburg/);
    assert.equal(best.checksumValid, true);
  });

  it('meldet ungültige S10-Prüfziffern, erkennt die Post aber trotzdem', () => {
    const [best] = detectCarriers('RR123456789DE');
    assert.equal(best.carrier.id, 'deutsche-post');
    assert.equal(best.checksumValid, false);
  });

  it('liefert bei mehrdeutigen Nummern mehrere Kandidaten, sortiert nach Wahrscheinlichkeit', () => {
    const ids = detectCarriers('01234567890123').map((c) => c.carrier.id);
    assert.deepEqual(ids, ['dpd', 'hermes']);
    const twelve = detectCarriers('123456789012').map((c) => c.carrier.id);
    assert.equal(twelve[0], 'dhl');
    assert.ok(twelve.includes('gls') && twelve.includes('fedex'));
  });

  it('ignoriert unplausible Eingaben', () => {
    assert.deepEqual(detectCarriers('abc'), []);
    assert.deepEqual(detectCarriers(''), []);
  });
});

describe('Anbieterverzeichnis', () => {
  it('hat eindeutige ids und gültige Links mit Platzhalter', () => {
    const ids = new Set();
    for (const c of CARRIERS) {
      assert.ok(!ids.has(c.id), `doppelte id ${c.id}`);
      ids.add(c.id);
      assert.match(c.url, /^https:\/\//);
      assert.match(c.color, /^#[0-9A-F]{6}$/i);
      assert.ok(c.short.length <= 10, `Kurzname zu lang: ${c.short}`);
    }
  });

  it('baut Tracking-Links mit URL-kodierter Nummer', () => {
    assert.equal(
      trackingUrl(getCarrier('dpd'), '01234567890123'),
      'https://tracking.dpd.de/status/de_DE/parcel/01234567890123',
    );
    assert.match(trackingUrl(null, 'XYZ12345'), /17track\.net.*XYZ12345/);
  });

  it('kennt generische Landespost-ids und lehnt Unbekanntes ab', () => {
    assert.equal(getCarrier('post-lu').id, 'post-lu');
    assert.equal(getCarrier('gibtsnicht'), null);
    assert.equal(getCarrier(null), null);
  });
});
