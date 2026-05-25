const LOADING_STEPS = [
  { until: 0.12, label: 'Initializing renderer…' },
  { until: 0.38, label: 'Loading HDR sky…' },
  { until: 0.92, label: 'Loading F-22 Raptor model…' },
  { until: 1, label: 'Preparing systems…' },
];

let screen;
let bar;
let statusEl;
let pctEl;

function stepLabel(progress) {
  for (const step of LOADING_STEPS) {
    if (progress <= step.until) return step.label;
  }
  return LOADING_STEPS[LOADING_STEPS.length - 1].label;
}

export function initLoadingUI() {
  screen = document.getElementById('loading-screen');
  bar = document.getElementById('load-progress-bar');
  statusEl = document.getElementById('load-status');
  pctEl = document.getElementById('load-percent');
}

export function setLoadProgress(progress, label) {
  const t = Math.max(0, Math.min(1, progress));
  if (bar) bar.style.width = `${(t * 100).toFixed(1)}%`;
  if (pctEl) pctEl.textContent = `${Math.round(t * 100)}%`;
  if (statusEl) statusEl.textContent = label || stepLabel(t);
}

export function hideLoading() {
  if (!screen) return;
  screen.classList.add('is-done');
  document.body.classList.add('app-ready');
  window.setTimeout(() => {
    screen.classList.add('is-hidden');
    screen.setAttribute('aria-hidden', 'true');
  }, 520);
}

export function failLoading(message) {
  if (screen) {
    screen.classList.add('is-hidden');
    screen.setAttribute('aria-hidden', 'true');
  }
  const el = document.getElementById('load-error');
  const detail = document.getElementById('load-error-detail');
  if (el) el.classList.add('visible');
  if (detail && message) detail.textContent = message;
}
