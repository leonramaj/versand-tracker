// Einstiegspunkt: `npm start`

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createTrackingService } from './tracking.js';

const config = loadConfig();
const service = createTrackingService({ config });
const server = createApp({ config, service });

server.listen(config.port, config.host, () => {
  const { providers, demo } = service.info();
  console.log(`Versand-Tracker läuft auf http://localhost:${config.port}`);
  console.log(`Live-Tracking über: ${providers.length ? providers.join(', ') : '— (kein API-Schlüssel gesetzt, nur Links)'}`);
  if (demo) console.log('Demo-Nummern aktiv: DEMO1 … DEMO9');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
