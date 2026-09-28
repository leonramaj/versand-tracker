// Verzeichnis der Versanddienstleister und Erkennung anhand der Sendungsnummer.
// Wird von Server und Browser gemeinsam genutzt (reines ES-Modul, keine Abhängigkeiten).

const DHL_DE_URL = 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode={n}';

/** Universelle Tracking-Seiten, die (fast) jede Sendungsnummer weltweit kennen. */
export const UNIVERSAL_TRACKING_LINKS = Object.freeze([
  { name: '17TRACK', url: 'https://t.17track.net/de#nums={n}' },
  { name: 'Parcels', url: 'https://parcelsapp.com/de/tracking/{n}' },
]);

const UNIVERSAL_URL = UNIVERSAL_TRACKING_LINKS[0].url;

/**
 * Jeder Eintrag: id, Name, Kurzname für das Badge, Region, Markenfarben, Link zur
 * Sendungsverfolgung ({n} = Sendungsnummer) und Muster für die automatische Erkennung.
 * `score` (0–100) gibt an, wie eindeutig ein Muster ist; Prüfziffern verschieben ihn.
 */
export const CARRIERS = Object.freeze([
  // --- Deutschland ---------------------------------------------------------
  {
    id: 'dhl', name: 'DHL Paket', short: 'DHL', region: 'Deutschland',
    color: '#FFCC00', text: '#D40511', url: DHL_DE_URL,
    patterns: [
      { re: /^JJD\d{12,24}$/, score: 95 },
      { re: /^JVGL\d{8,24}$/, score: 90 },
      { re: /^00340\d{15}$/, score: 95 },
      { re: /^003\d{17}$/, score: 85 },
      { re: /^\d{12}$/, score: 55 },
      { re: /^\d{20}$/, score: 40 },
    ],
  },
  {
    id: 'deutsche-post', name: 'Deutsche Post (Brief, Einschreiben, Warenpost)', short: 'Post', region: 'Deutschland',
    color: '#FFCC00', text: '#1A1A1A', url: DHL_DE_URL, patterns: [],
  },
  {
    id: 'dhl-express', name: 'DHL Express', short: 'DHL EX', region: 'Internationale Paketdienste',
    color: '#D40511', text: '#FFCC00',
    url: 'https://www.dhl.com/de-de/home/tracking/tracking-express.html?submit=1&tracking-id={n}',
    patterns: [
      { re: /^JD\d{18}$/, score: 90 },
      { re: /^\d{10}$/, score: 35, check: 'dhlExpress' },
    ],
  },
  {
    id: 'dpd', name: 'DPD', short: 'DPD', region: 'Deutschland',
    color: '#DC0032', text: '#FFFFFF', url: 'https://tracking.dpd.de/status/de_DE/parcel/{n}',
    patterns: [
      { re: /^\d{14}[A-Z]$/, score: 80 },
      { re: /^\d{14}$/, score: 70 },
    ],
  },
  {
    id: 'hermes', name: 'Hermes', short: 'Hermes', region: 'Deutschland',
    color: '#0078BE', text: '#FFFFFF',
    url: 'https://www.myhermes.de/empfangen/sendungsverfolgung/suchen/sendungsinformation/#{n}',
    patterns: [
      { re: /^H\d{19}$/, score: 95 },
      { re: /^\d{14}$/, score: 45 },
      { re: /^\d{16}$/, score: 40 },
    ],
  },
  {
    id: 'gls', name: 'GLS', short: 'GLS', region: 'Deutschland',
    color: '#061AB1', text: '#FFD100', url: 'https://gls-group.com/DE/de/paketverfolgung?match={n}',
    patterns: [
      { re: /^\d{11}$/, score: 70 },
      { re: /^\d{12}$/, score: 45 },
      { re: /^(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8}$/, score: 35 },
    ],
  },
  {
    id: 'ups', name: 'UPS', short: 'UPS', region: 'Internationale Paketdienste',
    color: '#351C15', text: '#FFB500', url: 'https://www.ups.com/track?loc=de_DE&tracknum={n}',
    patterns: [{ re: /^1Z[0-9A-Z]{16}$/, score: 85, check: 'ups' }],
  },
  {
    id: 'fedex', name: 'FedEx', short: 'FedEx', region: 'Internationale Paketdienste',
    color: '#4D148C', text: '#FF6600', url: 'https://www.fedex.com/fedextrack/?trknbr={n}',
    patterns: [
      { re: /^96\d{20}$/, score: 80 },
      { re: /^\d{15}$/, score: 60 },
      { re: /^\d{12}$/, score: 40 },
      { re: /^\d{20}$/, score: 30 },
      { re: /^\d{22}$/, score: 30 },
    ],
  },
  {
    id: 'tnt', name: 'TNT', short: 'TNT', region: 'Internationale Paketdienste',
    color: '#FF6600', text: '#FFFFFF',
    url: 'https://www.tnt.com/express/de_de/site/shipping-tools/tracking.html?searchType=con&cons={n}',
    patterns: [{ re: /^\d{9}$/, score: 50 }],
  },
  {
    id: 'amazon', name: 'Amazon Logistics', short: 'Amazon', region: 'Deutschland',
    color: '#232F3E', text: '#FF9900', url: 'https://www.amazon.de/gp/your-account/order-history',
    patterns: [{ re: /^TB[ACM]\d{9,12}$/, score: 95 }],
  },

  // --- Österreich & Schweiz ------------------------------------------------
  {
    id: 'post-at', name: 'Österreichische Post', short: 'Post AT', region: 'Österreich & Schweiz',
    color: '#FFDC00', text: '#1A1A1A', url: 'https://www.post.at/s/sendungssuche?snr={n}',
    patterns: [{ re: /^\d{22}$/, score: 55 }],
  },
  {
    id: 'swiss-post', name: 'Die Schweizerische Post', short: 'Post CH', region: 'Österreich & Schweiz',
    color: '#FFCC00', text: '#1A1A1A', url: 'https://service.post.ch/ekp-web/ui/entry/search/{n}',
    patterns: [{ re: /^99\d{16}$/, score: 90 }],
  },

  // --- Europa --------------------------------------------------------------
  {
    id: 'postnl', name: 'PostNL', short: 'PostNL', region: 'Europa',
    color: '#F47920', text: '#FFFFFF', url: 'https://postnl.nl/tracktrace/?B={n}&T=C',
    patterns: [{ re: /^3S[A-Z0-9]{11,13}$/, score: 95 }],
  },
  {
    id: 'bpost', name: 'bpost', short: 'bpost', region: 'Europa',
    color: '#EF2637', text: '#FFFFFF', url: 'https://track.bpost.cloud/btr/web/#/search?itemCode={n}&lang=de',
    patterns: [{ re: /^\d{24}$/, score: 40 }],
  },
  {
    id: 'laposte', name: 'La Poste / Colissimo', short: 'La Poste', region: 'Europa',
    color: '#FFCC00', text: '#003DA5', url: 'https://www.laposte.fr/outils/suivre-vos-envois?code={n}',
    patterns: [{ re: /^\d[A-Z]\d{11}$/, score: 85 }],
  },
  {
    id: 'poste-italiane', name: 'Poste Italiane', short: 'Poste IT', region: 'Europa',
    color: '#FFCC00', text: '#0047BB', url: 'https://www.poste.it/cerca/index.html#/risultati-spedizioni/{n}',
    patterns: [],
  },
  {
    id: 'correos', name: 'Correos', short: 'Correos', region: 'Europa',
    color: '#FFCD00', text: '#002E6D',
    url: 'https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number={n}',
    patterns: [],
  },
  {
    id: 'royal-mail', name: 'Royal Mail', short: 'Royal Mail', region: 'Europa',
    color: '#DA202A', text: '#FFFFFF', url: 'https://www.royalmail.com/track-your-item#/tracking-results/{n}',
    patterns: [],
  },
  {
    id: 'evri', name: 'Evri (Hermes UK)', short: 'Evri', region: 'Europa',
    color: '#007BC4', text: '#FFFFFF', url: 'https://www.evri.com/track/parcel/{n}',
    patterns: [{ re: /^[HT]\d{2}[A-Z0-9]{13}$/, score: 55 }],
  },
  {
    id: 'postnord', name: 'PostNord', short: 'PostNord', region: 'Europa',
    color: '#00A0D6', text: '#FFFFFF', url: 'https://www.postnord.se/en/our-tools/track-and-trace?shipmentId={n}',
    patterns: [],
  },
  {
    id: 'poczta-polska', name: 'Poczta Polska', short: 'Poczta', region: 'Europa',
    color: '#E30613', text: '#FFFFFF', url: 'https://emonitoring.poczta-polska.pl/?numer={n}',
    patterns: [],
  },
  {
    id: 'inpost', name: 'InPost', short: 'InPost', region: 'Europa',
    color: '#FFCD00', text: '#1A1A1A', url: 'https://inpost.pl/sledzenie-przesylek?number={n}',
    patterns: [{ re: /^\d{24}$/, score: 45 }],
  },
  {
    id: 'ceska-posta', name: 'Česká pošta', short: 'CZ Post', region: 'Europa',
    color: '#FFCC00', text: '#003C7D',
    url: 'https://www.postaonline.cz/trackandsign/-/zasilka/cislo?parcelNumbers={n}',
    patterns: [],
  },

  // --- Welt ----------------------------------------------------------------
  {
    id: 'usps', name: 'USPS', short: 'USPS', region: 'Übersee',
    color: '#333366', text: '#FFFFFF', url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={n}',
    patterns: [
      { re: /^9[2-5]\d{20}$/, score: 80 },
      { re: /^9[2-5]\d{24}$/, score: 75 },
    ],
  },
  {
    id: 'canada-post', name: 'Canada Post', short: 'CA Post', region: 'Übersee',
    color: '#E3000F', text: '#FFFFFF',
    url: 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor={n}',
    patterns: [],
  },
  {
    id: 'australia-post', name: 'Australia Post', short: 'AU Post', region: 'Übersee',
    color: '#DC1928', text: '#FFFFFF', url: 'https://auspost.com.au/mypost/track/details/{n}',
    patterns: [],
  },
  {
    id: 'japan-post', name: 'Japan Post', short: 'JP Post', region: 'Übersee',
    color: '#CC0000', text: '#FFFFFF',
    url: 'https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1={n}&locale=en',
    patterns: [],
  },
  {
    id: 'china-post', name: 'China Post', short: 'CN Post', region: 'Übersee',
    color: '#006A35', text: '#FFFFFF', url: UNIVERSAL_URL, patterns: [],
  },
  {
    id: 'cainiao', name: 'Cainiao (AliExpress)', short: 'Cainiao', region: 'Übersee',
    color: '#FF6A00', text: '#FFFFFF', url: 'https://global.cainiao.com/newDetail.htm?mailNoList={n}',
    patterns: [{ re: /^LP\d{14,16}$/, score: 90 }],
  },
  {
    id: 'yunexpress', name: 'YunExpress', short: 'Yun', region: 'Übersee',
    color: '#0055A5', text: '#FFFFFF', url: 'https://www.yuntrack.com/parcelTracking?id={n}',
    patterns: [{ re: /^YT\d{16}$/, score: 95 }],
  },
]);

/**
 * Internationale Post-Sendungsnummern (UPU-Standard S10, z. B. RR123456785DE) enden mit dem
 * Ländercode der Post, die sie vergeben hat. Nicht aufgeführte Länder bekommen einen
 * generischen Eintrag „Post (Land)“ mit universellem Tracking-Link.
 */
const S10_OPERATORS = Object.freeze({
  DE: 'deutsche-post', AT: 'post-at', CH: 'swiss-post', NL: 'postnl', BE: 'bpost',
  FR: 'laposte', IT: 'poste-italiane', ES: 'correos', GB: 'royal-mail', SE: 'postnord',
  DK: 'postnord', PL: 'poczta-polska', CZ: 'ceska-posta', US: 'usps', CA: 'canada-post',
  AU: 'australia-post', JP: 'japan-post', CN: 'china-post',
});

const S10_RE = /^([A-Z]{2})(\d{8})(\d)([A-Z]{2})$/;
const BY_ID = new Map(CARRIERS.map((c) => [c.id, c]));

let regionNames = null;
function countryName(code) {
  try {
    regionNames ??= new Intl.DisplayNames(['de'], { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function genericPostCarrier(countryCode) {
  const cc = countryCode.toUpperCase();
  return {
    id: `post-${cc.toLowerCase()}`, name: `Post ${countryName(cc)}`, short: `Post ${cc}`,
    region: countryName(cc), color: '#5B6472', text: '#FFFFFF', url: UNIVERSAL_URL, patterns: [],
  };
}

/** Liefert den Anbieter zu einer id – auch generische Post-Einträge wie `post-lu`. */
export function getCarrier(id) {
  if (!id) return null;
  const known = BY_ID.get(id);
  if (known) return known;
  const m = /^post-([a-z]{2})$/.exec(id);
  return m ? genericPostCarrier(m[1]) : null;
}

/** Entfernt Leerzeichen, Punkte und Bindestriche und wandelt in Großbuchstaben um. */
export function normalizeTrackingNumber(input) {
  return String(input ?? '').toUpperCase().replace(/[\s.\-]/g, '');
}

export function isPlausibleTrackingNumber(number) {
  return /^[A-Z0-9]{5,40}$/.test(number);
}

export function trackingUrl(carrier, number) {
  const template = carrier?.url ?? UNIVERSAL_URL;
  return template.replace('{n}', encodeURIComponent(number));
}

export function universalLinks(number) {
  return UNIVERSAL_TRACKING_LINKS.map((l) => ({ name: l.name, url: l.url.replace('{n}', encodeURIComponent(number)) }));
}

// --- Prüfziffern -----------------------------------------------------------

/** UPU S10: Gewichte 8 6 4 2 3 5 9 7, Modulo 11. */
export function s10CheckDigit(eightDigits) {
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(eightDigits[i]) * weights[i];
  const c = 11 - (sum % 11);
  if (c === 10) return 0;
  if (c === 11) return 5;
  return c;
}

/** UPS 1Z: Buchstaben → Ziffern, ungerade Stellen einfach, gerade doppelt, Modulo 10. */
export function upsChecksumValid(number) {
  const body = number.slice(2, 17);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const digit = /\d/.test(ch) ? Number(ch) : (ch.charCodeAt(0) - 63) % 10;
    sum += i % 2 === 0 ? digit : digit * 2;
  }
  return (10 - (sum % 10)) % 10 === Number(number[17]);
}

/** DHL Express Luftfrachtbrief (10-stellig): Prüfziffer = erste 9 Stellen Modulo 7. */
export function dhlExpressChecksumValid(number) {
  return Number(number.slice(0, 9)) % 7 === Number(number[9]);
}

const CHECKS = { ups: upsChecksumValid, dhlExpress: dhlExpressChecksumValid };

// --- Erkennung -------------------------------------------------------------

/**
 * Ermittelt mögliche Anbieter für eine Sendungsnummer, bestes Ergebnis zuerst.
 * @returns {{carrier: object, score: number, checksumValid: boolean|null}[]}
 */
export function detectCarriers(input) {
  const number = normalizeTrackingNumber(input);
  if (!isPlausibleTrackingNumber(number)) return [];

  const best = new Map();
  const add = (carrier, score, checksumValid = null) => {
    const prev = best.get(carrier.id);
    if (!prev || prev.score < score) best.set(carrier.id, { carrier, score, checksumValid });
  };

  const s10 = S10_RE.exec(number);
  if (s10) {
    const [, service, digits, check, country] = s10;
    const valid = s10CheckDigit(digits) === Number(check);
    let id = S10_OPERATORS[country];
    // Pakete (C…) und EMS (E…) aus Deutschland laufen über DHL Paket.
    if (country === 'DE' && /^[CE]/.test(service)) id = 'dhl';
    add(getCarrier(id) ?? genericPostCarrier(country), valid ? 92 : 60, valid);
  }

  for (const carrier of CARRIERS) {
    for (const { re, score, check } of carrier.patterns) {
      if (!re.test(number)) continue;
      if (check) {
        const valid = CHECKS[check](number);
        add(carrier, valid ? Math.min(99, score + 45) : Math.max(5, score - 25), valid);
      } else {
        add(carrier, score);
      }
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
}
