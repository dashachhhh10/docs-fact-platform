import {
  getTripById, getIssues, hasOpenCritIssues, hasData,
  ISSUE_TYPES, ISSUE_STATUSES, RESPONSIBLE, DOC_STATUSES,
  formatDate, formatDateTime, formatTime
} from './data.js';
import { PRIORITY_LABELS, PRIORITY_ORDER } from './priority-engine.js';

function statusBadge(status) {
  const map = {
    OK:         '<span class="badge badge-ok"><i data-lucide="check-circle"></i> OK</span>',
    HAS_ISSUES: '<span class="badge badge-warn"><i data-lucide="triangle-alert"></i> HAS_ISSUES</span>',
    BLOCKED:    '<span class="badge badge-crit"><i data-lucide="lock"></i> BLOCKED</span>',
  };
  return map[status] || '';
}

function severityBadge(sev) {
  return sev === 'CRIT'
    ? '<span class="badge badge-crit">CRIT</span>'
    : '<span class="badge badge-warn">WARN</span>';
}

function issueStatusBadge(status) {
  return `<span class="badge badge-${status}">${ISSUE_STATUSES[status] || status}</span>`;
}

function dotClass(status) {
  const map = { ok: 'timeline-dot-ok', warn: 'timeline-dot-warn', crit: 'timeline-dot-crit', info: 'timeline-dot-info' };
  return map[status] || '';
}

function eventIcon(type) {
  const map = {
    departure:        'truck',
    arrival:          'map-pin',
    checkpoint:       'flag',
    route_deviation:  'route-off',
    load_confirmed:   'package-check',
    unload_confirmed: 'package-check',
    geofence_entry:   'map',
    geofence_exit:    'map',
    stop:             'pause-circle',
  };
  return map[type] || 'circle';
}

function minutesDiff(a, b) {
  const da = new Date(a), db = new Date(b);
  if (isNaN(da) || isNaN(db)) return null;
  return Math.round((db - da) / 60000);
}

function deviationLabel(mins) {
  if (mins === null) return null;
  if (mins === 0)    return null;
  const sign = mins > 0 ? '+' : '';
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  const parts = [];
  if (h) parts.push(`${h} ч`);
  if (m || !h) parts.push(`${m} мин`);
  return `${sign}${parts.join(' ')}`;
}

function renderEmpty(container) {
  container.innerHTML = `
    <div class="empty-state" style="min-height:60vh">
      <i data-lucide="truck" style="width:52px;height:52px;color:var(--text-muted)"></i>
      <div class="empty-state-title">Нет данных о рейсах</div>
      <div class="empty-state-text">Загрузите CSV-файлы для работы с рейсами.</div>
      <a href="#upload" class="btn btn-primary mt-16">
        <i data-lucide="upload"></i> Загрузить данные
      </a>
    </div>`;
  window.App.initIcons(container);
}

export function renderTripDetail(container, tripId) {
  if (!hasData()) { renderEmpty(container); return; }

  container.innerHTML = `
    <div class="skeleton skeleton-title" style="width:200px;margin-bottom:24px"></div>
    ${Array(4).fill('<div class="skeleton skeleton-row" style="margin-bottom:8px"></div>').join('')}`;
  container.classList.remove('page-enter');
  void container.offsetWidth;
  container.classList.add('page-enter');

  setTimeout(() => paint(container, tripId), 160);
}

function paint(container, tripId) {
  const trip = getTripById(tripId);

  if (!trip) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="search-x"></i>
        <div class="empty-state-title">Рейс не найден</div>
        <div class="empty-state-text">Рейс ${tripId} отсутствует в загруженных данных.</div>
        <a href="#trips" class="btn btn-ghost mt-16">← Все рейсы</a>
      </div>`;
    window.App.initIcons(container);
    return;
  }

  const issues    = getIssues({ tripId });
  const blocked   = hasOpenCritIssues(tripId);

  const maxPriority = issues.length > 0
    ? issues.reduce((best, i) =>
        (PRIORITY_ORDER[i.priority] ?? 3) < (PRIORITY_ORDER[best] ?? 3) ? i.priority : best,
        'low')
    : null;
  const critCount = issues.filter(i =>
    i.severity === 'CRIT' && !['confirmed','dismissed','closed'].includes(i.status)
  ).length;

  /* Plan / Fact comparison rows */
  const depDev = trip.actualDeparture ? minutesDiff(trip.plannedDeparture, trip.actualDeparture) : null;
  const arrDev = trip.actualArrival   ? minutesDiff(trip.plannedArrival,   trip.actualArrival)   : null;

  function devClass(mins) {
    if (mins === null) return '';
    if (Math.abs(mins) > 60) return 'crit';
    if (Math.abs(mins) > 30) return 'warn';
    return 'ok';
  }

  const hasRouteIssue = issues.some(i => i.type === 'route_deviation' && !['dismissed','closed'].includes(i.status));
  const hasWeightIssue = issues.some(i => i.type === 'weight_deviation');
  const hasMissingConf = issues.some(i => i.type === 'missing_confirmation' && !['dismissed','closed'].includes(i.status));

  const paramRows = [
    {
      key:       'Отправление',
      plan:      formatDateTime(trip.plannedDeparture),
      fact:      trip.actualDeparture ? formatDateTime(trip.actualDeparture) : null,
      factClass: depDev !== null ? devClass(depDev) : '',
      note:      deviationLabel(depDev),
    },
    {
      key:       'Прибытие',
      plan:      formatDateTime(trip.plannedArrival),
      fact:      trip.actualArrival ? formatDateTime(trip.actualArrival) : null,
      factClass: arrDev !== null ? devClass(arrDev) : '',
      note:      deviationLabel(arrDev),
    },
    {
      key:       'Маршрут',
      plan:      `${trip.route.from} → ${trip.route.to}`,
      fact:      hasRouteIssue ? 'Зафиксировано отклонение' : (trip.events.length > 0 ? 'По маршруту' : '—'),
      factClass: hasRouteIssue ? 'crit' : (trip.events.length > 0 ? 'ok' : ''),
    },
    {
      key:       'Груз',
      plan:      trip.cargo
        ? `${trip.cargo.name}, ${trip.cargo.units} ${trip.cargo.type}${trip.cargo.weight ? ', ' + trip.cargo.weight + ' кг' : ''}`
        : '—',
      fact:      hasWeightIssue ? 'Отклонение веса' : (trip.cargo ? 'Соответствует документу' : '—'),
      factClass: hasWeightIssue ? 'warn' : (trip.cargo ? 'ok' : ''),
    },
    {
      key:       'Документ',
      plan:      trip.docId,
      fact:      DOC_STATUSES[trip.docStatus] || trip.docStatus || '—',
      factClass: ['signed','closed'].includes(trip.docStatus) ? 'ok' : 'warn',
    },
    {
      key:       'Подтверждения',
      plan:      'Погрузка + разгрузка',
      fact:      hasMissingConf ? 'Не все получены' : 'Получены',
      factClass: hasMissingConf ? 'crit' : 'ok',
    },
  ];

  const closeBtn = blocked
    ? `<button class="btn btn-ghost" disabled title="${critCount} критических расхождений не закрыты">
         <i data-lucide="lock"></i> Закрыть перевозку
       </button>`
    : `<button class="btn btn-success" id="btn-close-trip">
         <i data-lucide="check-circle"></i> Закрыть перевозку
       </button>`;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="flex items-center gap-12 flex-wrap">
          <h1 class="page-title">${trip.id}</h1>
          ${statusBadge(trip.status)}
          ${maxPriority ? `<span class="badge badge-priority-${maxPriority}">${PRIORITY_LABELS[maxPriority]}</span>` : ''}
        </div>
        <p class="page-subtitle">${trip.route.from} → ${trip.route.to}&nbsp;·&nbsp;${trip.contractor}</p>
      </div>
      <div class="flex items-center gap-8">
        ${blocked ? `<span class="badge badge-crit"><i data-lucide="lock"></i> ${critCount} крит. открыто</span>` : ''}
        ${closeBtn}
      </div>
    </div>

    ${blocked ? `
      <div class="alert alert-crit mb-16" style="padding:10px 16px">
        <i data-lucide="lock"></i>
        <span>Закрытие заблокировано — ${critCount} критических расхождений без решения</span>
      </div>` : ''}

    <!-- Info strip -->
    <div class="card mb-16">
      <div class="trip-info-grid">
        <div class="trip-info-cell"><div class="trip-info-label">Водитель</div><div class="trip-info-value">${trip.driver}</div></div>
        <div class="trip-info-cell"><div class="trip-info-label">Транспортное средство</div><div class="trip-info-value">${trip.vehicle}</div></div>
        <div class="trip-info-cell"><div class="trip-info-label">Документ</div><div class="trip-info-value">${trip.docId}</div></div>
        <div class="trip-info-cell"><div class="trip-info-label">Статус документа</div><div class="trip-info-value">${DOC_STATUSES[trip.docStatus] || trip.docStatus || '—'}</div></div>
        <div class="trip-info-cell"><div class="trip-info-label">Дата отправления</div><div class="trip-info-value">${formatDate(trip.plannedDeparture)}</div></div>
        <div class="trip-info-cell">
          <div class="trip-info-label">Расхождений</div>
          <div class="trip-info-value ${issues.length > 0 ? 'text-warn' : 'text-ok'}">${issues.length}</div>
        </div>
      </div>
    </div>

    <!-- Main grid -->
    <div class="grid-2 mb-16" style="grid-template-columns:3fr 2fr">
      <!-- Plan vs Fact -->
      <div class="card">
        <div class="card-header"><span class="card-title">План — Факт</span></div>
        <div style="overflow:hidden;border-radius:0 0 var(--radius) var(--radius)">
          <div class="param-table-header">
            <div class="param-cell param-key">Параметр</div>
            <div class="param-cell param-key">Документ (план)</div>
            <div class="param-cell param-key">Факт</div>
          </div>
          ${paramRows.map(row => `
            <div class="param-row">
              <div class="param-cell param-key">${row.key}</div>
              <div class="param-cell param-value">${row.plan}</div>
              <div class="param-cell param-value param-value-${row.factClass || ''}">
                ${row.fact || '<span class="text-muted">—</span>'}
                ${row.note ? `<div class="text-xs text-secondary mt-4">${row.note}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Timeline -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Хронология событий</span>
          <span class="badge badge-neutral">${trip.events.length}</span>
        </div>
        <div class="card-body">
          ${trip.events.length === 0
            ? `<div class="empty-state" style="padding:32px">
                 <i data-lucide="map-off"></i>
                 <div class="empty-state-title text-sm">GPS-данных нет</div>
               </div>`
            : `<div class="timeline">
                 ${trip.events.map((ev, idx) => `
                   <div class="timeline-item">
                     <div class="timeline-dot-wrap">
                       <div class="timeline-dot ${dotClass(ev.status)}"></div>
                       ${idx < trip.events.length - 1 ? '<div class="timeline-line"></div>' : ''}
                     </div>
                     <div class="timeline-content">
                       <div class="timeline-time">
                         <i data-lucide="${eventIcon(ev.type)}" style="width:11px;height:11px;display:inline-block;vertical-align:middle"></i>
                         ${ev.time ? formatTime(ev.time) : '—'}
                       </div>
                       <div class="timeline-label">${ev.label}</div>
                       ${ev.note ? `<div class="timeline-note">${ev.note}</div>` : ''}
                     </div>
                   </div>`).join('')}
               </div>`
          }
        </div>
      </div>
    </div>

    <!-- Issues for this trip -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Расхождения по рейсу</span>
        <span class="badge ${issues.length > 0 ? 'badge-warn' : 'badge-ok'}">${issues.length}</span>
      </div>
      <div class="card-body-sm">
        ${issues.length === 0
          ? `<div class="empty-state" style="padding:32px">
               <i data-lucide="check-circle"></i>
               <div class="empty-state-title text-sm">Расхождений нет</div>
             </div>`
          : `<div class="flex flex-col gap-8">
               ${issues.map(issue => `
                 <div class="issue-card" onclick="location.hash='#issues/${encodeURIComponent(issue.id)}'">
                   <div class="issue-card-stripe issue-card-stripe-${issue.priority || issue.severity.toLowerCase()}"></div>
                   <div class="issue-card-body">
                     <div class="issue-card-main">
                       <div class="issue-card-title">${ISSUE_TYPES[issue.type] || issue.type}</div>
                       <div class="issue-card-meta">${issue.docData.value} → ${issue.factData.value}</div>
                     </div>
                     <div>${severityBadge(issue.severity)}</div>
                     <div>${issueStatusBadge(issue.status)}</div>
                     <div class="text-xs text-secondary">${RESPONSIBLE[issue.responsible] || issue.responsible}</div>
                     <div class="issue-card-arrow"><i data-lucide="chevron-right"></i></div>
                   </div>
                 </div>`).join('')}
             </div>`
        }
      </div>
    </div>
  `;

  window.App.initIcons(container);

  const btnClose = container.querySelector('#btn-close-trip');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      btnClose.disabled  = true;
      btnClose.className = 'btn btn-ghost';
      btnClose.innerHTML = '<i data-lucide="check"></i> Перевозка закрыта';
      window.App.initIcons(btnClose);
      window.App.showToast(`Перевозка ${trip.id} успешно закрыта`, 'success');
    });
  }
}
