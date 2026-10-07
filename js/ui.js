import { icon } from './icons.js';

export function go(path) {
  location.hash = `#${path}`;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.innerHTML = `${icon(kind === 'pr' ? 'trophy' : 'check')}<span>${esc(message)}</span>`;
  el.dataset.kind = kind;
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

// Header + Weights/Run/Body tabs shared by the three log screens.
export function logHeader({ t, dateLabel, title, active }) {
  const tabs = [['weights', '/log'], ['run', '/log/run'], ['body', '/log/body']];
  return `
    <header class="top top-bar">
      <a class="btn-round" href="#/" data-fid="back" aria-label="${t('log.back')}">${icon('chevronLeft')}</a>
      <div class="top-title"><h1 class="title">${title}</h1><p class="meta">${dateLabel}</p></div>
    </header>
    <nav class="tabs" aria-label="${t('logTabs.label')}">
      ${tabs.map(([k, href]) => `<a class="tab" href="#${href}" ${k === active ? 'aria-current="page"' : ''}>${t(`logTabs.${k}`)}</a>`).join('')}
    </nav>`;
}

// Big number with white -/+ circles (same control as the weights stepper).
export function stepperHtml({ id, label, value, unit, decLabel, incLabel, min = 0 }) {
  const str = String(value);
  return `<div class="stepper" role="group" aria-labelledby="${id}-label">
    <p id="${id}-label" class="label stepper-label">${label}</p>
    <div class="stepper-row">
      <button type="button" class="btn-round btn-step" data-step="${id}" data-d="-1" aria-label="${decLabel}" ${Number(value) <= min ? 'disabled' : ''}>${icon('minus')}</button>
      <label class="kg-field">
        <span class="sr-only">${label}</span>
        <input class="kg-input" id="${id}" name="${id}" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${str}" style="--len:${Math.max(2, str.length)}">
        <span class="unit">${unit}</span>
      </label>
      <button type="button" class="btn-round btn-step" data-step="${id}" data-d="1" aria-label="${incLabel}">${icon('plus')}</button>
    </div>
  </div>`;
}

export function parseNum(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

// Wires every [data-step] button in root to its input, with a fixed step.
export function wireSteppers(root, steps, fmt) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const input = root.querySelector(`#${b.dataset.step}`);
    const cur = parseNum(input.value) || 0;
    const next = Math.max(0, Math.round((cur + Number(b.dataset.d) * steps[b.dataset.step]) * 100) / 100);
    input.value = fmt(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector(`[data-step="${b.dataset.step}"][data-d="-1"]`).disabled = next <= 0;
  });
  root.addEventListener('input', (e) => {
    if (e.target.classList.contains('kg-input')) e.target.style.setProperty('--len', Math.max(2, e.target.value.length));
  });
}

export function fieldError(root, input, message) {
  const id = `${input.id || input.name}-err`;
  let el = root.querySelector(`#${id}`);
  if (!message) { el?.remove(); input.removeAttribute('aria-invalid'); return; }
  if (!el) {
    el = document.createElement('p');
    el.className = 'error';
    el.id = id;
    input.closest('.field, .stepper, .time-row')?.append(el);
  }
  el.innerHTML = `${icon('alert')}<span>${esc(message)}</span>`;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', id);
}
