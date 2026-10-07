import { t, tc } from '../i18n.js';
import { icon } from '../icons.js';
import { toast, esc, fieldError } from '../ui.js';
import { connection, setConnection, fetchAll, pendingCount, flush, onSync } from '../remote.js';
import { dataMode, getSettings, saveSettings, parseSlot, slotOf, weekStart, today, addDays } from '../store.js';
import { dateFmt, num } from '../i18n.js';
import { parseNum } from '../ui.js';

function status() {
  if (dataMode() !== 'sheets') return `<p class="status">${icon('cloud')}<span>${t('settings.statusMock')}</span></p>`;
  const n = pendingCount();
  return `<p class="status status-ok">${icon('check')}<span>${t('settings.statusOk')}</span></p>
    ${n ? `<p class="status">${icon('alert')}<span>${tc('settings.statusPending', n)}</span></p>
      <button type="button" class="btn btn-outline btn-compact" data-sync>${icon('repeat')}<span>${t('settings.syncNow')}</span></button>` : ''}`;
}

function weekCard(st) {
  const mon = weekStart(today());
  const rows = (st.weekTemplate || []).map((slot, i) => {
    const p = parseSlot(slot);
    const day = dateFmt.weekday(addDays(mon, i));
    return `<li class="tpl-row">
      <span class="tpl-day" aria-hidden="true">${dateFmt.weekdayShort(addDays(mon, i))}</span>
      <span class="tpl-weights" role="radiogroup" aria-label="${t('plan.weights')}, ${day}">
        ${[['', 'plan.none'], ['upper', 'category.upper'], ['lower', 'category.lower']].map(([v, k]) => `<label class="seg seg-${v || 'none'} seg-mini"><input type="radio" name="w${i}" value="${v}" ${(p.weights || '') === v ? 'checked' : ''}>${t(k)}</label>`).join('')}
      </span>
      <button type="button" class="switch" role="switch" aria-checked="${p.run}" aria-label="${t('plan.run')}, ${day}" data-tpl-run="${i}"></button>
    </li>`;
  }).join('');
  return `<form class="card week-form" novalidate aria-labelledby="s-week">
    <h2 id="s-week" class="label">${t('settings.usualWeek')}</h2>
    <p class="meta">${t('settings.usualWeekHint')}</p>
    <div class="tpl-head meta" aria-hidden="true"><span></span><span>${t('plan.weights')}</span><span>${t('plan.run')}</span></div>
    <ol class="tpl">${rows}</ol>
    <div class="pair-fields">
      <label class="field"><span class="label">${t('plan.goalRun')}</span><input name="runGoal" inputmode="decimal" value="${num(st.runGoalKm)}"></label>
      <label class="field"><span class="label">${t('plan.goalWeights')}</span><input name="weightsGoal" inputmode="numeric" value="${st.weightsGoal}"></label>
      <label class="field"><span class="label">${t('settings.sets')}</span><input name="sets" inputmode="numeric" value="${st.defaultSets}"></label>
      <label class="field"><span class="label">${t('settings.reps')}</span><input name="reps" inputmode="numeric" value="${st.defaultReps}"></label>
      <label class="field"><span class="label">${t('settings.step')}</span><input name="step" inputmode="decimal" value="${num(st.weightStepKg)}"></label>
      <label class="field"><span class="label">${t('settings.target')}</span><input name="target" inputmode="decimal" value="${st.targetWeightKg ?? ''}"></label>
    </div>
    <button type="submit" class="btn btn-primary btn-block">${t('settings.saveWeek')}</button>
  </form>`;
}

export async function renderSettings(el) {
  const conn = connection() || { url: '', token: '' };
  const st = await getSettings();
  el.innerHTML = `
  <div class="screen log settings">
    <header class="top top-bar">
      <a class="btn-round" href="#/" aria-label="${t('settings.back')}">${icon('chevronLeft')}</a>
      <div class="top-title"><h1 class="title">${t('settings.title')}</h1></div>
    </header>
  <form class="conn-form" novalidate>

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
  </form>
  ${weekCard(st)}
  </div>`;

  const wf = el.querySelector('.week-form');
  wf.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-tpl-run]');
    if (sw) sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true'));
  });
  wf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = wf.elements;
    const weekTemplate = Array.from({ length: 7 }, (_, i) => slotOf({
      weights: wf.querySelector(`input[name="w${i}"]:checked`)?.value || null,
      run: wf.querySelector(`[data-tpl-run="${i}"]`).getAttribute('aria-checked') === 'true',
    }));
    const pos = (v, fallback) => { const x = parseNum(v); return x > 0 ? x : fallback; };
    const target = parseNum(f.target.value);
    await saveSettings({
      weekTemplate,
      runGoalKm: pos(f.runGoal.value, st.runGoalKm), weightsGoal: Math.round(pos(f.weightsGoal.value, st.weightsGoal)),
      defaultSets: Math.round(pos(f.sets.value, st.defaultSets)), defaultReps: Math.round(pos(f.reps.value, st.defaultReps)),
      weightStepKg: pos(f.step.value, st.weightStepKg), targetWeightKg: target > 0 ? target : null,
    });
    toast(t('settings.weekSaved'));
  });

  const form = el.querySelector('.conn-form');
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
