/**
 * Matching engine — implements the «Документы — Факт» reconciliation matrix
 * from chapter 2 of the thesis.
 *
 * Rules implemented:
 *  R1  time_arrival       — arrival time deviation > ±30 min (WARN > 60 = CRIT)
 *  R2  route_deviation    — GPS event_type = 'route_deviation' present (CRIT)
 *  R3  missing_load_proof — no proof with stage='loading' (CRIT)
 *  R4  missing_unload_proof — no proof with stage='unloading' (CRIT)
 *  R5  no_gps_data        — trip has zero GPS events (WARN)
 *  R6  geofence           — arrival event missing while arrival expected (WARN)
 *  R7  id_mismatch_doc    — document.trip_id not found in trips table (CRIT)
 *  R8  id_mismatch_gps    — gps_event.trip_id not found in trips table (CRIT)
 *  R9  missing_signatures — signed_by_* columns empty when doc not closed (WARN/CRIT)
 *  R10 no_document        — trip has no associated document at all (CRIT)
 */

import { formatDateTime } from './data.js';

let _counter = 1;

function nextId() {
  return `РАС-${String(_counter++).padStart(3, '0')}`;
}

function now() {
  return new Date().toISOString();
}

function isTruthy(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim().toLowerCase();
  return s !== '' && s !== 'false' && s !== '0' && s !== 'no' && s !== 'нет' && s !== 'null';
}

function minutesDiff(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 60000);
}

function deviationLabel(mins) {
  if (mins === null) return '?';
  const sign = mins >= 0 ? '+' : '';
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} ч`);
  if (m > 0 || h === 0) parts.push(`${m} мин`);
  return `${sign}${parts.join(' ')}`;
}

function makeIssue(fields) {
  return {
    id:          nextId(),
    status:      'new',
    detectedAt:  now(),
    history: [{ at: now(), role: 'Система', action: fields.historyAction }],
    ...fields,
  };
}

/* ─── Main export ─────────────────────────────────────── */
export function runMatching(trips, documents, gpsEvents, proofs) {
  _counter = 1;
  const issues = [];

  const tripIds = new Set(trips.map(t => t.trip_id));

  /* R7 — documents with unknown trip_id */
  documents.forEach(doc => {
    if (!tripIds.has(doc.trip_id)) {
      issues.push(makeIssue({
        tripId:      doc.trip_id || '—',
        type:        'id_mismatch',
        severity:    'CRIT',
        rule:        'Несоответствие идентификатора рейса в перевозочном документе данным системы блокирует документальное закрытие.',
        docData:     { label: 'ID рейса в документе', value: doc.trip_id || '—' },
        factData:    { label: 'ID рейса в системе',   value: 'Не найден' },
        responsible: 'docs',
        historyAction: `Карточка создана: документ ${doc.doc_id || '?'} ссылается на неизвестный рейс ${doc.trip_id}.`,
      }));
    }
  });

  /* R8 — GPS events with unknown trip_id */
  const orphanGpsTripIds = new Set(
    gpsEvents
      .filter(e => !tripIds.has(e.trip_id))
      .map(e => e.trip_id)
  );
  orphanGpsTripIds.forEach(tid => {
    issues.push(makeIssue({
      tripId:      tid || '—',
      type:        'id_mismatch',
      severity:    'CRIT',
      rule:        'GPS-события ссылаются на идентификатор рейса, которого нет в таблице рейсов.',
      docData:     { label: 'ID рейса в системе',     value: 'Не найден' },
      factData:    { label: 'ID рейса в GPS-событиях', value: tid },
      responsible: 'logist',
      historyAction: `Карточка создана: GPS-события ссылаются на неизвестный рейс ${tid}.`,
    }));
  });

  /* Per-trip rules */
  trips.forEach(trip => {
    const tripId  = trip.trip_id;
    const tripDocs = documents.filter(d => d.trip_id === tripId);
    const tripGps  = gpsEvents.filter(e => e.trip_id === tripId)
                               .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const tripProofs = proofs.filter(p => p.trip_id === tripId);

    /* R10 — no document for this trip */
    if (tripDocs.length === 0) {
      issues.push(makeIssue({
        tripId,
        type:        'id_mismatch',
        severity:    'CRIT',
        rule:        'Для рейса отсутствует перевозочный документ в системе. Закрытие невозможно без сопроводительного документа.',
        docData:     { label: 'Ожидаемый документ',  value: `Документ для рейса ${tripId}` },
        factData:    { label: 'Документ в системе',  value: 'Не найден' },
        responsible: 'docs',
        historyAction: `Карточка создана: нет документа для рейса ${tripId}.`,
      }));
    }

    /* R1 — arrival time deviation */
    if (trip.planned_arrival) {
      const arrivalEvents = tripGps.filter(e => e.event_type === 'arrival');
      if (arrivalEvents.length > 0) {
        const lastArrival = arrivalEvents[arrivalEvents.length - 1];
        const devMin      = minutesDiff(trip.planned_arrival, lastArrival.timestamp);

        if (devMin !== null && Math.abs(devMin) > 30) {
          const severity = Math.abs(devMin) > 60 ? 'CRIT' : 'WARN';
          issues.push(makeIssue({
            tripId,
            type:        'time_arrival',
            severity,
            rule:        'Отклонение фактического времени прибытия от планового более чем на ±30 минут. При превышении 60 минут уровень — CRIT, до 60 минут — WARN.',
            docData:     { label: 'Плановое прибытие',    value: formatDateTime(trip.planned_arrival) },
            factData:    { label: 'Фактическое прибытие', value: `${formatDateTime(lastArrival.timestamp)} (${deviationLabel(devMin)})` },
            responsible: 'logist',
            historyAction: `Карточка создана: зафиксировано опоздание ${deviationLabel(devMin)}.`,
          }));
        }
      }
    }

    /* R2 — route deviation events */
    tripGps.filter(e => e.event_type === 'route_deviation').forEach(ev => {
      issues.push(makeIssue({
        tripId,
        type:        'route_deviation',
        severity:    'CRIT',
        rule:        'Уход транспортного средства от планового маршрута более чем на 2 км на протяжении более 10 минут квалифицируется как критическое расхождение.',
        docData:     { label: 'Плановый маршрут', value: `${trip.route_from} → ${trip.route_to}` },
        factData:    { label: 'GPS-событие',      value: `Отклонение зафиксировано ${formatDateTime(ev.timestamp)}${ev.geofence_id ? `, геозона: ${ev.geofence_id}` : ''}` },
        responsible: 'logist',
        historyAction: 'Карточка создана: зафиксировано отклонение от маршрута.',
      }));
    });

    /* R3 — missing load proof */
    const loadProofs = tripProofs.filter(p =>
      p.stage && p.stage.toLowerCase().includes('load')
    );
    if (loadProofs.length === 0) {
      issues.push(makeIssue({
        tripId,
        type:        'missing_confirmation',
        severity:    'CRIT',
        rule:        'Для этапа «Погрузка» обязательно наличие подтверждения (фото или отметка водителя). Отсутствие подтверждения — критическое расхождение.',
        docData:     { label: 'Требование',             value: 'Подтверждение погрузки обязательно' },
        factData:    { label: 'Подтверждение погрузки', value: 'Не получено' },
        responsible: 'driver',
        historyAction: 'Карточка создана: нет подтверждения этапа «Погрузка».',
      }));
    }

    /* R4 — missing unload proof */
    const unloadProofs = tripProofs.filter(p =>
      p.stage && (p.stage.toLowerCase().includes('unload') || p.stage.toLowerCase().includes('разгр'))
    );
    if (unloadProofs.length === 0) {
      issues.push(makeIssue({
        tripId,
        type:        'missing_confirmation',
        severity:    'CRIT',
        rule:        'Для этапа «Разгрузка» обязательно наличие подтверждения (фото или отметка водителя). Отсутствие подтверждения — критическое расхождение.',
        docData:     { label: 'Требование',              value: 'Подтверждение разгрузки обязательно' },
        factData:    { label: 'Подтверждение разгрузки', value: 'Не получено' },
        responsible: 'driver',
        historyAction: 'Карточка создана: нет подтверждения этапа «Разгрузка».',
      }));
    }

    /* R5 — no GPS data */
    if (tripGps.length === 0) {
      issues.push(makeIssue({
        tripId,
        type:        'geofence',
        severity:    'WARN',
        rule:        'Отсутствие GPS-данных по рейсу: невозможно подтвердить маршрут и прохождение контрольных точек.',
        docData:     { label: 'Ожидаемые GPS-данные', value: 'Мониторинг активен' },
        factData:    { label: 'GPS-события',          value: 'Нет данных о перемещении' },
        responsible: 'logist',
        historyAction: 'Карточка создана: нет GPS-событий по рейсу.',
      }));
    }

    /* R6 — arrival event missing (GPS exists but no arrival) */
    if (tripGps.length > 0 && trip.planned_arrival) {
      const hasArrival = tripGps.some(e => e.event_type === 'arrival');
      if (!hasArrival) {
        issues.push(makeIssue({
          tripId,
          type:        'geofence',
          severity:    'WARN',
          rule:        'Отсутствие GPS-события прибытия в геозоне конечной точки при наличии других GPS-данных по рейсу.',
          docData:     { label: 'Плановое прибытие', value: formatDateTime(trip.planned_arrival) },
          factData:    { label: 'GPS-событие «arrival»', value: 'Не зафиксировано' },
          responsible: 'logist',
          historyAction: 'Карточка создана: нет события прибытия в геозоне.',
        }));
      }
    }

    /* R9 — missing signatures on documents */
    tripDocs.forEach(doc => {
      if (['signed', 'closed'].includes((doc.doc_status || '').toLowerCase())) return;

      const missing = [];
      if (!isTruthy(doc.signed_by_sender))   missing.push('отправитель');
      if (!isTruthy(doc.signed_by_carrier))  missing.push('перевозчик');
      if (!isTruthy(doc.signed_by_receiver)) missing.push('получатель');

      if (missing.length > 0) {
        const severity = missing.length >= 2 ? 'CRIT' : 'WARN';
        issues.push(makeIssue({
          tripId,
          type:        'missing_confirmation',
          severity,
          rule:        'Для документального закрытия перевозки необходимы подписи трёх сторон: отправитель, перевозчик, получатель.',
          docData:     { label: 'Документ',             value: doc.doc_number || doc.doc_id || '—' },
          factData:    { label: 'Отсутствуют подписи', value: missing.join(', ') },
          responsible: 'docs',
          historyAction: `Карточка создана: нет подписей (${missing.join(', ')}) в документе ${doc.doc_number || doc.doc_id}.`,
        }));
      }
    });
  });

  return issues;
}

/* ─── Summary stats for toast message ────────────────── */
export function summarize(issues) {
  const crit = issues.filter(i => i.severity === 'CRIT').length;
  const warn = issues.filter(i => i.severity === 'WARN').length;
  const trips = new Set(issues.map(i => i.tripId)).size;
  return { total: issues.length, crit, warn, trips };
}
