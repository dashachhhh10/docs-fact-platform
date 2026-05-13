import { getTrips, getIssues, hasData, formatDate } from './data.js';

function statusBadge(status) {
  const map = {
    OK:         '<span class="badge badge-ok"><i data-lucide="check"></i> OK</span>',
    HAS_ISSUES: '<span class="badge badge-warn"><i data-lucide="triangle-alert"></i> HAS_ISSUES</span>',
    BLOCKED:    '<span class="badge badge-crit"><i data-lucide="lock"></i> BLOCKED</span>',
  };
  return map[status] || '';
}

function docStatusBadge(s) {
  const map = {
    draft:  '<span class="badge badge-neutral">Черновик</span>',
    agreed: '<span class="badge badge-info">Согласован</span>',
    signed: '<span class="badge badge-ok">Подписан</span>',
    closed: '<span class="badge badge-neutral">Закрыт</span>',
  };
  return map[s] || `<span class="badge badge-neutral">${s || '—'}</span>`;
}

function skeleton() {
  return `
    <div class="page-header">
      <div class="skeleton skeleton-title" style="width:120px"></div>
    </div>
    <div class="skeleton" style="height:44px;margin-bottom:16px;border-radius:var(--radius-sm)"></div>
    ${Array(6).fill('<div class="skeleton skeleton-row" style="margin-bottom:8px"></div>').join('')}`;
}

function renderEmpty(container) {
  container.innerHTML = `
    <div class="empty-state" style="min-height:60vh">
      <i data-lucide="truck" style="width:52px;height:52px;color:var(--text-muted)"></i>
      <div class="empty-state-title">Нет данных о рейсах</div>
      <div class="empty-state-text">Загрузите CSV-файлы, чтобы начать работу с рейсами.</div>
      <a href="#upload" class="btn btn-primary mt-16">
        <i data-lucide="upload"></i> Загрузить данные
      </a>
    </div>`;
  window.App.initIcons(container);
}

let currentFilter = 'ALL';
let currentSearch = '';

export function renderTrips(container) {
  if (!hasData()) { renderEmpty(container); return; }

  container.innerHTML = skeleton();
  container.classList.remove('page-enter');
  void container.offsetWidth;
  container.classList.add('page-enter');
  currentFilter = 'ALL';
  currentSearch = '';

  setTimeout(() => renderContent(container), 140);
}

function renderContent(container) {
  const allTrips = getTrips();
  const filtered = getTrips({
    status: currentFilter !== 'ALL' ? currentFilter : undefined,
    search: currentSearch || undefined,
  });

  const counts = {
    ALL:        allTrips.length,
    OK:         allTrips.filter(t => t.status === 'OK').length,
    HAS_ISSUES: allTrips.filter(t => t.status === 'HAS_ISSUES').length,
    BLOCKED:    allTrips.filter(t => t.status === 'BLOCKED').length,
  };

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Рейсы</h1>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-pills">
        ${[
          { key: 'ALL',        label: 'Все' },
          { key: 'OK',         label: 'OK' },
          { key: 'HAS_ISSUES', label: 'HAS_ISSUES' },
          { key: 'BLOCKED',    label: 'BLOCKED' },
        ].map(f => `
          <button class="pill ${currentFilter === f.key ? 'active' : ''}" data-filter="${f.key}">
            ${f.label} <span class="text-muted">${counts[f.key]}</span>
          </button>
        `).join('')}
      </div>

      <div class="search-wrap">
        <i data-lucide="search"></i>
        <input
          type="search"
          class="search-input"
          id="trips-search"
          placeholder="Поиск по рейсу, маршруту, водителю..."
          value="${currentSearch}"
        />
      </div>

      ${filtered.length < allTrips.length ? `<span class="filter-count">${filtered.length} из ${allTrips.length}</span>` : ''}
    </div>

    <div id="trips-list">
      ${filtered.length === 0
        ? `<div class="empty-state">
             <i data-lucide="search-x"></i>
             <div class="empty-state-title">Рейсы не найдены</div>
             <div class="empty-state-text">Попробуйте изменить фильтры или поисковый запрос</div>
           </div>`
        : `<div class="table-wrap">
             <table class="data-table">
               <thead>
                 <tr>
                   <th>Рейс</th><th>Маршрут</th><th>Документ</th>
                   <th>Статус</th><th>Расхождений</th><th>Дата отправления</th><th>Водитель</th>
                 </tr>
               </thead>
               <tbody>
                 ${filtered.map(t => {
                   const issues   = getIssues({ tripId: t.id });
                   const critOpen = issues.filter(i =>
                     i.severity === 'CRIT' && !['confirmed','dismissed','closed'].includes(i.status)
                   ).length;
                   const issueCell = issues.length === 0
                     ? '<span class="text-secondary">—</span>'
                     : critOpen > 0
                       ? `<span class="text-crit font-semi">${issues.length}</span>&nbsp;<span class="badge badge-crit">${critOpen} крит.</span>`
                       : `<span class="text-warn font-semi">${issues.length}</span>`;

                   return `<tr onclick="location.hash='#trips/${t.id}'">
                     <td><span class="col-id">${t.id}</span></td>
                     <td>
                       <div class="text-sm" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                         <span class="text-secondary">${t.route.from}</span>
                         <span class="text-muted"> → </span>${t.route.to}
                       </div>
                     </td>
                     <td>
                       <div class="text-xs font-medium">${t.docId}</div>
                       <div class="mt-4">${docStatusBadge(t.docStatus)}</div>
                     </td>
                     <td>${statusBadge(t.status)}</td>
                     <td>${issueCell}</td>
                     <td class="text-sm text-secondary">${formatDate(t.plannedDeparture)}</td>
                     <td class="text-sm text-secondary">${t.driver}</td>
                   </tr>`;
                 }).join('')}
               </tbody>
             </table>
           </div>`
      }
    </div>
  `;

  window.App.initIcons(container);
  attachHandlers(container);
}

function attachHandlers(container) {
  container.querySelectorAll('.pill[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      renderContent(container);
    });
  });

  const search = container.querySelector('#trips-search');
  if (search) {
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        currentSearch = search.value.trim();
        renderContent(container);
      }, 220);
    });
    search.focus();
  }
}
