import {
  getIssueById, updateIssueStatus, hasData,
  ISSUE_TYPES, ISSUE_STATUSES, RESPONSIBLE,
  formatDateTime
} from './data.js';
import { PRIORITY_LABELS } from './priority-engine.js';

const STATUS_FLOW = ['new', 'in_progress', 'confirmed', 'dismissed', 'closed'];

const STATUS_ACTIONS = {
  new:         [{ next: 'in_progress', label: 'Взять в работу',           cls: 'btn-primary' }],
  in_progress: [
    { next: 'confirmed', label: 'Подтвердить отклонение', cls: 'btn-success' },
    { next: 'dismissed', label: 'Снять расхождение',      cls: 'btn-ghost'   },
  ],
  confirmed:   [{ next: 'closed', label: 'Закрыть карточку', cls: 'btn-ghost' }],
  dismissed:   [{ next: 'closed', label: 'Закрыть карточку', cls: 'btn-ghost' }],
  closed:      [],
};

function stepIndex(status) {
  const map = { new: 0, in_progress: 1, confirmed: 2, dismissed: 2, closed: 3 };
  return map[status] ?? 0;
}

function severityBadge(sev) {
  return sev === 'CRIT'
    ? '<span class="badge badge-crit"><i data-lucide="triangle-alert"></i> CRIT</span>'
    : '<span class="badge badge-warn"><i data-lucide="alert-circle"></i> WARN</span>';
}

function historyAvatar(role) {
  const isSystem = role === 'Система';
  return `<div class="history-avatar ${isSystem ? 'history-avatar-system' : ''}">
    ${isSystem ? '<i data-lucide="cpu" style="width:12px;height:12px"></i>' : role.charAt(0)}
  </div>`;
}

function buildStatusFlow(currentStatus) {
  const steps = [
    { key: 'new',         label: 'Новое' },
    { key: 'in_progress', label: 'В работе' },
    { key: 'done',        label: 'Завершено' },
  ];

  const cur = stepIndex(currentStatus);

  return steps.map((step, i) => {
    const isDone    = i < cur;
    const isCurrent = i === cur;
    const cls = isDone ? 'done' : (isCurrent ? 'current' : '');
    const num = isDone ? '<i data-lucide="check" style="width:10px;height:10px"></i>' : String(i + 1);

    return `
      ${i > 0 ? '<div class="status-step-line"></div>' : ''}
      <div class="status-step ${cls}">
        <div class="status-step-dot">${num}</div>
        <span class="status-step-label text-xs">${step.label}</span>
      </div>
    `;
  }).join('');
}

export function renderIssueDetail(container, issueId) {
  if (!hasData()) {
    container.innerHTML = `
      <div class="empty-state" style="min-height:60vh">
        <i data-lucide="triangle-alert" style="width:52px;height:52px;color:var(--text-muted)"></i>
        <div class="empty-state-title">Нет данных</div>
        <div class="empty-state-text">Загрузите CSV-файлы и запустите сверку.</div>
        <a href="#upload" class="btn btn-primary mt-16">
          <i data-lucide="upload"></i> Загрузить данные
        </a>
      </div>`;
    window.App.initIcons(container);
    return;
  }

  const decodedId = decodeURIComponent(issueId);

  container.innerHTML = `
    <div class="skeleton skeleton-title" style="width:240px;margin-bottom:24px"></div>
    ${Array(4).fill('<div class="skeleton skeleton-row" style="margin-bottom:8px"></div>').join('')}`;
  container.classList.remove('page-enter');
  void container.offsetWidth;
  container.classList.add('page-enter');

  setTimeout(() => paint(container, decodedId), 120);
}

function paint(container, issueId) {
  const issue = getIssueById(issueId);

  if (!issue) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="search-x"></i>
        <div class="empty-state-title">Карточка не найдена</div>
        <div class="empty-state-text">Расхождение ${issueId} не найдено</div>
        <a href="#issues" class="btn btn-ghost mt-16">← Все расхождения</a>
      </div>`;
    window.App.initIcons(container);
    return;
  }

  const actions = STATUS_ACTIONS[issue.status] || [];
  const isClosed = issue.status === 'closed';

  container.innerHTML = `
    <!-- Header -->
    <div class="page-header">
      <div class="page-header-left">
        <div class="flex items-center gap-12 flex-wrap">
          <h1 class="page-title">${ISSUE_TYPES[issue.type] || issue.type}</h1>
          ${severityBadge(issue.severity)}
          <span class="badge badge-priority-${issue.priority}">${PRIORITY_LABELS[issue.priority] || ''}</span>
        </div>
        <p class="page-subtitle">
          Рейс <a href="#trips/${issue.tripId}" class="text-accent">${issue.tripId}</a>
          &nbsp;·&nbsp; Выявлено: ${formatDateTime(issue.detectedAt)}
          &nbsp;·&nbsp; Ответственный: ${RESPONSIBLE[issue.responsible] || issue.responsible}
        </p>
      </div>
      <a href="#issues" class="btn btn-ghost">
        <i data-lucide="arrow-left"></i> Все расхождения
      </a>
    </div>

    <div class="flex flex-col gap-16">

      <!-- Priority block -->
      <div class="card">
        <div class="card-body-sm">
          <div class="flex items-center justify-between">
            <div class="section-label" style="margin-bottom:0">Приоритет обработки</div>
            <span class="badge badge-priority-${issue.priority}">${PRIORITY_LABELS[issue.priority] || ''}</span>
          </div>
          <div class="priority-reasons">
            ${(issue.priorityReasons || []).map(r => `<div class="priority-reason-item">${r}</div>`).join('')}
          </div>
        </div>
      </div>

      <!-- ML analysis -->
      ${issue.mlProbabilities ? `
        <div class="card">
          <div class="card-header">
            <div class="flex items-center gap-8">
              <i data-lucide="brain-circuit" style="width:14px;height:14px;color:var(--accent)"></i>
              <span class="card-title">ML-анализ</span>
            </div>
            ${issue.mlOverride
              ? '<span class="badge badge-warn"><i data-lucide="zap"></i> ML override</span>'
              : '<span class="badge badge-ok"><i data-lucide="check"></i> Совпадение с правилами</span>'
            }
          </div>
          <div class="card-body">
            ${['urgent','high','normal','low'].map((cls, i) => {
              const prob  = issue.mlProbabilities[i] ?? 0;
              const pct   = Math.round(prob * 100);
              const color = ['var(--status-crit)','var(--status-warn)','var(--accent)','var(--text-muted)'][i];
              const lbl   = ['🔴 Срочно','🟠 До конца дня','🔵 Стандарт','⚪ Низкий'][i];
              return `
                <div style="margin-bottom:10px">
                  <div class="flex items-center justify-between" style="margin-bottom:4px">
                    <span class="text-xs text-secondary">${lbl}</span>
                    <span class="text-xs" style="font-weight:600;color:${color}">${pct}%</span>
                  </div>
                  <div class="progress-wrap">
                    <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
                  </div>
                </div>`;
            }).join('')}
            ${issue.mlOverride ? `
              <div class="flex items-center gap-6 text-xs mt-8" style="color:var(--status-warn)">
                <i data-lucide="brain-circuit" style="width:12px;height:12px;flex-shrink:0"></i>
                Модель определила более высокий приоритет на основе анализа похожих расхождений
              </div>` : ''}
          </div>
        </div>
      ` : ''}

      <!-- Status flow -->
      <div class="card">
        <div class="card-body-sm">
          <div class="flex items-center justify-between flex-wrap gap-16">
            <div>
              <div class="section-label">Статус</div>
              <div class="status-flow mt-8">
                ${buildStatusFlow(issue.status)}
              </div>
            </div>
            <div class="flex items-center gap-8">
              <span class="badge badge-${issue.status} text-sm" style="padding:4px 12px">
                ${ISSUE_STATUSES[issue.status]}
              </span>
            </div>
          </div>

          ${!isClosed && actions.length > 0 ? `
            <div class="divider"></div>
            <div class="action-group" id="action-buttons">
              ${actions.map(a => `
                <button class="btn ${a.cls}" data-next="${a.next}">
                  <i data-lucide="${actionIcon(a.next)}"></i> ${a.label}
                </button>
              `).join('')}
            </div>
          ` : ''}

          ${isClosed ? `
            <div class="divider"></div>
            <div class="flex items-center gap-8 text-sm text-secondary">
              <i data-lucide="check-circle" style="color:var(--status-ok)"></i>
              Карточка закрыта
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Doc vs Fact -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Документ — Факт</span>
        </div>
        <div class="card-body">
          <div class="compare-grid">
            <div class="compare-col-header">
              <i data-lucide="file-text" style="display:inline;width:12px;height:12px"></i>
              Документ (план)
            </div>
            <div class="compare-col-header">
              <i data-lucide="navigation" style="display:inline;width:12px;height:12px"></i>
              Факт
            </div>

            <div class="compare-row">
              <div class="compare-cell">
                <div class="compare-cell-label">${issue.docData.label}</div>
                <div class="compare-cell-value">${issue.docData.value}</div>
              </div>
              <div class="compare-cell diff">
                <div class="compare-cell-label">${issue.factData.label}</div>
                <div class="compare-cell-value">${issue.factData.value}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Rule -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Нарушенное правило</span>
        </div>
        <div class="card-body">
          <div class="rule-block">
            <div class="rule-block-label">Правило сверки</div>
            <div class="rule-block-text">${issue.rule}</div>
          </div>
        </div>
      </div>

      <!-- History -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">История действий</span>
          <span class="badge badge-neutral">${issue.history.length} записей</span>
        </div>
        <div class="card-body">
          <div class="history-list">
            ${issue.history.map(entry => `
              <div class="history-item">
                ${historyAvatar(entry.role)}
                <div class="history-content">
                  <div class="history-meta">
                    <span class="history-role">${entry.role}</span>
                    <span class="history-time">${formatDateTime(entry.at)}</span>
                  </div>
                  <div class="history-action">${entry.action}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

    </div>
  `;

  window.App.initIcons(container);
  attachHandlers(container, issue);
}

function attachHandlers(container, issue) {
  container.querySelectorAll('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.next;
      updateIssueStatus(issue.id, next);
      window.App.updateNavBadge();
      window.App.showToast(
        `Статус изменён: «${ISSUE_STATUSES[next]}»`,
        next === 'dismissed' ? 'warn' : next === 'confirmed' || next === 'closed' ? 'success' : 'info'
      );
      paint(container, issue.id);
    });
  });
}

function actionIcon(next) {
  const map = {
    in_progress: 'play-circle',
    confirmed:   'check-circle',
    dismissed:   'x-circle',
    closed:      'archive',
  };
  return map[next] || 'arrow-right';
}
