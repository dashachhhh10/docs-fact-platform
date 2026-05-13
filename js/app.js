import { initRouter } from './router.js';
import { getOpenIssuesCount } from './data.js';
import { initML, trainModel } from './ml-classifier.js';

const THEME_KEY = 'docfact_theme';

/* ─── Theme ───────────────────────────────────────────── */
function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

function setupTheme() {
  applyTheme(getStoredTheme());

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    showToast(next === 'light' ? 'Светлая тема включена' : 'Тёмная тема включена', 'info');
  });
}

/* ─── Toast ───────────────────────────────────────────── */
const toastIcons = {
  success: 'check-circle',
  error:   'x-circle',
  warn:    'triangle-alert',
  info:    'info',
};

export function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  const icon = toastIcons[type] || 'info';

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <i data-lucide="${icon}" class="toast-icon"></i>
    <span class="toast-msg">${message}</span>
    <button class="toast-close" aria-label="Закрыть">
      <i data-lucide="x"></i>
    </button>
  `;

  el.querySelector('.toast-close').addEventListener('click', () => dismiss(el));
  container.appendChild(el);
  lucide.createIcons({ nodes: [el] });

  const timer = setTimeout(() => dismiss(el), duration);
  el._timer = timer;
}

function dismiss(el) {
  clearTimeout(el._timer);
  el.classList.add('toast-exit');
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

/* ─── Nav badge ───────────────────────────────────────── */
export function updateNavBadge() {
  const badge = document.getElementById('nav-issues-count');
  if (!badge) return;
  const count = getOpenIssuesCount();
  badge.textContent = count > 0 ? String(count) : '';
}

/* ─── Icons ───────────────────────────────────────────── */
export function initIcons(root) {
  lucide.createIcons(root ? { nodes: [root] } : undefined);
}

/* ─── Sidebar toggle (mobile) ─────────────────────────── */
function setupSidebar() {
  const toggle  = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  const close = () => sidebar.classList.remove('open');
  toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  if (overlay) overlay.addEventListener('click', close);
}

/* ─── Window.App ──────────────────────────────────────── */
window.App = { showToast, initIcons, updateNavBadge, trainModel };

/* ─── Boot ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  setupSidebar();
  initRouter();
  updateNavBadge();
  initML(); // load saved ML model in background — non-blocking
});
