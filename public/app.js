import {
  CARRIERS, detectCarriers, getCarrier, isPlausibleTrackingNumber, normalizeTrackingNumber, trackingUrl, universalLinks,
} from '/shared/carriers.js';
import { FINAL_STATUSES, STATUS, statusInfo } from '/shared/status.js';

const STORAGE_KEY = 'versand-tracker.shipments.v1';
const SETTINGS_KEY = 'versand-tracker.settings.v1';
const AUTO_REFRESH_MS = 15 * 60_000;
const RECENTLY_DELIVERED_MS = 24 * 3_600_000; // so lange bleiben Zustellungen unter „Unterwegs“ sichtbar
const REFRESH_CONCURRENCY = 3;
const DEMO_NUMBERS = ['DEMO1', 'DEMO2', 'DEMO3', 'DEMO4', 'DEMO5', 'DEMO6'];

const STATUS_ORDER = {
  out_for_delivery: 0, available_for_pickup: 1, failed_attempt: 2, exception: 3, in_transit: 4,
  info_received: 5, pending: 6, unknown: 6, expired: 8, delivered: 9,
};

// ---------------------------------------------------------------------------
// Speicher (bleibt im Browser, nichts wird auf dem Server abgelegt)
// ---------------------------------------------------------------------------

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast('Speichern im Browser nicht möglich – Änderungen gehen beim Schließen verloren.');
  }
}

const state = {
  shipments: readJson(STORAGE_KEY, []).filter((s) => s && typeof s.number === 'string'),
  settings: readJson(SETTINGS_KEY, { notifications: false }),
  filter: 'active',
  query: '',
  refreshing: new Set(),
  info: null,
  openId: null,
};

const save = () => writeJson(STORAGE_KEY, state.shipments);
const saveSettings = () => writeJson(SETTINGS_KEY, state.settings);
const findShipment = (id) => state.shipments.find((s) => s.id === id);

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Datumswerte ohne Zeitzone („2026-09-29“ bzw. „…T14:05:00“) als Ortszeit lesen. */
function parseDate(value) {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = dateOnly ? new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtEta = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
  if (diff >= -1 && diff <= 1) return rtf.format(diff, 'day').replace(/^./, (c) => c.toUpperCase());
  return fmtDay.format(d);
}

function relativeTime(value) {
  const d = typeof value === 'number' ? new Date(value) : parseDate(value);
  if (!d) return '';
  const seconds = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'gerade eben';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return fmtDay.format(d);
}

function etaText(value) {
  const d = parseDate(value);
  if (!d) return '';
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
  if (diff === 0) return 'Voraussichtlich heute';
  if (diff === 1) return 'Voraussichtlich morgen';
  if (diff < 0) return '';
  return `Voraussichtlich ${fmtEta.format(d)}`;
}

let toastTimer = null;
function toast(message, action) {
  const el = $('#toast');
  el.replaceChildren(h('span', null, message));
  if (action) {
    el.append(h('button', { type: 'button', onclick: () => { el.hidden = true; action.run(); } }, action.label));
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3500);
}

// ---------------------------------------------------------------------------
// Anbieter
// ---------------------------------------------------------------------------

function carrierFor(shipment) {
  if (!shipment.carrierId && isDemo(shipment.number)) return null;
  return getCarrier(shipment.carrierId)
    ?? getCarrier(shipment.result?.carrier?.id)
    ?? detectCarriers(shipment.number)[0]?.carrier
    ?? null;
}

function isDemo(number) {
  return /^DEMO\d{0,6}$/.test(number);
}

function carrierBadge(carrier, number, small = false) {
  const text = carrier?.short ?? (isDemo(number) ? 'Demo' : '?');
  // Schriftgröße nach dem längsten Wort wählen, damit nichts mitten im Wort umbricht.
  const longest = Math.max(...text.split(' ').map((w) => w.length));
  const size = longest >= 7 ? 'len-l' : longest >= 5 ? 'len-m' : '';
  return h('span', {
    class: ['badge', small && 'badge-sm', size].filter(Boolean).join(' '),
    title: carrier?.name, 'aria-hidden': 'true',
    style: carrier ? { '--badge-bg': carrier.color, '--badge-fg': carrier.text } : null,
  }, text);
}

/** Weitere Kandidaten, die fast so gut passen wie der beste (echte Mehrdeutigkeit). */
function closeAlternatives(candidates) {
  const [best, ...rest] = candidates;
  return best ? rest.filter((c) => best.score - c.score < 30) : [];
}

function linkFor(shipment) {
  const carrier = carrierFor(shipment);
  return shipment.result?.trackingUrl && !shipment.carrierId ? shipment.result.trackingUrl : trackingUrl(carrier, shipment.number);
}

// ---------------------------------------------------------------------------
// Server-Abfragen
// ---------------------------------------------------------------------------

async function fetchInfo() {
  try {
    const res = await fetch('/api/info');
    state.info = res.ok ? await res.json() : null;
  } catch {
    state.info = null;
  }
  renderFooter();
  renderList();
}

async function refreshShipment(id, { force = false, notify = true } = {}) {
  const shipment = findShipment(id);
  if (!shipment || state.refreshing.has(id)) return;
  state.refreshing.add(id);
  render(id);

  const requestedCarrier = shipment.carrierId;
  const params = new URLSearchParams({ number: shipment.number });
  if (requestedCarrier) params.set('carrier', requestedCarrier);
  if (force) params.set('force', '1');

  let result = null;
  let error = null;
  try {
    const res = await fetch(`/api/track?${params}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message ?? `Abfrage fehlgeschlagen (${res.status}).`);
    result = body;
  } catch (err) {
    error = err instanceof TypeError ? 'Keine Verbindung zum Server.' : err.message;
  }

  state.refreshing.delete(id);
  const current = findShipment(id); // könnte inzwischen gelöscht worden sein
  if (current && current.carrierId !== requestedCarrier) {
    // Paketdienst wurde während der Abfrage geändert → Antwort verwerfen und neu abfragen.
    refreshShipment(id, { force, notify: false });
    return;
  }
  if (current) {
    current.checkedAt = Date.now();
    current.lastError = error;
    if (result) {
      const prev = current.result;
      // Keine vorhandenen Daten durch eine leere Antwort ersetzen (z. B. kurzzeitig keine Daten beim Anbieter).
      const keepOld = prev?.events?.length > 0 && result.events.length === 0;
      if (!keepOld) {
        if (prev && prev.status !== result.status && result.provider) {
          current.statusChangedAt = Date.now();
          if (notify) notifyStatusChange(current, result);
        }
        current.result = result;
        if (result.status === STATUS.DELIVERED) current.deliveredSeenAt ??= Date.now();
        else current.deliveredSeenAt = null;
      }
    }
    save();
  }
  render(id);
}

async function refreshMany(ids, options) {
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) await refreshShipment(queue.shift(), options);
  };
  await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, queue.length) }, worker));
}

function needsRefresh(shipment) {
  if (FINAL_STATUSES.has(shipment.result?.status)) return false;
  // Nach einem Fehler (z. B. offline) früher erneut versuchen.
  const interval = shipment.lastError ? 60_000 : AUTO_REFRESH_MS;
  return !shipment.checkedAt || Date.now() - shipment.checkedAt > interval;
}

function autoRefresh() {
  if (document.visibilityState !== 'visible') return;
  const due = state.shipments.filter(needsRefresh).map((s) => s.id);
  if (due.length) refreshMany(due, { notify: true });
}

async function refreshAll() {
  const btn = $('#refresh-all');
  const ids = state.shipments.filter((s) => !FINAL_STATUSES.has(s.result?.status)).map((s) => s.id);
  if (!ids.length) {
    toast('Keine offenen Sendungen zum Aktualisieren.');
    return;
  }
  btn.setAttribute('aria-busy', 'true');
  await refreshMany(ids, { force: true, notify: true });
  btn.removeAttribute('aria-busy');
  toast('Alle Sendungen aktualisiert.');
}

// ---------------------------------------------------------------------------
// Benachrichtigungen
// ---------------------------------------------------------------------------

async function notifyStatusChange(shipment, result) {
  if (!state.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  const title = `${shipment.label || shipment.number}: ${statusInfo(result.status).label}`;
  const options = { body: result.statusText || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: shipment.id };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* Benachrichtigungen sind optional */
  }
}

async function toggleNotifications() {
  if (!('Notification' in window)) {
    toast('Dieser Browser unterstützt keine Benachrichtigungen.');
    return;
  }
  if (state.settings.notifications) {
    state.settings.notifications = false;
    saveSettings();
    toast('Benachrichtigungen deaktiviert.');
    return;
  }
  const permission = await Notification.requestPermission();
  state.settings.notifications = permission === 'granted';
  saveSettings();
  toast(permission === 'granted'
    ? 'Benachrichtigungen aktiv – du wirst bei Statusänderungen informiert, solange die App geöffnet ist.'
    : 'Benachrichtigungen wurden im Browser blockiert.');
}

// ---------------------------------------------------------------------------
// Sendungen verwalten
// ---------------------------------------------------------------------------

function addShipment(rawNumber, { label = '', carrierId = null, refresh = true } = {}) {
  const number = normalizeTrackingNumber(rawNumber);
  if (!isPlausibleTrackingNumber(number)) {
    return { error: 'Bitte eine gültige Sendungsnummer eingeben (5–40 Buchstaben/Ziffern).' };
  }
  const existing = state.shipments.find((s) => s.number === number);
  if (existing) return { existing };

  const shipment = {
    id: newId(), number, label: label.trim().slice(0, 60), carrierId: carrierId || null,
    addedAt: Date.now(), checkedAt: null, result: null, lastError: null,
  };
  state.shipments.unshift(shipment);
  save();
  if (state.filter === 'delivered') setFilter('active');
  render();
  if (refresh) refreshShipment(shipment.id, { notify: false });
  return { shipment };
}

function deleteShipment(id) {
  const index = state.shipments.findIndex((s) => s.id === id);
  if (index < 0) return;
  const [removed] = state.shipments.splice(index, 1);
  save();
  closeDetail();
  render();
  toast('Sendung gelöscht.', {
    label: 'Rückgängig',
    run: () => {
      state.shipments.splice(Math.min(index, state.shipments.length), 0, removed);
      save();
      render();
    },
  });
}

function exportShipments() {
  const data = {
    app: 'versand-tracker', version: 1, exportedAt: new Date().toISOString(),
    shipments: state.shipments.map(({ number, label, carrierId, addedAt }) => ({ number, label, carrierId, addedAt })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `sendungen-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importShipments(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data?.shipments;
    if (!Array.isArray(list)) throw new Error('format');
    const added = [];
    for (const item of [...list].reverse()) {
      const res = addShipment(item?.number ?? '', {
        label: String(item?.label ?? ''),
        carrierId: getCarrier(item?.carrierId) ? item.carrierId : null,
        refresh: false,
      });
      if (res.shipment) added.push(res.shipment.id);
    }
    toast(added.length ? `${added.length} Sendung(en) importiert.` : 'Keine neuen Sendungen in der Datei.');
    refreshMany(added, { notify: false });
  } catch {
    toast('Die Datei konnte nicht gelesen werden.');
  }
}

// ---------------------------------------------------------------------------
// Darstellung: Liste
// ---------------------------------------------------------------------------

function statusOf(shipment) {
  return shipment.result?.status ?? STATUS.UNKNOWN;
}

function inFilter(shipment, filter) {
  const delivered = statusOf(shipment) === STATUS.DELIVERED;
  if (filter === 'delivered') return delivered;
  if (filter === 'active') return !delivered || Date.now() - (shipment.deliveredSeenAt ?? 0) < RECENTLY_DELIVERED_MS;
  return true;
}

function matchesFilter(shipment) {
  if (!inFilter(shipment, state.filter)) return false;
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  const carrier = carrierFor(shipment);
  return [shipment.label, shipment.number, carrier?.name].some((v) => v?.toLowerCase().includes(q));
}

function sortShipments(a, b) {
  return (STATUS_ORDER[statusOf(a)] ?? 6) - (STATUS_ORDER[statusOf(b)] ?? 6) || b.addedAt - a.addedAt;
}

function progressBar(status) {
  const { step, tone } = statusInfo(status);
  return h('span', { class: 'progress', 'data-tone': tone, 'aria-hidden': 'true' },
    [1, 2, 3, 4].map((i) => h('i', { class: i <= step ? 'on' : null })));
}

function statusPill(status) {
  const info = statusInfo(status);
  return h('span', { class: 'pill', 'data-tone': info.tone }, info.label);
}

function renderCard(shipment) {
  const carrier = carrierFor(shipment);
  const result = shipment.result;
  const status = statusOf(shipment);
  const latest = result?.events?.[0];
  const loading = state.refreshing.has(shipment.id);

  let eventText = '';
  if (latest) eventText = [latest.description, latest.location].filter(Boolean).join(' · ');
  else if (shipment.lastError) eventText = shipment.lastError;
  else if (result?.message) eventText = result.message;
  else if (!result) eventText = 'Wird abgefragt …';

  const eta = status !== STATUS.DELIVERED ? etaText(result?.estimatedDelivery) : '';
  const when = latest?.time ? relativeTime(latest.time) : '';

  return h('li', null,
    h('button', {
      class: 'card', type: 'button',
      onclick: () => openDetail(shipment.id),
    },
    carrierBadge(carrier, shipment.number),
    h('span', { class: 'card-body' },
      h('span', { class: 'card-top' },
        h('span', { class: 'card-title' }, shipment.label || carrier?.name || (isDemo(shipment.number) ? 'Demo-Sendung' : 'Sendung')),
        when && h('span', { class: 'card-time' }, when)),
      h('span', { class: 'card-number' }, shipment.number),
      h('span', { class: 'card-status' },
        statusPill(status),
        loading && h('span', { class: 'spinner', role: 'status', 'aria-label': 'Wird aktualisiert' }),
        eta && h('span', { class: 'eta' }, eta)),
      eventText && h('span', { class: 'card-event' }, eventText),
      progressBar(status))));
}

function renderList() {
  const list = $('#shipment-list');
  const visible = state.shipments.filter(matchesFilter).sort(sortShipments);
  list.replaceChildren(...visible.map(renderCard));

  for (const el of document.querySelectorAll('[data-count]')) {
    const n = state.shipments.filter((s) => inFilter(s, el.dataset.count)).length;
    el.textContent = n ? String(n) : '';
  }

  const empty = $('#empty');
  empty.hidden = visible.length > 0;
  if (!visible.length) {
    const none = state.shipments.length === 0;
    $('#empty-title').textContent = none ? 'Noch keine Sendungen'
      : state.query ? 'Keine Treffer' : state.filter === 'delivered' ? 'Noch nichts zugestellt' : 'Alles zugestellt';
    $('#empty-text').textContent = none
      ? 'Gib oben eine Sendungsnummer ein – der Paketdienst wird automatisch erkannt.'
      : state.query ? 'Keine Sendung passt zu deiner Suche.' : 'In dieser Ansicht gibt es gerade keine Sendungen.';
    const chips = $('#demo-chips');
    chips.hidden = !(none && state.info?.demo);
    if (!chips.hidden) {
      chips.replaceChildren(
        h('span', { class: 'muted' }, 'Zum Ausprobieren:'),
        ...DEMO_NUMBERS.map((n) => h('button', { type: 'button', class: 'chip', onclick: () => addShipment(n) }, n)),
      );
    }
  }
}

function renderFooter() {
  const el = $('#provider-info');
  if (!state.info) {
    el.textContent = navigator.onLine ? 'Server nicht erreichbar – es werden die zuletzt bekannten Daten angezeigt.'
      : 'Offline – es werden die zuletzt bekannten Daten angezeigt.';
    return;
  }
  el.textContent = state.info.providers.length
    ? `Live-Status über ${state.info.providers.join(', ')} · Daten bleiben auf diesem Gerät.`
    : 'Live-Status ist noch nicht eingerichtet (API-Schlüssel fehlt) – Erkennung und Links zu allen Paketdiensten funktionieren trotzdem.';
}

/** Zeichnet die Liste neu – und die Detailansicht, falls sie die geänderte Sendung zeigt. */
function render(changedId = null) {
  renderList();
  if (state.openId && (!changedId || changedId === state.openId)) {
    // Fokus (z. B. auf „Aktualisieren“) über das Neuzeichnen hinweg erhalten.
    const focusKey = document.activeElement?.dataset?.focusKey;
    renderDetail();
    if (focusKey) $(`#detail-dialog [data-focus-key="${focusKey}"]`)?.focus();
  }
}

// ---------------------------------------------------------------------------
// Darstellung: Detailansicht
// ---------------------------------------------------------------------------

function carrierOptions(selectedId, number) {
  const detected = detectCarriers(number).map((c) => c.carrier);
  const options = [h('option', { value: '' }, 'Automatisch erkennen')];
  if (detected.length) {
    options.push(h('optgroup', { label: 'Passend zur Nummer' },
      detected.map((c) => h('option', { value: c.id, selected: c.id === selectedId }, c.name))));
  }
  options.push(h('optgroup', { label: 'Alle Paketdienste' },
    CARRIERS.filter((c) => !detected.some((d) => d.id === c.id))
      .map((c) => h('option', { value: c.id, selected: c.id === selectedId }, c.name))));
  return options;
}

function renderTimeline(events) {
  const list = h('ol', { class: 'timeline' });
  let lastDay = null;
  events.forEach((event, i) => {
    const d = parseDate(event.time);
    const day = d ? dayLabel(d) : 'Ohne Datum';
    if (day !== lastDay) {
      list.append(h('li', { class: 'timeline-day' }, day));
      lastDay = day;
    }
    const meta = [d && /T\d{2}:\d{2}/.test(event.time) ? `${fmtTime.format(d)} Uhr` : null, event.location].filter(Boolean).join(' · ');
    list.append(h('li', { class: i === 0 ? 'event latest' : 'event', 'data-tone': statusInfo(event.status ?? STATUS.UNKNOWN).tone },
      h('div', { class: 'event-desc' }, event.description || 'Statusmeldung'),
      meta && h('div', { class: 'event-meta' }, meta)));
  });
  return list;
}

function renderDetail() {
  const dialog = $('#detail-dialog');
  const shipment = findShipment(state.openId);
  if (!shipment) {
    closeDetail();
    return;
  }
  const carrier = carrierFor(shipment);
  const result = shipment.result;
  const status = statusOf(shipment);
  const loading = state.refreshing.has(shipment.id);
  const events = result?.events ?? [];
  const eta = status !== STATUS.DELIVERED ? etaText(result?.estimatedDelivery) : '';
  const title = shipment.label || carrier?.name || (isDemo(shipment.number) ? 'Demo-Sendung' : 'Sendung');

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(shipment.number);
      toast('Sendungsnummer kopiert.');
    } catch {
      toast('Kopieren nicht möglich.');
    }
  };

  const rename = () => {
    const label = prompt('Bezeichnung für diese Sendung:', shipment.label ?? '');
    if (label === null) return;
    shipment.label = label.trim().slice(0, 60);
    save();
    render();
  };

  const changeCarrier = (event) => {
    shipment.carrierId = event.target.value || null;
    shipment.result = null;
    save();
    refreshShipment(shipment.id, { force: true, notify: false });
  };

  const sources = [];
  if (result?.provider) sources.push(`Daten von ${result.provider}`);
  if (result?.carrierName && result.provider && !result.provider.startsWith('DHL')) sources.push(`Paketdienst laut Anbieter: ${result.carrierName}`);
  if (shipment.checkedAt) sources.push(`Zuletzt geprüft ${relativeTime(shipment.checkedAt)}`);

  const lowConfidence = !shipment.carrierId && closeAlternatives(detectCarriers(shipment.number)).length > 0;

  dialog.replaceChildren(
    h('div', { class: 'sheet-header' },
      carrierBadge(carrier, shipment.number, true),
      h('div', { style: { flex: '1', 'min-width': '0' } },
        h('h2', { id: 'detail-title' }, title),
        h('div', { class: 'detail-number' },
          h('span', null, shipment.number),
          h('button', { type: 'button', title: 'Nummer kopieren', 'aria-label': 'Nummer kopieren', onclick: copyNumber }, icon('copy')))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', onclick: closeDetail }, icon('close'))),
    h('div', { class: 'sheet-body' },
      h('div', { class: 'detail-status' },
        h('span', { style: { display: 'flex', 'align-items': 'center', gap: '8px' } },
          statusPill(status), loading && h('span', { class: 'spinner', role: 'status', 'aria-label': 'Wird aktualisiert' })),
        eta && h('span', { class: 'eta' }, eta)),
      progressBar(status),
      shipment.lastError && h('p', { class: 'notice error' }, shipment.lastError),
      result?.message && h('p', { class: 'notice' }, result.message),
      lowConfidence && h('p', { class: 'notice' },
        `Die Nummer passt zu mehreren Paketdiensten. Erkannt wurde „${carrier?.name ?? 'unbekannt'}“ – falls das nicht stimmt, wähle unten den richtigen aus.`),
      h('div', { class: 'actions' },
        h('a', { class: 'btn btn-primary', href: linkFor(shipment), target: '_blank', rel: 'noopener noreferrer' },
          icon('external'), carrier ? `Bei ${carrier.short} verfolgen` : 'Online verfolgen'),
        h('button', { type: 'button', class: 'btn', disabled: loading, dataset: { focusKey: 'refresh' }, onclick: () => refreshShipment(shipment.id, { force: true }) },
          icon('refresh'), 'Aktualisieren')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', dataset: { focusKey: 'rename' }, onclick: rename }, icon('edit'), 'Umbenennen'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: () => deleteShipment(shipment.id) }, icon('trash'), 'Löschen')),
      h('label', { class: 'field-row' }, 'Paketdienst',
        h('select', { dataset: { focusKey: 'carrier' }, onchange: changeCarrier }, carrierOptions(shipment.carrierId, shipment.number))),
      h('h3', { class: 'timeline-title' }, 'Sendungsverlauf'),
      events.length ? renderTimeline(events)
        : h('p', { class: 'muted' }, loading && !result ? 'Wird abgefragt …' : 'Noch keine Ereignisse vorhanden.'),
      h('div', { class: 'sheet-footer' },
        sources.length ? h('span', null, sources.join(' · ')) : null,
        h('span', null, 'Weitere Suchdienste: ',
          universalLinks(shipment.number).flatMap((l, i) => [
            i ? ' · ' : '',
            h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.name),
          ])))));
}

function openDetail(id) {
  state.openId = id;
  renderDetail();
  const dialog = $('#detail-dialog');
  if (!dialog.open) dialog.showModal();
  const shipment = findShipment(id);
  if (shipment && needsRefresh(shipment)) refreshShipment(id);
}

function closeDetail() {
  state.openId = null;
  const dialog = $('#detail-dialog');
  if (dialog.open) dialog.close();
}

// ---------------------------------------------------------------------------
// Darstellung: Paketdienste-Übersicht
// ---------------------------------------------------------------------------

function renderCarrierGroups() {
  const groups = new Map();
  for (const carrier of CARRIERS) {
    if (!groups.has(carrier.region)) groups.set(carrier.region, []);
    groups.get(carrier.region).push(carrier);
  }
  $('#carrier-groups').replaceChildren(...[...groups].map(([region, carriers]) =>
    h('section', { class: 'carrier-group' },
      h('h3', null, region),
      h('div', { class: 'carrier-grid' },
        carriers.map((c) => h('div', { class: 'carrier-item' }, carrierBadge(c, '', true), h('span', null, c.name)))))));
}

// ---------------------------------------------------------------------------
// Eingabeformular
// ---------------------------------------------------------------------------

function updateDetectHint() {
  const input = $('#number-input');
  const hint = $('#detect-hint');
  const number = normalizeTrackingNumber(input.value);
  input.removeAttribute('aria-invalid');
  if (!number) {
    hint.replaceChildren();
    return;
  }
  if (isDemo(number)) {
    hint.replaceChildren('Demo-Sendung mit Beispieldaten');
    return;
  }
  if (!isPlausibleTrackingNumber(number)) {
    hint.replaceChildren(h('span', { class: number.length < 5 ? null : 'error' },
      number.length < 5 ? 'Weiter tippen …' : 'Nur Buchstaben und Ziffern (5–40 Zeichen) sind erlaubt.'));
    return;
  }
  const candidates = detectCarriers(number);
  const [best] = candidates;
  const others = closeAlternatives(candidates);
  if (!best) {
    hint.replaceChildren('Paketdienst nicht erkannt – die Nummer wird trotzdem bei allen Diensten gesucht.');
    return;
  }
  const parts = ['Erkannt: ', h('strong', null, best.carrier.name)];
  if (others.length) parts.push(` (oder ${others.slice(0, 2).map((o) => o.carrier.name).join(', ')})`);
  if (best.checksumValid === false) parts.push(' · ', h('span', { class: 'warn' }, 'Prüfziffer passt nicht – Tippfehler?'));
  hint.replaceChildren(...parts);
}

function onSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = $('#number-input');
  const res = addShipment(input.value, { label: $('#label-input').value, carrierId: $('#carrier-select').value });
  if (res.error) {
    input.setAttribute('aria-invalid', 'true');
    $('#detect-hint').replaceChildren(h('span', { class: 'error' }, res.error));
    input.focus();
    return;
  }
  if (res.existing) {
    toast('Diese Sendung ist schon in deiner Liste.');
    openDetail(res.existing.id);
  }
  form.reset();
  $('.add-more').open = false;
  updateDetectHint();
}

/** Nimmt geteilte Texte (z. B. aus einer Versand-Mail) entgegen: /?text=… oder /?number=… */
function handleSharedInput() {
  const params = new URLSearchParams(location.search);
  const text = [params.get('number'), params.get('text'), params.get('title'), params.get('url')].filter(Boolean).join(' ');
  if (!text) return;
  history.replaceState(null, '', location.pathname);
  const tokens = text.split(/[^A-Za-z0-9.\- ]+/).flatMap((t) => [t, ...t.split(/\s+/)]).map(normalizeTrackingNumber);
  const found = tokens
    .filter(isPlausibleTrackingNumber)
    .map((n) => ({ n, score: detectCarriers(n)[0]?.score ?? 0 }))
    .sort((a, b) => b.score - a.score || b.n.length - a.n.length)[0];
  if (found) {
    $('#number-input').value = found.n;
    updateDetectHint();
    $('#number-input').focus();
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function setFilter(filter) {
  state.filter = filter;
  for (const btn of document.querySelectorAll('[data-filter]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter));
  }
  renderList();
}

function setupMenu() {
  const btn = $('#menu-btn');
  const menu = $('#menu');
  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) {
      menu.querySelector('[data-action="notifications"]').textContent =
        state.settings.notifications ? 'Benachrichtigungen ausschalten' : 'Benachrichtigungen einschalten';
      menu.querySelector('button').focus();
    }
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    close();
    if (action === 'notifications') toggleNotifications();
    if (action === 'carriers') {
      renderCarrierGroups();
      $('#carriers-dialog').showModal();
    }
    if (action === 'export') exportShipments();
    if (action === 'import') $('#import-file').click();
  });
}

function setupDialogs() {
  for (const dialog of document.querySelectorAll('dialog')) {
    // Klick auf den abgedunkelten Hintergrund schließt den Dialog.
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { if (dialog.id === 'detail-dialog') state.openId = null; });
  }
  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  }
}

function init() {
  const select = $('#carrier-select');
  select.append(...CARRIERS.map((c) => h('option', { value: c.id }, c.name)));

  $('#add-form').addEventListener('submit', onSubmit);
  $('#number-input').addEventListener('input', updateDetectHint);
  $('#refresh-all').addEventListener('click', refreshAll);
  $('#search').addEventListener('input', (e) => { state.query = e.target.value.trim(); renderList(); });
  for (const btn of document.querySelectorAll('[data-filter]')) {
    btn.addEventListener('click', () => setFilter(btn.dataset.filter));
  }
  $('#import-file').addEventListener('change', (e) => {
    const [file] = e.target.files;
    if (file) importShipments(file);
    e.target.value = '';
  });
  setupMenu();
  setupDialogs();

  document.addEventListener('visibilitychange', autoRefresh);
  window.addEventListener('online', () => { fetchInfo(); autoRefresh(); });
  window.addEventListener('offline', renderFooter);
  setInterval(autoRefresh, 60_000);
  // Relative Zeitangaben („vor 5 Minuten“) aktuell halten.
  setInterval(() => { if (document.visibilityState === 'visible') renderList(); }, 60_000);

  handleSharedInput();
  render();
  fetchInfo().then(autoRefresh);

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

init();
