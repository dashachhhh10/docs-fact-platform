import { getStats, getTrips, getIssues, hasData, ISSUE_TYPES, formatDate } from './data.js';
import { getMLStatus, trainModel } from './ml-classifier.js';

let chartBar   = null;
let chartDonut = null;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ─── Empty state ─────────────────────────────────────── */
function renderEmpty(container) {
  container.innerHTML = `
    <div class="empty-state" style="min-height:60vh">
      <i data-lucide="upload-cloud" style="width:52px;height:52px;color:var(--accent)"></i>
      <div class="empty-state-title">Данные не загружены</div>
      <div class="empty-state-text">
        Загрузите CSV-файлы рейсов, документов, GPS-событий и подтверждений,
        чтобы запустить сверку и увидеть дашборд.
      </div>
      <a href="#upload" class="btn btn-primary mt-16">
        <i data-lucide="upload"></i> Загрузить данные
      </a>
    </div>`;
  window.App.initIcons(container);
}

/* ─── Skeleton ────────────────────────────────────────── */
function skeleton() {
  return `
    <div class="page-header">
      <div class="skeleton skeleton-title" style="width:180px"></div>
      <div class="skeleton skeleton-text" style="width:200px;margin-top:8px"></div>
    </div>
    <div class="grid-4 mb-16">
      ${Array(4).fill('<div class="skeleton skeleton-kpi"></div>').join('')}
    </div>
    <div class="grid-2 mb-16">
      <div class="skeleton skeleton-chart"></div>
      <div class="skeleton skeleton-chart"></div>
    </div>
    <div class="skeleton skeleton-chart"></div>`;
}

function tripStatusBadge(status) {
  const map = {
    OK:         '<span class="badge badge-ok">OK</span>',
    HAS_ISSUES: '<span class="badge badge-warn">HAS_ISSUES</span>',
    BLOCKED:    '<span class="badge badge-crit">BLOCKED</span>',
  };
  return map[status] || '';
}

export function renderDashboard(container) {
  if (!hasData()) { renderEmpty(container); return; }

  container.innerHTML = skeleton();
  container.classList.remove('page-enter');
  void container.offsetWidth;
  container.classList.add('page-enter');

  if (chartBar)   { chartBar.destroy();   chartBar   = null; }
  if (chartDonut) { chartDonut.destroy(); chartDonut = null; }

  setTimeout(() => {
    const stats    = getStats();
    const mlStatus = getMLStatus();
    const trips    = getTrips()
      .sort((a, b) => new Date(b.plannedDeparture) - new Date(a.plannedDeparture))
      .slice(0, 5);

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1 class="page-title">Дашборд</h1>
        </div>
        <div class="flex items-center gap-8">
          <div class="ml-badge ${mlStatus.trained ? 'ml-badge-active' : 'ml-badge-inactive'}" id="ml-status-btn">
            <i data-lucide="brain-circuit" style="width:12px;height:12px"></i>
            ${mlStatus.trained ? 'ML активна' : 'ML не обучена'}
          </div>
          <span class="text-xs text-secondary">Обновлено: ${new Date().toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
        </div>
      </div>

      <!-- KPI -->
      <div class="grid-4 mb-16">
        <div class="kpi-card">
          <div class="kpi-top"><div class="kpi-icon kpi-icon-info"><i data-lucide="truck"></i></div></div>
          <div class="kpi-value">${stats.trips.total}</div>
          <div><div class="kpi-label">Всего рейсов</div><div class="kpi-delta">активные рейсы</div></div>
        </div>

        <div class="kpi-card">
          <div class="kpi-top"><div class="kpi-icon kpi-icon-ok"><i data-lucide="check-circle"></i></div></div>
          <div class="kpi-value text-ok">${stats.trips.ok}</div>
          <div><div class="kpi-label">OK</div><div class="kpi-delta">нет расхождений</div></div>
        </div>

        <div class="kpi-card">
          <div class="kpi-top"><div class="kpi-icon kpi-icon-warn"><i data-lucide="triangle-alert"></i></div></div>
          <div class="kpi-value text-warn">${stats.trips.has_issues}</div>
          <div><div class="kpi-label">HAS_ISSUES</div><div class="kpi-delta">есть предупреждения</div></div>
        </div>

        <div class="kpi-card kpi-crit">
          <div class="kpi-top"><div class="kpi-icon kpi-icon-crit"><i data-lucide="lock"></i></div></div>
          <div class="kpi-value text-crit">${stats.trips.blocked}</div>
          <div>
            <div class="kpi-label">BLOCKED</div>
            <div class="kpi-delta kpi-delta-up"><i data-lucide="alert-circle"></i> закрытие заблокировано</div>
          </div>
        </div>
      </div>

      <!-- Charts -->
      <div class="grid-2 mb-16">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Расхождения по типам</span>
            <span class="badge badge-neutral">${stats.issues.total} всего</span>
          </div>
          <div class="card-body">
            <div class="chart-wrap" style="height:220px"><canvas id="chart-bar"></canvas></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Статусы расхождений</span>
            <span class="badge badge-crit">${stats.issues.open} новых</span>
          </div>
          <div class="card-body">
            <div class="flex gap-16 items-center" style="height:220px">
              <div class="chart-wrap" style="flex:1;height:100%">
                <canvas id="chart-donut"></canvas>
              </div>
              <div style="flex-shrink:0">
                ${Object.entries(stats.issues.byStatus).map(([key, val]) => {
                  const lbl = { new:'Новое', in_progress:'В работе', confirmed:'Подтверждено', dismissed:'Снято', closed:'Закрыто' };
                  const clr = { new:'var(--accent)', in_progress:'var(--status-warn)', confirmed:'var(--status-ok)', dismissed:'var(--status-neutral)', closed:'var(--status-neutral)' };
                  return `<div class="stat-row">
                    <div class="flex items-center gap-8">
                      <span class="status-dot" style="background:${clr[key]}"></span>
                      <span class="stat-row-label">${lbl[key]}</span>
                    </div>
                    <span class="stat-row-value">${val}</span>
                  </div>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Priority summary -->
      <div class="card mb-16">
        <div class="card-header">
          <span class="card-title">Приоритет обработки</span>
        </div>
        <div class="card-body">
          <div class="grid-4">
            <div class="priority-card priority-card-urgent" onclick="window.__issueFilter={priority:'urgent'};location.hash='#issues'">
              <div class="priority-card-num">${stats.issues.byPriority.urgent || 0}</div>
              <div class="priority-card-label">🔴 Срочно</div>
            </div>
            <div class="priority-card priority-card-high" onclick="window.__issueFilter={priority:'high'};location.hash='#issues'">
              <div class="priority-card-num">${stats.issues.byPriority.high || 0}</div>
              <div class="priority-card-label">🟠 До конца дня</div>
            </div>
            <div class="priority-card priority-card-normal" onclick="window.__issueFilter={priority:'normal'};location.hash='#issues'">
              <div class="priority-card-num">${stats.issues.byPriority.normal || 0}</div>
              <div class="priority-card-label">🔵 Стандарт</div>
            </div>
            <div class="priority-card priority-card-low" onclick="window.__issueFilter={priority:'low'};location.hash='#issues'">
              <div class="priority-card-num">${stats.issues.byPriority.low || 0}</div>
              <div class="priority-card-label">⚪ Низкий</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent trips -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Последние рейсы</span>
          <a href="#trips" class="btn btn-ghost btn-sm">Все рейсы <i data-lucide="arrow-right"></i></a>
        </div>
        <div class="table-wrap" style="border:none;border-radius:0 0 var(--radius) var(--radius)">
          <table class="data-table">
            <thead>
              <tr>
                <th>Рейс</th><th>Маршрут</th><th>Статус</th>
                <th>Расхождений</th><th>Дата</th><th>Контрагент</th>
              </tr>
            </thead>
            <tbody>
              ${trips.map(t => {
                const issues    = getIssues({ tripId: t.id });
                const critOpen  = issues.filter(i => i.severity === 'CRIT' && !['confirmed','dismissed','closed'].includes(i.status)).length;
                const issueCell = issues.length === 0
                  ? '<span class="text-secondary">—</span>'
                  : critOpen > 0
                    ? `<span class="text-crit font-semi">${issues.length}</span>&nbsp;<span class="badge badge-crit">${critOpen} крит.</span>`
                    : `<span class="text-warn font-semi">${issues.length}</span>`;

                return `<tr onclick="location.hash='#trips/${t.id}'">
                  <td><span class="col-id">${t.id}</span></td>
                  <td>
                    <div style="font-size:var(--text-sm);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                      <span class="text-secondary">${t.route.from}</span>
                      <span class="text-muted"> → </span>${t.route.to}
                    </div>
                  </td>
                  <td>${tripStatusBadge(t.status)}</td>
                  <td>${issueCell}</td>
                  <td class="text-secondary text-sm">${formatDate(t.plannedDeparture)}</td>
                  <td class="text-secondary text-sm" style="white-space:nowrap">${t.contractor}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    window.App.initIcons(container);
    initCharts(stats);
    attachMLBadge(container, mlStatus);
  }, 160);
}

function initCharts(stats) {
  const textMuted = cssVar('--chart-label');
  const gridColor = cssVar('--chart-grid');
  const accent    = cssVar('--accent');
  const warn      = cssVar('--status-warn');
  const crit      = cssVar('--status-crit');
  const ok        = cssVar('--status-ok');
  const neutral   = cssVar('--status-neutral');

  Chart.defaults.font.family = 'Inter, sans-serif';
  Chart.defaults.font.size   = 12;
  Chart.defaults.color       = textMuted;

  const barCtx = document.getElementById('chart-bar');
  if (barCtx) {
    const typeKeys   = Object.keys(ISSUE_TYPES);
    const typeLabels = Object.values(ISSUE_TYPES);
    const typeValues = typeKeys.map(k => stats.issues.byType[k] || 0);
    const typeColors = [warn, crit, crit, crit, warn, warn];

    chartBar = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: typeLabels,
        datasets: [{
          data: typeValues,
          backgroundColor: typeColors.map(c => c + '99'),
          borderColor: typeColors,
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw} расхождений` } } },
        scales: {
          x: { grid: { color: gridColor }, ticks: { stepSize: 1, precision: 0 }, border: { display: false } },
          y: { grid: { display: false }, border: { display: false } },
        },
      },
    });
  }

  const donutCtx = document.getElementById('chart-donut');
  if (donutCtx) {
    const bs = stats.issues.byStatus;
    chartDonut = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Новое','В работе','Подтверждено','Снято','Закрыто'],
        datasets: [{
          data: [bs.new||0, bs.in_progress||0, bs.confirmed||0, bs.dismissed||0, bs.closed||0],
          backgroundColor: [accent, warn, ok, neutral, neutral+'80'],
          borderWidth: 0,
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.raw} карточек` } },
        },
      },
    });
  }
}

/* ─── ML badge + modal ────────────────────────────────── */
function attachMLBadge(container, mlStatus) {
  const badge = container.querySelector('#ml-status-btn');
  if (!badge) return;
  badge.addEventListener('click', () => openMLModal(mlStatus));
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function openMLModal(mlStatus) {
  document.getElementById('ml-modal')?.remove();

  const modal = document.createElement('div');
  modal.id        = 'ml-modal';
  modal.className = 'modal-overlay';

  const rows = mlStatus.trained ? [
    ['Тип модели',        'Полносвязная нейросеть (Dense)'],
    ['Архитектура',       mlStatus.architecture || '11 → Dense(16) → Dense(8) → Dense(4)'],
    ['Параметров',        String(mlStatus.numParams || 364)],
    ['Точность (train)',  mlStatus.accuracy ? `${Math.round(mlStatus.accuracy * 100)}%` : '—'],
    ['Обучающих примеров', String(mlStatus.trainingSamples || 200)],
    ['Дата обучения',     fmtDate(mlStatus.trainedAt)],
  ] : [];

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="flex items-center gap-8">
          <i data-lucide="brain-circuit" style="width:18px;height:18px;color:var(--accent)"></i>
          <span class="modal-title">ML-модель приоритизации</span>
        </div>
        <button class="btn-icon" id="ml-modal-close"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">
        ${!mlStatus.trained
          ? `<div class="empty-state" style="padding:32px 24px">
               <i data-lucide="brain-circuit" style="width:36px;height:36px;color:var(--text-muted)"></i>
               <div class="empty-state-title text-sm">Модель не обучена</div>
               <div class="empty-state-text">Загрузите данные и запустите сверку — модель обучится автоматически.</div>
             </div>`
          : rows.map(([label, value]) => `
              <div class="stat-row">
                <span class="stat-row-label">${label}</span>
                <span class="stat-row-value">${value}</span>
              </div>`).join('')
        }
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="btn-retrain" ${!mlStatus.trained ? '' : ''}>
          <i data-lucide="refresh-cw"></i> Переобучить модель
        </button>
        <button class="btn btn-ghost" id="ml-modal-close2">Закрыть</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  window.App.initIcons(modal);

  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('#ml-modal-close').addEventListener('click', close);
  modal.querySelector('#ml-modal-close2').addEventListener('click', close);

  modal.querySelector('#btn-retrain').addEventListener('click', async () => {
    const btn = modal.querySelector('#btn-retrain');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Обучение...';
    window.App.initIcons(btn);
    try {
      const meta = await trainModel();
      window.App.showToast(
        `🧠 Модель переобучена · точность ${Math.round(meta.accuracy * 100)}%`,
        'success', 4000
      );
      close();
    } catch (e) {
      window.App.showToast('Ошибка обучения: ' + e.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="refresh-cw"></i> Переобучить модель';
      window.App.initIcons(btn);
    }
  });
}
