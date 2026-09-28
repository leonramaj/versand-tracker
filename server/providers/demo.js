// Demo-Anbieter: liefert für Nummern wie DEMO1 … DEMO7 realistische Beispieldaten,
// damit sich die App ohne API-Schlüssel ausprobieren lässt.

import { STATUS } from '../../shared/status.js';

const H = 3_600_000;

const STEPS = [
  { status: STATUS.INFO_RECEIVED, description: 'Die Sendung wurde elektronisch angekündigt.', location: '' },
  { status: STATUS.IN_TRANSIT, description: 'Die Sendung wurde vom Absender übergeben.', location: 'Hamburg' },
  { status: STATUS.IN_TRANSIT, description: 'Die Sendung wurde im Start-Paketzentrum bearbeitet.', location: 'Hamburg' },
  { status: STATUS.IN_TRANSIT, description: 'Die Sendung wurde im Ziel-Paketzentrum bearbeitet.', location: 'Köln' },
];

const ENDINGS = {
  [STATUS.INFO_RECEIVED]: [],
  [STATUS.IN_TRANSIT]: [],
  [STATUS.OUT_FOR_DELIVERY]: [
    { status: STATUS.OUT_FOR_DELIVERY, description: 'Die Sendung wurde in das Zustellfahrzeug geladen.', location: 'Köln' },
  ],
  [STATUS.DELIVERED]: [
    { status: STATUS.OUT_FOR_DELIVERY, description: 'Die Sendung wurde in das Zustellfahrzeug geladen.', location: 'Köln' },
    { status: STATUS.DELIVERED, description: 'Die Sendung wurde erfolgreich zugestellt.', location: 'Köln' },
  ],
  [STATUS.AVAILABLE_FOR_PICKUP]: [
    { status: STATUS.FAILED_ATTEMPT, description: 'Der Empfänger wurde nicht angetroffen.', location: 'Köln' },
    { status: STATUS.AVAILABLE_FOR_PICKUP, description: 'Die Sendung liegt in der Filiale zur Abholung bereit.', location: 'Köln, Filiale 512' },
  ],
  [STATUS.FAILED_ATTEMPT]: [
    { status: STATUS.OUT_FOR_DELIVERY, description: 'Die Sendung wurde in das Zustellfahrzeug geladen.', location: 'Köln' },
    { status: STATUS.FAILED_ATTEMPT, description: 'Zustellversuch nicht erfolgreich – neuer Versuch am nächsten Werktag.', location: 'Köln' },
  ],
  [STATUS.EXCEPTION]: [
    { status: STATUS.EXCEPTION, description: 'Adresse unvollständig – die Sendung wird an den Absender zurückgeschickt.', location: 'Köln' },
  ],
};

const SCENARIOS = [
  STATUS.IN_TRANSIT, STATUS.IN_TRANSIT, STATUS.DELIVERED, STATUS.OUT_FOR_DELIVERY, STATUS.AVAILABLE_FOR_PICKUP,
  STATUS.FAILED_ATTEMPT, STATUS.EXCEPTION, STATUS.INFO_RECEIVED, STATUS.IN_TRANSIT, STATUS.DELIVERED,
];

export function isDemoNumber(number) {
  return /^DEMO\d{0,6}$/.test(number);
}

export function demoTracking(number, now = Date.now()) {
  const digit = Number(number.at(-1));
  const status = SCENARIOS[Number.isNaN(digit) ? 0 : digit];
  const steps = status === STATUS.INFO_RECEIVED ? STEPS.slice(0, 1) : [...STEPS, ...ENDINGS[status]];

  // Ereignisse im Abstand von ~9 Stunden, das letzte vor einer Stunde.
  const events = steps
    .map((step, i) => ({ ...step, time: new Date(now - H - (steps.length - 1 - i) * 9 * H).toISOString() }))
    .reverse();

  const done = status === STATUS.DELIVERED || status === STATUS.EXCEPTION;
  return {
    status,
    statusText: events[0].description,
    estimatedDelivery: done ? null : new Date(now + 24 * H).toISOString().slice(0, 10),
    events,
    carrierName: 'Demo-Paketdienst',
  };
}

export function createDemoProvider({ now = () => Date.now() } = {}) {
  return {
    id: 'demo',
    name: 'Demo',
    supports: (_carrierId, number) => isDemoNumber(number),
    async track(number) {
      return demoTracking(number, now());
    },
  };
}
