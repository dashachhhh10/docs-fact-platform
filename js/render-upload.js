import { parseCSV, validateColumns, REQUIRED_COLUMNS } from './csv-parser.js';
import { runMatching, summarize }                      from './matching-engine.js';
import { saveDataset, saveBaseIssues, clearData }      from './data.js';
import { trainModel }                                  from './ml-classifier.js';

const ZONES = [
  {
    id:    'trips',
    file:  'trips.csv',
    label: 'Данные рейсов',
    hint:  'trip_id, route_from, route_to, planned_departure, planned_arrival, contractor, driver, vehicle',
    icon:  'truck',
  },
  {
    id:    'documents',
    file:  'documents.csv',
    label: 'Перевозочные документы',
    hint:  'doc_id, trip_id, doc_status, doc_number, cargo_name, cargo_weight_kg, cargo_places, signed_by_sender, signed_by_carrier, signed_by_receiver',
    icon:  'file-text',
  },
  {
    id:    'gps_events',
    file:  'gps_events.csv',
    label: 'GPS-события',
    hint:  'event_id, trip_id, event_type, timestamp, lat, lon, geofence_id, speed_kmh',
    icon:  'navigation',
  },
  {
    id:    'proofs',
    file:  'proofs.csv',
    label: 'Подтверждения',
    hint:  'proof_id, trip_id, stage, driver_id, timestamp, proof_type, note',
    icon:  'image',
  },
];

/* loaded[zoneId] = { file: File, name, size } */
const loaded   = {};
let isRunning  = false;
let runError   = null;

export function renderUpload(container) {
  Object.keys(loaded).forEach(k => delete loaded[k]);
  isRunning = false;
  runError  = null;

  container.classList.remove('page-enter');
  void container.offsetWidth;
  container.classList.add('page-enter');

  renderContent(container);
}

/* ─── Render ──────────────────────────────────────────── */
function renderContent(container) {
  const count    = Object.keys(loaded).length;
  const allReady = count === ZONES.length;
  const pct      = Math.round((count / ZONES.length) * 100);

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Загрузка данных</h1>
      </div>
    </div>

    ${runError ? `
      <div class="alert alert-crit mb-16" style="max-width:820px">
        <i data-lucide="x-circle"></i>
        <div class="alert-body">
          <div class="alert-title">Ошибка при запуске сверки</div>
          <div class="alert-desc">${runError}</div>
        </div>
      </div>` : ''}

    <!-- Drop zones -->
    <div class="grid-2 mb-16" style="max-width:820px">
      ${ZONES.map(z => {
        const item     = loaded[z.id];
        const isLoaded = !!item;
        return `
          <div
            class="drop-zone ${isLoaded ? 'loaded' : ''}"
            id="zone-${z.id}"
            data-zone="${z.id}"
          >
            <input type="file" accept=".csv,text/csv" data-zone="${z.id}" tabindex="-1" title="" />

            <div class="drop-zone-icon">
              <i data-lucide="${isLoaded ? 'check' : z.icon}"></i>
            </div>

            <div class="drop-zone-title">${z.file}</div>

            <div class="drop-zone-hint">
              ${isLoaded
                ? `<span class="drop-zone-file">${item.name} · ${fmtSize(item.size)}</span>`
                : `<strong>${z.label}</strong>`
              }
            </div>

            ${!isLoaded ? `<div class="drop-zone-cols">${z.hint}</div>` : ''}

            ${isLoaded ? `
              <button class="drop-zone-remove" data-remove="${z.id}" title="Удалить файл">
                <i data-lucide="x"></i>
              </button>` : ''}
          </div>
        `;
      }).join('')}
    </div>

    <!-- Progress + actions -->
    <div style="max-width:820px">
      <div class="upload-counter">
        <div class="progress-wrap" style="flex:1">
          <div class="progress-fill ${allReady ? 'progress-fill-ok' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="upload-count-text">
          <span class="upload-count-num">${count}</span> из
          <span class="upload-count-num">${ZONES.length}</span> файлов готово
        </div>
      </div>

      <div class="flex items-center gap-8 mt-8 flex-wrap">
        <button
          id="btn-run"
          class="btn ${allReady && !isRunning ? 'btn-primary' : 'btn-ghost'}"
          ${allReady && !isRunning ? '' : 'disabled'}
        >
          <i data-lucide="${isRunning ? 'loader' : 'play-circle'}"></i>
          ${isRunning ? 'Выполняется сверка...' : 'Запустить сверку'}
        </button>

        <button id="btn-reset" class="btn btn-ghost" ${count === 0 ? 'disabled' : ''}>
          <i data-lucide="rotate-ccw"></i> Сбросить
        </button>

        ${allReady && !isRunning ? `
          <span class="flex items-center gap-4 text-xs text-ok">
            <i data-lucide="check-circle" style="width:13px;height:13px"></i>
            Все файлы готовы к сверке
          </span>` : ''}
      </div>
    </div>
  `;

  window.App.initIcons(container);
  attachHandlers(container);
}

/* ─── Event handlers ──────────────────────────────────── */
function attachHandlers(container) {
  /* File input */
  container.querySelectorAll('input[type="file"]').forEach(input => {
    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      acceptFile(container, input.dataset.zone, file);
    });
  });

  /* Drag and drop */
  container.querySelectorAll('.drop-zone').forEach(zone => {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) acceptFile(container, zone.dataset.zone, file);
    });
  });

  /* Remove */
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      delete loaded[btn.dataset.remove];
      runError = null;
      renderContent(container);
    });
  });

  /* Run */
  const btnRun = container.querySelector('#btn-run');
  if (btnRun) {
    btnRun.addEventListener('click', () => {
      if (isRunning) return;
      runReconciliation(container);
    });
  }

  /* Reset */
  const btnReset = container.querySelector('#btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      Object.keys(loaded).forEach(k => delete loaded[k]);
      isRunning = false;
      runError  = null;
      clearData();
      renderContent(container);
      window.App.showToast('Данные и результаты сверки сброшены', 'info');
      window.App.updateNavBadge();
    });
  }
}

function acceptFile(container, zoneId, file) {
  loaded[zoneId] = { file, name: file.name, size: file.size };
  runError = null;
  window.App.showToast(`Файл «${file.name}» загружен`, 'success');
  renderContent(container);
}

/* ─── Reconciliation ──────────────────────────────────── */
async function runReconciliation(container) {
  isRunning = true;
  runError  = null;
  renderContent(container);

  try {
    /* Parse */
    const [trips, documents, gpsEvents, proofs] = await Promise.all([
      parseAndValidate(loaded.trips.file,      'trips.csv',      REQUIRED_COLUMNS.trips),
      parseAndValidate(loaded.documents.file,  'documents.csv',  REQUIRED_COLUMNS.documents),
      parseAndValidate(loaded.gps_events.file, 'gps_events.csv', REQUIRED_COLUMNS.gps_events),
      parseAndValidate(loaded.proofs.file,     'proofs.csv',     REQUIRED_COLUMNS.proofs),
    ]);

    /* Match */
    const issues = runMatching(trips, documents, gpsEvents, proofs);
    const stats  = summarize(issues);

    /* Persist */
    saveDataset(trips, documents, gpsEvents, proofs);
    saveBaseIssues(issues);

    /* Train ML model */
    try {
      window.App.showToast('Обучение ML-модели приоритизации...', 'info', 2500);
      const mlMeta = await trainModel();
      window.App.showToast(
        `🧠 ML-модель обучена · точность ${Math.round(mlMeta.accuracy * 100)}%`,
        'success', 4000
      );
    } catch (mlErr) {
      console.warn('ML training failed:', mlErr);
    }

    isRunning = false;

    window.App.updateNavBadge();
    window.App.showToast(
      `Сверка завершена: ${stats.total} расхождений` +
      (stats.crit > 0 ? ` (${stats.crit} крит.)` : '') +
      ` по ${stats.trips} рейсам`,
      stats.crit > 0 ? 'warn' : 'success',
      5000
    );

    setTimeout(() => { window.location.hash = '#dashboard'; }, 400);

  } catch (err) {
    isRunning = false;
    runError  = err.message;
    renderContent(container);
    window.App.showToast(`Ошибка: ${err.message}`, 'error', 6000);
  }
}

async function parseAndValidate(file, name, required) {
  const rows = await parseCSV(file);
  validateColumns(rows, required, name);
  return rows;
}

/* ─── Helpers ─────────────────────────────────────────── */
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
