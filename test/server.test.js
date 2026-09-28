import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.js';
import { createTrackingService } from '../server/tracking.js';
import { baseConfig } from './helpers.js';

let server;
let base;

before(async () => {
  const config = { ...baseConfig, rateLimitPerMinute: 5 };
  server = createApp({ config, service: createTrackingService({ config }), logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

/** Rohe HTTP-Anfrage, damit Pfade wie /../ nicht vom Client normalisiert werden. */
function raw(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('HTTP-Server', () => {
  it('liefert die Web-App mit Sicherheits-Headern aus', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await res.text(), /Versand-Tracker/);
  });

  it('liefert die gemeinsamen Module für den Browser aus', async () => {
    const res = await fetch(`${base}/shared/carriers.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
  });

  it('antwortet mit 304, wenn sich eine Datei nicht geändert hat', async () => {
    const first = await fetch(`${base}/styles.css`);
    const etag = first.headers.get('etag');
    const second = await fetch(`${base}/styles.css`, { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
  });

  it('verhindert Zugriffe außerhalb der freigegebenen Ordner', async () => {
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/shared/../server/config.js', '/%2e%2e%2f.env', '/..%5c..%5cpackage.json']) {
      const res = await raw(path);
      assert.equal(res.status, 404, path);
    }
  });

  it('stellt /api/info und /api/detect bereit', async () => {
    const info = await (await fetch(`${base}/api/info`)).json();
    assert.deepEqual(info, { providers: [], demo: true });
    const detect = await (await fetch(`${base}/api/detect?number=1Z999AA10123456784`)).json();
    assert.equal(detect.candidates[0].id, 'ups');
    assert.equal(detect.candidates[0].checksumValid, true);
  });

  it('verfolgt Sendungen über /api/track', async () => {
    const res = await fetch(`${base}/api/track?number=DEMO3`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.status, 'out_for_delivery');
    assert.ok(body.events.length > 0);
  });

  it('meldet Eingabefehler mit 400', async () => {
    const res = await fetch(`${base}/api/track?number=x`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /Ungültige Sendungsnummer/);
    assert.equal((await fetch(`${base}/api/track`)).status, 400);
  });

  it('lehnt andere Methoden als GET ab', async () => {
    const res = await raw('/api/track?number=DEMO1', 'POST');
    assert.equal(res.status, 405);
  });

  it('begrenzt die Anzahl der Tracking-Abfragen pro Minute', async () => {
    let limited = null;
    for (let i = 0; i < 10 && !limited; i++) {
      const res = await fetch(`${base}/api/track?number=DEMO1`);
      if (res.status === 429) limited = res;
    }
    assert.ok(limited, 'Rate-Limit wurde nicht ausgelöst');
    assert.equal(limited.headers.get('retry-after'), '60');
  });
});
