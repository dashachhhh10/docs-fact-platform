import { getIssues, getTrips, hasData, ISSUE_TYPES, ISSUE_STATUSES, RESPONSIBLE, formatDateTime } from './data.js';
import { PRIORITY_LABELS, PRIORITY_ORDER } from './priority-engine.js';

function severityBadge(sev) {
  return sev === 'CRIT'
    ? '<span class="badge badge-crit">CRIT</span>'
    : '<span class="badge badge-warn">WARN</span>';
}

function priorityBadge(priority) {
  return `<span class="badge badge-priority-${priority || 'normal'}">${PRIORITY_LABELS[priority] || PRIORITY_LABELS.normal}</span>`;
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${ISSUE_STATUSES[status] || status}</span>`;
}

function skeleton() {
  return `
    <div class="page-header">
      <div class="skeleton skeleton-title" style="width:200px"></div>
    </div>
    <div class="skeleton" style="height:44px;border-radius:var(--radius-sm);margin-bottom:16px"></div>
    ${Array(5).fill('<div class="skeleton" style="height:64px;border-radius:var(--radius);margin-bottom:8px"></div>').join('')}`;
}

function renderEmpty(container) {
  container.innerHTML = `
    <div class="empty-state" style="min-height:60vh">
      <i data-lucide="triangle-alert" style="width:52px;height:52px;color:var(--text-muted)"></i>
      <div class="empty-state-title">Нет данных о расхождениях</div>
      <div class="empty-state-text">Загрузите CSV-файлы и запустите сверку, чтобы увидеть карточки расхождений.</div>
      <a href="#upload" class="btn btn-primary mt-16">
        <i data-lucide="upload"></i> Загрузить данные
      </a>
    </div>`;
  window.App.initIcons(container);
}

let state = { status: 'ALL', type: 'ALL', tripId: 'ALL', responsible: 'ALL', priority: 'ALL' };

export function renderIssues(container) {
  if (!hasData()) { renderEmpty(container); return; }

  container.innerHTML = skeleton();
  container.classList.remove('page-enter');
  void container.offsetWidth;
  container.classList.add('page-enter');

  state = { status: 'ALL', type: 'ALL', tripId: 'ALL', responsible: 'ALL', priority: 'ALL' };

  // Apply pending filter from dashboard priority cards
  if (window.__issueFilter) {
    Object.assign(state, window.__issueFilter);
    window.__issueFilter = null;
  }

  setTimeout(() => renderContent(container), 140);
}

function renderContent(container) {
  const allIssues = getIssues();
  const trips     = getTrips();

  // Get base-filtered issues (without priority filter)
  const baseFiltered = getIssues(
    Object.fromEntries(
      Object.entries(state).filter(([k, v]) => v !== 'ALL' && k !== 'priority')
    )
  );

  // Apply priority filter
  let filtered = state.priority !== 'ALL'
    ? baseFiltered.filter(i => i.priority === state.priority)
    : baseFiltered;

  // Sort: urgent → high → normal → low, then by detectedAt asc within each group
  filtered = [...filtered].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return new Date(a.detectedAt) - new Date(b.detectedAt);
  });

  // Counts for status pills (from allIssues, ignoring all filters)
  const statusCounts = {};
  ['ALL', 'new', 'in_progress', 'confirmed', 'dismissed', 'closed'].forEach(s => {
    statusCounts[s] = s === 'ALL' ? allIssues.length : allIssues.filter(i => i.status === s).length;
  });

  // Counts for priority pills (from allIssues)
  const priorityCounts = { ALL: allIssues.length };
  ['urgent', 'high', 'normal', 'low'].forEach(p => {
    priorityCounts[p] = allIssues.filter(i => i.priority === p).length;
  });

  const statusPills = [
    { key: 'ALL',         label: 'Все' },
    { key: 'new',         label: 'Новое' },
    { key: 'in_progress', label: 'В работе' },
    { key: 'confirmed',   label: 'Подтверждено' },
    { key: 'dismissed',   label: 'Снято' },
    { key: 'closed',      label: 'Закрыто' },
  ];

  const priorityPills = [
    { key: 'ALL',    label: 'Все приоритеты' },
    { key: 'urgent', label: '🔴 Срочно' },
    { key: 'high',   label: '🟠 До конца дня' },
    { key: 'normal', label: '🔵 Стандарт' },
    { key: 'low',    label: '⚪ Низкий' },
  ];

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Расхождения</h1>
        <p class="page-subtitle">Новых: ${allIssues.filter(i => i.status === 'new').length} · Всего: ${allIssues.length}</p>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-pills">
        ${statusPills.map(p => `
          <button class="pill ${state.status === p.key ? 'active' : ''}" data-status="${p.key}">
            ${p.label} <span class="text-muted">${statusCounts[p.key]}</span>
          </button>`).join('')}
      </div>

      <div class="filter-pills">
        ${priorityPills.map(p => `
          <button class="pill ${state.priority === p.key ? 'active' : ''}" data-priority="${p.key}">
            ${p.label} <span class="text-muted">${priorityCounts[p.key] ?? 0}</span>
          </button>`).join('')}
      </div>

      <select class="form-select" id="filter-type" style="min-width:190px">
        <option value="ALL">Все типы</option>
        ${Object.entries(ISSUE_TYPES).map(([k, v]) =>
          `<option value="${k}" ${state.type === k ? 'selected' : ''}>${v}</option>`
        ).join('')}
      </select>

      <select class="form-select" id="filter-trip" style="min-width:140px">
        <option value="ALL">Все рейсы</option>
        ${trips.map(t =>
          `<option value="${t.id}" ${state.tripId === t.id ? 'selected' : ''}>${t.id}</option>`
        ).join('')}
      </select>

      <select class="form-select" id="filter-resp" style="min-width:190px">
        <option value="ALL">Все ответственные</option>
        ${Object.entries(RESPONSIBLE).map(([k, v]) =>
          `<option value="${k}" ${state.responsible === k ? 'selected' : ''}>${v}</option>`
        ).join('')}
      </select>

      ${filtered.length < allIssues.length ? `<span class="filter-count">${filtered.length} из ${allIssues.length}</span>` : ''}
    </div>

    <div id="issues-list" class="flex flex-col gap-8">
      ${filtered.length === 0
        ? `<div class="empty-state">
             <i data-lucide="inbox"></i>
             <div class="empty-state-title">Расхождения не найдены</div>
             <div class="empty-state-text">Попробуйте изменить фильтры</div>
           </div>`
        : filtered.map(issue => `
          <div class="issue-card" onclick="location.hash='#issues/${encodeURIComponent(issue.id)}'" role="button" tabindex="0">
            <div class="issue-card-stripe issue-card-stripe-${issue.priority || issue.severity.toLowerCase()}"></div>
            <div class="issue-card-body">
              <div class="issue-card-main">
                <div class="issue-card-title">${ISSUE_TYPES[issue.type] || issue.type}</div>
                <div class="issue-card-meta">
                  <span class="col-id" style="font-size:var(--text-xs)">${issue.tripId}</span>
                  &nbsp;·&nbsp;${issue.docData.label}: ${issue.docData.value}
                </div>
              </div>
              <div class="flex items-center gap-4">
                ${severityBadge(issue.severity)}
                ${priorityBadge(issue.priority)}
              </div>
              <div>${statusBadge(issue.status)}</div>
              <div class="text-xs text-secondary" style="white-space:nowrap">
                ${RESPONSIBLE[issue.responsible] || issue.responsible}
              </div>
              <div class="text-xs text-muted" style="white-space:nowrap;font-family:monospace">
                ${formatDateTime(issue.detectedAt).split(',')[0]}
              </div>
              <div class="issue-card-arrow"><i data-lucide="chevron-right"></i></div>
            </div>
          </div>`).join('')
      }
    </div>
  `;

  window.App.initIcons(container);
  attachHandlers(container);
}

function attachHandlers(container) {
  container.querySelectorAll('.pill[data-status]').forEach(btn => {
    btn.addEventListener('click', () => { state.status = btn.dataset.status; renderContent(container); });
  });

  container.querySelectorAll('.pill[data-priority]').forEach(btn => {
    btn.addEventListener('click', () => { state.priority = btn.dataset.priority; renderContent(container); });
  });

  const sel = (id, key) => {
    const el = container.querySelector(id);
    if (el) el.addEventListener('change', () => { state[key] = el.value; renderContent(container); });
  };

  sel('#filter-type', 'type');
  sel('#filter-trip', 'tripId');
  sel('#filter-resp', 'responsible');
}
