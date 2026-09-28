// Einheitliche Sendungsstatus – alle Anbieter werden auf diese Werte abgebildet.
// Wird von Server und Browser gemeinsam genutzt.

export const STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  PENDING: 'pending',
  INFO_RECEIVED: 'info_received',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  AVAILABLE_FOR_PICKUP: 'available_for_pickup',
  FAILED_ATTEMPT: 'failed_attempt',
  DELIVERED: 'delivered',
  EXCEPTION: 'exception',
  EXPIRED: 'expired',
});

export const STATUS_INFO = Object.freeze({
  unknown: { label: 'Unbekannt', tone: 'neutral', step: 0 },
  pending: { label: 'Noch keine Daten', tone: 'neutral', step: 0 },
  info_received: { label: 'Angekündigt', tone: 'info', step: 1 },
  in_transit: { label: 'Unterwegs', tone: 'progress', step: 2 },
  out_for_delivery: { label: 'In Zustellung', tone: 'progress', step: 3 },
  available_for_pickup: { label: 'Abholbereit', tone: 'warning', step: 3 },
  failed_attempt: { label: 'Zustellversuch fehlgeschlagen', tone: 'danger', step: 3 },
  delivered: { label: 'Zugestellt', tone: 'success', step: 4 },
  exception: { label: 'Problem', tone: 'danger', step: 2 },
  expired: { label: 'Keine Updates mehr', tone: 'neutral', step: 0 },
});

/** Sendungen in diesen Status werden nicht mehr automatisch aktualisiert. */
export const FINAL_STATUSES = new Set([STATUS.DELIVERED, STATUS.EXPIRED]);

export function statusInfo(status) {
  return STATUS_INFO[status] ?? STATUS_INFO.unknown;
}

export function isValidStatus(status) {
  return Object.hasOwn(STATUS_INFO, status);
}
