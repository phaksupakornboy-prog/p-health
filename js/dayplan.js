// The day sheet (plan one day, see what was logged, log it late) and the weekly goal
// sheet. Shared by Home and the month calendar.
import { t, tc, dateFmt, num } from './i18n.js';
import { icon } from './icons.js';
import { esc, toast, parseNum } from './ui.js';
import {
  today, iso, fromIso, weekStart, planFor, setPlan, getWeek, getWeekGoal, setWeekGoal,
  getWorkoutOn, getRunOn, getBodyOn,
} from './store.js';

function sheet(id) {
  let dlg = document.getElementById(id);
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = id;
    dlg.className = 'sheet';
    dlg.setAttribute('aria-labelledby', `${id}-title`);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
  }
  return dlg;
}

// A finished week is a record: short shows red with the gap, met or over shows green.
export function weekResult(wk) {
  if (wk.gapKm > 0.05) return `<span class="result result-short">${icon('alert')}<span>${t('plan.resultShort', { km: num(wk.gapKm) })}</span></span>`;
  if (wk.gapKm < -0.05) return `<span class="result result-met">${icon('check')}<span>${t('plan.resultOver', { km: num(-wk.gapKm) })}</span></span>`;
  return `<span class="result result-met">${icon('check')}<span>${t('plan.resultMet')}</span></span>`;
}

export async function openDaySheet(isoDate, { onSaved } = {}) {
  const day = fromIso(isoDate);
  const todayIso = iso(today());
  const canLog = isoDate <= todayIso;
  const [p, week, workout, run, body] = await Promise.all([
    planFor(isoDate), getWeek(day), getWorkoutOn(isoDate), getRunOn(isoDate), getBodyOn(isoDate),
  ]);
  const row = week.find((d) => d.iso === isoDate);
  const autoKm = row.runTargetKm || week.goal.runGoalKm / Math.max(1, week.runsPlanned + (p.run ? 0 : 1));
  const q = isoDate === todayIso ? '' : `?d=${isoDate}`;
  const dlg = sheet('day-sheet');

  const logged = canLog ? `
    <div class="day-logged">
      <h3 class="label section-label">${t('plan.logged')}</h3>
      <ul class="logged-list">
        <li>${workout ? icon('check') : icon('minus')}<span>${workout ? `${t(`category.${workout.type}`)}: ${tc('home.machines', workout.machines)}, ${tc('home.sets', workout.sets)}` : t('plan.noWeights')}</span>
          <a class="btn btn-outline btn-compact" href="#/log${q}">${workout ? t('plan.edit') : t('plan.logWeights')}</a></li>
        <li>${run ? icon('check') : icon('minus')}<span>${run ? t('plan.ran', { km: num(run.distanceKm) }) : t('plan.noRun')}</span>
          <a class="btn btn-outline btn-compact" href="#/log/run${q}">${run ? t('plan.edit') : t('plan.logRun')}</a></li>
        <li>${body ? icon('check') : icon('minus')}<span>${body ? t('plan.weighed', { kg: num(body.weightKg) }) : t('plan.noBody')}</span>
          <a class="btn btn-outline btn-compact" href="#/log/body${q}">${body ? t('plan.edit') : t('plan.weighIn')}</a></li>
      </ul>
    </div>` : '';

  dlg.innerHTML = `<form class="sheet-body" method="dialog" novalidate>
    <div class="sheet-head">
      <div>
        <h2 id="day-sheet-title" class="title">${dateFmt.long(day)}</h2>
        <p class="meta">${isoDate === todayIso ? t('home.dayToday') : p.custom ? t('plan.changed') : t('plan.usual')}</p>
      </div>
      <button type="button" class="btn-round" data-close aria-label="${t('picker.close')}">${icon('x')}</button>
    </div>

    <fieldset class="field">
      <legend class="label">${t('plan.weights')}</legend>
      <div class="segmented seg-3">
        ${[['', 'plan.none'], ['upper', 'category.upper'], ['lower', 'category.lower']].map(([v, k]) => `
          <label class="seg ${v ? `seg-${v}` : 'seg-none'}"><input type="radio" name="weights" value="${v}" ${(p.weights || '') === v ? 'checked' : ''}>${v ? `<span class="dot dot-${v}" aria-hidden="true"></span>` : ''}${t(k)}</label>`).join('')}
      </div>
    </fieldset>

    <div class="field run-field">
      <div class="switch-row">
        <span class="label" id="run-switch-label"><span class="dot dot-run" aria-hidden="true"></span>${t('plan.run')}</span>
        <button type="button" class="switch" role="switch" aria-checked="${p.run}" aria-labelledby="run-switch-label" data-run></button>
      </div>
      <label class="km-row" ${p.run ? '' : 'hidden'}>
        <span class="label">${t('plan.distance')}</span>
        <input name="km" inputmode="decimal" autocomplete="off" value="${p.runKm ?? ''}" placeholder="${t('plan.auto', { km: num(autoKm) })}" aria-describedby="km-hint">
        <span class="meta" id="km-hint">${t('plan.autoHint', { goal: num(week.goal.runGoalKm) })}</span>
      </label>
    </div>

    <label class="field">
      <span class="label">${t('log.note')}</span>
      <input name="note" autocomplete="off" value="${esc(p.custom ? p.note : '')}" placeholder="${t('plan.notePlaceholder')}">
    </label>

    <div class="sheet-actions">
      ${p.custom ? `<button type="button" class="btn btn-outline" data-reset>${t('plan.useUsual')}</button>` : `<button type="button" class="btn btn-outline" data-close>${t('machinesScreen.cancel')}</button>`}
      <button type="submit" class="btn btn-primary">${t('plan.save')}</button>
    </div>
    ${logged}
  </form>`;

  const form = dlg.querySelector('form');
  const sw = form.querySelector('[data-run]');
  sw.addEventListener('click', () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    form.querySelector('.km-row').hidden = !on;
  });
  form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  form.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => dlg.close()));
  form.querySelector('[data-reset]')?.addEventListener('click', async () => {
    await setPlan(isoDate, null);
    dlg.close();
    toast(t('plan.resetDone'));
    onSaved?.();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const km = parseNum(form.elements.km.value);
    const plan = {
      weights: form.elements.weights.value || null,
      run: sw.getAttribute('aria-checked') === 'true',
      runKm: km > 0 ? km : null,
      note: form.elements.note.value.trim(),
    };
    await setPlan(isoDate, plan);
    dlg.close();
    toast(t('plan.saved', { day: dateFmt.weekday(day) }));
    onSaved?.();
  });
  dlg.showModal();
}

export async function openGoalSheet(anchor, { onSaved } = {}) {
  const startIso = iso(weekStart(anchor));
  const g = await getWeekGoal(startIso);
  const dlg = sheet('goal-sheet');
  dlg.innerHTML = `<form class="sheet-body" novalidate>
    <div class="sheet-head">
      <div>
        <h2 id="goal-sheet-title" class="title">${t('plan.goalTitle')}</h2>
        <p class="meta">${t('analytics.weekOf', { date: dateFmt.short(fromIso(startIso)) })}</p>
      </div>
      <button type="button" class="btn-round" data-close aria-label="${t('picker.close')}">${icon('x')}</button>
    </div>
    <div class="pair-fields">
      <label class="field"><span class="label">${t('plan.goalRun')}</span>
        <input name="run" inputmode="decimal" autocomplete="off" value="${g.runGoalKm}"></label>
      <label class="field"><span class="label">${t('plan.goalWeights')}</span>
        <input name="weights" inputmode="numeric" autocomplete="off" value="${g.weightsGoal}"></label>
    </div>
    <p class="meta">${t('plan.goalHint')}</p>
    <div class="sheet-actions">
      <button type="button" class="btn btn-outline" data-close>${t('machinesScreen.cancel')}</button>
      <button type="submit" class="btn btn-primary">${t('plan.save')}</button>
    </div>
  </form>`;
  const form = dlg.querySelector('form');
  form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const run = parseNum(form.elements.run.value);
    const weights = Math.round(parseNum(form.elements.weights.value));
    if (!(run >= 0) || !(weights >= 0)) return;
    await setWeekGoal(startIso, { runGoalKm: run, weightsGoal: weights });
    dlg.close();
    toast(t('plan.goalSaved', { km: num(run), n: weights }));
    onSaved?.();
  });
  dlg.showModal();
}
