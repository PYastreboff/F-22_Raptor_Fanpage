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
let progressBlock;

export function isPhoneDevice() {
  const ua = navigator.userAgent || '';
  const phoneUa =
    /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const narrowTouch =
    window.matchMedia('(max-width: 768px)').matches &&
    navigator.maxTouchPoints > 0 &&
    window.matchMedia('(pointer: coarse)').matches;
  return phoneUa || narrowTouch;
}

export function showDesktopOnlyScreen() {
  if (!screen) return;
  screen.classList.add('is-mobile-blocked');
  screen.setAttribute('aria-busy', 'false');

  if (progressBlock) progressBlock.hidden = true;
  if (statusEl) statusEl.textContent = 'DESKTOP REQUIRED';
  if (pctEl) pctEl.hidden = true;

  const hint = document.querySelector('.loading-hint');
  if (hint) hint.hidden = true;

  const msg = document.getElementById('load-mobile-message');
  if (msg) {
    msg.hidden = false;
    msg.textContent =
      'This experience is built for desktop. Please open Peter\'s F-22 Raptor Command on a computer.';
  }
}

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
  progressBlock = document.querySelector('.loading-bar-track');
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
