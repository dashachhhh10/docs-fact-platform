import { computePriority, PRIORITY_ORDER } from './priority-engine.js';
import { extractFeatures, predictPriority } from './ml-classifier.js';

/* ─── Storage keys ───────────────────────────────────── */
const K = {
  dataset:   'docfact_dataset',    // { trips, documents, gpsEvents, proofs }
  issues:    'docfact_issues_base', // issues[] from last matching engine run
  overrides: 'docfact_overrides',  // { [id]: { status, history[] } }
};

/* ─── Formatters ──────────────────────────────────────── */
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('ru-RU', {
    day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
  });
}

export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
}

/* ─── Dictionaries ────────────────────────────────────── */
export const ISSUE_TYPES = {
  time_arrival:         'Опоздание на точку',
  route_deviation:      'Отклонение от маршрута',
  missing_confirmation: 'Нет подтверждения этапа',
  id_mismatch:          'Несоответствие идентификатора',
  geofence:             'Нет события в геозоне',
  weight_deviation:     'Отклонение веса',
};

export const ISSUE_STATUSES = {
  new:         'Новое',
  in_progress: 'В работе',
  confirmed:   'Подтверждено',
  dismissed:   'Снято',
  closed:      'Закрыто',
};

export const RESPONSIBLE = {
  logist:  'Логист/диспетчер',
  driver:  'Водитель',
  docs:    'Документальный контур',
  manager: 'Руководитель',
};

export const DOC_STATUSES = {
  draft:  'Черновик',
  agreed: 'Согласован',
  signed: 'Подписан',
  closed: 'Закрыт',
};

/* ─── Low-level storage ───────────────────────────────── */
function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch { return null; }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.error('localStorage write error:', e); }
}

/* ─── Dataset persistence ─────────────────────────────── */
export function hasData() {
  return !!localStorage.getItem(K.dataset);
}

export function getDataset() {
  return readJSON(K.dataset);
}

export function saveDataset(trips, documents, gpsEvents, proofs) {
  writeJSON(K.dataset, { trips, documents, gpsEvents, proofs });
}

export function saveBaseIssues(issues) {
  writeJSON(K.issues, issues);
}

export function clearData() {
  Object.values(K).forEach(k => localStorage.removeItem(k));
}

/* ─── Overrides (user status changes) ────────────────── */
function getOverrides() {
  return readJSON(K.overrides) || {};
}

function saveOverrides(ov) {
  writeJSON(K.overrides, ov);
}

/* ─── Timeline builder ────────────────────────────────── */
const GPS_TYPE_META = {
  departure:        { label: 'Выезд',                   status: 'ok',   icon: 'truck' },
  arrival:          { label: 'Прибытие',                status: 'ok',   icon: 'map-pin' },
  checkpoint:       { label: 'Контрольная точка',       status: 'ok',   icon: 'flag' },
  route_deviation:  { label: 'Отклонение от маршрута',  status: 'crit', icon: 'route-off' },
  load_confirmed:   { label: 'Погрузка подтверждена',   status: 'ok',   icon: 'package-check' },
  unload_confirmed: { label: 'Разгрузка подтверждена',  status: 'ok',   icon: 'package-check' },
  geofence_entry:   { label: 'Вход в геозону',          status: 'info', icon: 'map' },
  geofence_exit:    { label: 'Выход из геозоны',        status: 'info', icon: 'map' },
  stop:             { label: 'Остановка',               status: 'warn', icon: 'pause-circle' },
};

function buildTimeline(gpsEvents) {
  return [...gpsEvents]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map(ev => {
      const meta = GPS_TYPE_META[ev.event_type] || { label: ev.event_type, status: 'info', icon: 'circle' };
      return {
        type:   ev.event_type,
        time:   ev.timestamp,
        label:  meta.label + (ev.geofence_id ? `: ${ev.geofence_id}` : ''),
        status: meta.status,
        note:   ev.speed_kmh ? `${parseFloat(ev.speed_kmh).toFixed(0)} км/ч` : null,
      };
    });
}

/* ─── Trip enrichment ─────────────────────────────────── */
function enrichTrip(raw, allIssues, dataset) {
  const tripId    = raw.trip_id;
  const tripIssues = allIssues.filter(i => i.tripId === tripId);
  const gpsEvents  = (dataset.gpsEvents || []).filter(e => e.trip_id === tripId);
  const doc        = (dataset.documents || []).find(d => d.trip_id === tripId);

  const openCrit = tripIssues.filter(i =>
    i.severity === 'CRIT' && !['confirmed','dismissed','closed'].includes(i.status)
  );
  const openAny = tripIssues.filter(i =>
    !['confirmed','dismissed','closed'].includes(i.status)
  );

  const computedStatus =
    openCrit.length > 0 ? 'BLOCKED' :
    openAny.length  > 0 ? 'HAS_ISSUES' : 'OK';

  const sorted       = [...gpsEvents].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const depEvent     = sorted.find(e => e.event_type === 'departure');
  const arrEvents    = sorted.filter(e => e.event_type === 'arrival');
  const lastArrival  = arrEvents.length > 0 ? arrEvents[arrEvents.length - 1] : null;

  return {
    id:               tripId,
    status:           computedStatus,
    route:            { from: raw.route_from || '—', to: raw.route_to || '—' },
    contractor:       raw.contractor || '—',
    driver:           raw.driver     || '—',
    vehicle:          raw.vehicle    || '—',
    plannedDeparture: raw.planned_departure  || null,
    plannedArrival:   raw.planned_arrival    || null,
    actualDeparture:  depEvent     ? depEvent.timestamp    : null,
    actualArrival:    lastArrival  ? lastArrival.timestamp : null,
    cargo: doc ? {
      name:   doc.cargo_name        || '—',
      units:  doc.cargo_places      || '—',
      weight: doc.cargo_weight_kg   || '—',
      type:   'мест',
    } : null,
    docId:     doc ? (doc.doc_number || doc.doc_id) : '—',
    docStatus: doc ? (doc.doc_status || 'draft')    : '—',
    events:    buildTimeline(gpsEvents),
  };
}

/* ─── Public getters ──────────────────────────────────── */
export function getTrips(filters = {}) {
  const dataset = getDataset();
  if (!dataset) return [];

  const allIssues = getIssues();

  let trips = (dataset.trips || []).map(raw => enrichTrip(raw, allIssues, dataset));

  if (filters.status && filters.status !== 'ALL') {
    trips = trips.filter(t => t.status === filters.status);
  }

  if (filters.search) {
    const q = filters.search.toLowerCase();
    trips = trips.filter(t =>
      t.id.toLowerCase().includes(q) ||
      t.route.from.toLowerCase().includes(q) ||
      t.route.to.toLowerCase().includes(q) ||
      t.contractor.toLowerCase().includes(q) ||
      t.driver.toLowerCase().includes(q)
    );
  }

  return trips;
}

export function getTripById(id) {
  const dataset = getDataset();
  if (!dataset) return null;

  const raw = (dataset.trips || []).find(t => t.trip_id === id);
  if (!raw) return null;

  const allIssues = getIssues();
  return enrichTrip(raw, allIssues, dataset);
}

export function getIssues(filters = {}) {
  const base      = readJSON(K.issues) || [];
  const overrides = getOverrides();

  let issues = base.map(issue => {
    const ov = overrides[issue.id];
    if (!ov) return { ...issue };
    return {
      ...issue,
      status:  ov.status || issue.status,
      history: [...(issue.history || []), ...(ov.history || [])],
    };
  });

  // Count open (non-terminal) issues per trip for priority engine
  const openByTrip = {};
  issues.forEach(i => {
    if (!['confirmed', 'dismissed', 'closed'].includes(i.status)) {
      openByTrip[i.tripId] = (openByTrip[i.tripId] || 0) + 1;
    }
  });

  // Enrich each issue with computed priority
  const dataset = getDataset();
  issues = issues.map(issue => {
    let tripCtx = null;
    if (dataset) {
      const rawTrip = (dataset.trips     || []).find(t => t.trip_id  === issue.tripId);
      const tripDoc = (dataset.documents || []).find(d => d.trip_id  === issue.tripId);
      tripCtx = {
        plannedArrival: rawTrip ? rawTrip.planned_arrival : null,
        docStatus:      tripDoc ? tripDoc.doc_status      : null,
        rawStatus:      rawTrip ? rawTrip.status          : null,
      };
    }
    const openCount = openByTrip[issue.tripId] || 0;
    const { priority: rulesPriority, reasons } = computePriority(issue, tripCtx, openCount);

    // ML refinement: upgrade priority if model is confident and predicts higher urgency
    const featureVec = extractFeatures(issue, tripCtx, openCount);
    const mlResult   = predictPriority(featureVec);

    let priority   = rulesPriority;
    let mlOverride = false;

    if (mlResult && mlResult.confidence > 0.80) {
      const rulesRank = PRIORITY_ORDER[rulesPriority] ?? 2;
      const mlRank    = PRIORITY_ORDER[mlResult.priority] ?? 2;
      if (mlRank < rulesRank) {
        priority   = mlResult.priority;
        mlOverride = true;
        reasons.push('Модель скорректировала приоритет на основе анализа похожих расхождений');
      }
    }

    return {
      ...issue,
      priority,
      priorityReasons:  reasons,
      mlOverride,
      mlProbabilities:  mlResult?.probabilities ?? null,
      mlConfidence:     mlResult?.confidence    ?? null,
    };
  });

  if (filters.status && filters.status !== 'ALL') {
    issues = issues.filter(i => i.status === filters.status);
  }
  if (filters.type && filters.type !== 'ALL') {
    issues = issues.filter(i => i.type === filters.type);
  }
  if (filters.tripId && filters.tripId !== 'ALL') {
    issues = issues.filter(i => i.tripId === filters.tripId);
  }
  if (filters.responsible && filters.responsible !== 'ALL') {
    issues = issues.filter(i => i.responsible === filters.responsible);
  }

  return issues;
}

export function getIssueById(id) {
  return getIssues().find(i => i.id === id) || null;
}

export function updateIssueStatus(id, newStatus, comment) {
  const overrides  = getOverrides();
  if (!overrides[id]) overrides[id] = { history: [] };
  overrides[id].status = newStatus;

  const issue = getIssueById(id);
  const role  = issue ? (RESPONSIBLE[issue.responsible] || 'Пользователь') : 'Пользователь';

  const actionMap = {
    in_progress: 'Карточка взята в работу.',
    confirmed:   'Отклонение подтверждено как допустимое.',
    dismissed:   'Расхождение снято.',
    closed:      'Карточка закрыта.',
  };

  const action = actionMap[newStatus] || `Статус изменён на «${ISSUE_STATUSES[newStatus]}».`;
  overrides[id].history = [
    ...(overrides[id].history || []),
    {
      at:     new Date().toISOString(),
      role,
      action: comment ? `${action} Комментарий: ${comment}` : action,
    },
  ];

  saveOverrides(overrides);
}

/* ─── Stats & checks ──────────────────────────────────── */
export function getStats() {
  const trips  = getTrips();
  const issues = getIssues();

  const byStatus   = { new: 0, in_progress: 0, confirmed: 0, dismissed: 0, closed: 0 };
  const byType     = {};
  const byPriority = { urgent: 0, high: 0, normal: 0, low: 0 };

  issues.forEach(i => {
    byStatus[i.status]     = (byStatus[i.status]       || 0) + 1;
    byType[i.type]         = (byType[i.type]           || 0) + 1;
    byPriority[i.priority] = (byPriority[i.priority]   || 0) + 1;
  });

  return {
    trips: {
      total:      trips.length,
      ok:         trips.filter(t => t.status === 'OK').length,
      has_issues: trips.filter(t => t.status === 'HAS_ISSUES').length,
      blocked:    trips.filter(t => t.status === 'BLOCKED').length,
    },
    issues: {
      total:       issues.length,
      open:        byStatus.new,
      in_progress: byStatus.in_progress,
      byStatus,
      byType,
      byPriority,
    },
  };
}

export function getOpenIssuesCount() {
  return (readJSON(K.issues) || []).filter(i => {
    const ov = (readJSON(K.overrides) || {})[i.id];
    const status = ov ? (ov.status || i.status) : i.status;
    return status === 'new';
  }).length;
}

export function hasOpenCritIssues(tripId) {
  return getIssues({ tripId }).some(
    i => i.severity === 'CRIT' && !['confirmed','dismissed','closed'].includes(i.status)
  );
}
