import { t, tc } from '../i18n.js';
import { icon } from '../icons.js';
import { toast, esc, fieldError } from '../ui.js';
import { connection, setConnection, fetchAll, pendingCount, flush, onSync } from '../remote.js';
import { dataMode } from '../store.js';

function status() {
  if (dataMode() !== 'sheets') return `<p class="status">${icon('cloud')}<span>${t('settings.statusMock')}</span></p>`;
  const n = pendingCount();
  return `<p class="status status-ok">${icon('check')}<span>${t('settings.statusOk')}</span></p>
    ${n ? `<p class="status">${icon('alert')}<span>${tc('settings.statusPending', n)}</span></p>
      <button type="button" class="btn btn-outline btn-compact" data-sync>${icon('repeat')}<span>${t('settings.syncNow')}</span></button>` : ''}`;
}

export async function renderSettings(el) {
  const conn = connection() || { url: '', token: '' };
  el.innerHTML = `
  <form class="screen log settings" novalidate>
    <header class="top top-bar">
      <a class="btn-round" href="#/" aria-label="${t('settings.back')}">${icon('chevronLeft')}</a>
      <div class="top-title"><h1 class="title">${t('settings.title')}</h1></div>
    </header>

    <section class="card" aria-labelledby="s-sheets">
      <h2 id="s-sheets" class="label">${t('settings.sheets')}</h2>
      <div class="status-box" aria-live="polite">${status()}</div>
      <label class="field">
        <span class="label">${t('settings.url')}</span>
        <input id="url" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="${t('settings.urlPlaceholder')}" value="${esc(conn.url)}">
      </label>
      <label class="field">
        <span class="label">${t('settings.token')}</span>
        <input id="token" name="token" type="password" autocomplete="off" spellcheck="false" value="${esc(conn.token)}" aria-describedby="token-hint">
        <span class="meta" id="token-hint">${t('settings.tokenHint')}</span>
      </label>
      ${dataMode() === 'sheets' ? '' : `<p class="meta">${t('settings.sampleNote')}</p>`}
      ${dataMode() === 'sheets'
        ? `<div class="sheet-actions"><button type="button" class="btn btn-outline" data-disconnect>${t('settings.disconnect')}</button><button type="submit" class="btn btn-primary">${t('settings.update')}</button></div>`
        : `<button type="submit" class="btn btn-primary btn-block">${t('settings.connect')}</button>`}
    </section>
  </form>`;

  const form = el.querySelector('form');
  const box = el.querySelector('.status-box');
  const off = onSync(() => { if (document.body.contains(box)) box.innerHTML = status(); else off(); });

  form.addEventListener('click', async (e) => {
    if (e.target.closest('[data-sync]')) { await flush(); box.innerHTML = status(); }
    if (e.target.closest('[data-disconnect]')) {
      setConnection(null);
      toast(t('settings.disconnected'));
      setTimeout(() => location.reload(), 600);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = form.elements.url.value.trim();
    const token = form.elements.token.value.trim();
    const okUrl = /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(url);
    fieldError(form, form.elements.url, okUrl ? '' : t('settings.errUrl'));
    fieldError(form, form.elements.token, token ? '' : t('settings.errToken'));
    if (!okUrl) { form.elements.url.focus(); return; }
    if (!token) { form.elements.token.focus(); return; }
    const btn = form.querySelector('[type="submit"]');
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${t('settings.connecting')}</span>`;
    try {
      const data = await fetchAll({ url, token });
      setConnection({ url, token });
      toast(t('settings.connected', { machines: data.machines.length }));
      setTimeout(() => { location.hash = '#/'; location.reload(); }, 900);
    } catch (err) {
      btn.removeAttribute('aria-busy');
      btn.textContent = t('settings.connect');
      fieldError(form, form.elements.token, t('settings.errConnect', { error: String(err.message || err) }));
    }
  });
}
