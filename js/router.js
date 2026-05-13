import { renderDashboard }   from './render-dashboard.js';
import { renderTrips }       from './render-trips.js';
import { renderTripDetail }  from './render-trip-detail.js';
import { renderIssues }      from './render-issues.js';
import { renderIssueDetail } from './render-issue-detail.js';
import { renderUpload }      from './render-upload.js';
import { getIssueById, ISSUE_TYPES } from './data.js';

const ROUTE_META = {
  dashboard: { label: 'Дашборд',        route: 'dashboard' },
  trips:     { label: 'Рейсы',          route: 'trips' },
  issues:    { label: 'Расхождения',     route: 'issues' },
  upload:    { label: 'Загрузка данных', route: 'upload' },
};

function parseHash() {
  const raw = window.location.hash.replace('#', '').trim() || 'dashboard';
  const [section, param] = raw.split('/');
  return { section: section || 'dashboard', param: param || null };
}

function getContent() {
  return document.getElementById('page-content');
}

function setBreadcrumb(items) {
  const el = document.getElementById('breadcrumb');
  if (!el) return;
  el.innerHTML = items.map((item, i) => {
    const isLast = i === items.length - 1;
    if (isLast) return `<span class="breadcrumb-item active">${item.label}</span>`;
    return `
      <a href="#${item.href}" class="breadcrumb-item breadcrumb-link">${item.label}</a>
      <span class="breadcrumb-sep">/</span>
    `;
  }).join('');
}

function setActiveNav(section) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === section);
  });
}

function dispatch({ section, param }) {
  setActiveNav(section);

  if (section === 'dashboard') {
    setBreadcrumb([{ label: 'Дашборд' }]);
    renderDashboard(getContent());
    return;
  }

  if (section === 'trips' && !param) {
    setBreadcrumb([{ label: 'Рейсы' }]);
    renderTrips(getContent());
    return;
  }

  if (section === 'trips' && param) {
    setBreadcrumb([
      { label: 'Рейсы', href: 'trips' },
      { label: param },
    ]);
    renderTripDetail(getContent(), param);
    return;
  }

  if (section === 'issues' && !param) {
    setBreadcrumb([{ label: 'Расхождения' }]);
    renderIssues(getContent());
    return;
  }

  if (section === 'issues' && param) {
    const decoded = decodeURIComponent(param);
    const issue   = getIssueById(decoded);
    const crumbLabel = issue
      ? `${ISSUE_TYPES[issue.type] || decoded} · ${decoded}`
      : decoded;
    setBreadcrumb([
      { label: 'Расхождения', href: 'issues' },
      { label: crumbLabel },
    ]);
    renderIssueDetail(getContent(), param);
    return;
  }

  if (section === 'upload') {
    setBreadcrumb([{ label: 'Загрузка данных' }]);
    renderUpload(getContent());
    return;
  }

  window.location.hash = '#dashboard';
}

export function navigate(hash) {
  window.location.hash = hash;
}

export function initRouter() {
  window.addEventListener('hashchange', () => dispatch(parseHash()));
  dispatch(parseHash());
}
