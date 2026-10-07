import { t, dateFmt, num } from '../i18n.js';
import { icon } from '../icons.js';
import { go, toast, esc, logHeader, stepperHtml, wireSteppers, parseNum, fieldError } from '../ui.js';
import { today, iso, fromIso, getSettings, getWeek, getRunOn, getRuns, saveRun } from '../store.js';

const DIST_STEP = 0.5;

export function paceText(distanceKm, durationMin) {
  if (!(distanceKm > 0) || !(durationMin > 0)) return '';
  const secPerKm = Math.round((durationMin * 60) / distanceKm);
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')}`;
}

export async function renderRun(el) {
  const now = today();
  const date = iso(now);
  const [settings, week, existing, runs] = await Promise.all([getSettings(), getWeek(now), getRunOn(date), getRuns()]);
  const prev = [...runs].reverse().find((r) => r.date < date);
  const weekOther = week.filter((d) => d.iso !== date).reduce((s, d) => s + d.runKm, 0);
  const goal = settings.runGoalKm;
  const start = existing || { distanceKm: settings.runPerSessionKm, durationMin: null, speedKmh: null, incline: null, note: '' };
  const mins = start.durationMin ? Math.floor(start.durationMin) : '';
  const secs = start.durationMin ? Math.round((start.durationMin % 1) * 60) : '';

  el.innerHTML = `
  <form class="screen log run" novalidate>
    ${logHeader({ t, dateLabel: dateFmt.long(now), title: t('run.title'), active: 'run' })}

    <section class="card current textured glow-run" aria-label="${t('run.title')}">
      ${stepperHtml({ id: 'dist', label: t('run.distance'), value: num(start.distanceKm, 2), unit: t('run.km'), decLabel: t('run.decDist', { step: num(DIST_STEP) }), incLabel: t('run.incDist', { step: num(DIST_STEP) }) })}

      <fieldset class="field time-row">
        <legend class="label">${t('run.time')}</legend>
        <div class="time-inputs">
          <label class="time-box"><span class="sr-only">${t('run.minLabel')}</span>
            <input id="min" name="min" inputmode="numeric" autocomplete="off" value="${mins}"><span class="unit">${t('run.min')}</span></label>
          <span class="time-sep" aria-hidden="true">:</span>
          <label class="time-box"><span class="sr-only">${t('run.secLabel')}</span>
            <input id="sec" name="sec" inputmode="numeric" autocomplete="off" value="${secs === '' ? '' : String(secs).padStart(2, '0')}"><span class="unit">${t('run.sec')}</span></label>
        </div>
      </fieldset>

      ${prev && !existing ? `<button type="button" class="btn btn-outline btn-compact same-run" data-same>${icon('repeat')}<span>${t('run.sameAsLast')}</span></button>` : ''}
      <div class="pace" aria-live="polite">
        <p class="label">${t('run.pace')}</p>
        <p class="pace-val" id="pace"></p>
      </div>
    </section>

    <details class="card disclosure" ${start.speedKmh || start.incline ? 'open' : ''}>
      <summary class="label">${t('run.moreDetails')} <span class="meta">(${t('run.optional')})</span>${icon('chevronRight', 'chev')}</summary>
      <div class="pair-fields">
        <label class="field"><span class="label">${t('run.speed')} (${t('run.speedUnit')})</span>
          <input name="speed" inputmode="decimal" autocomplete="off" value="${start.speedKmh ?? ''}"></label>
        <label class="field"><span class="label">${t('run.incline')} (${t('run.inclineUnit')})</span>
          <input name="incline" inputmode="decimal" autocomplete="off" value="${start.incline ?? ''}"></label>
      </div>
    </details>

    <section class="card week-progress" aria-labelledby="wk-title">
      <div class="card-head">
        <h2 id="wk-title" class="label">${t('run.week')}</h2>
        <p class="meta" id="wk-val"></p>
      </div>
      <div class="bar" role="progressbar" aria-labelledby="wk-title" aria-valuemin="0" aria-valuemax="${goal}" id="wk-bar">
        <span class="bar-fill" id="wk-fill"></span>
      </div>
    </section>

    <label class="field day-note">
      <span class="label">${icon('note')}${t('run.note')}</span>
      <textarea name="note" rows="2" placeholder="${t('run.notePlaceholder')}">${esc(start.note || '')}</textarea>
    </label>

    <div class="finish">
      ${existing ? `<p class="meta">${t('run.todaySaved')}</p>` : ''}
      <button class="btn btn-primary btn-block btn-tall" type="submit">${icon('check')}<span>${t('run.save')}</span></button>
      ${prev ? `<p class="meta finish-note">${t('run.last', { date: dateFmt.short(fromIso(prev.date)), km: num(prev.distanceKm), pace: paceText(prev.distanceKm, prev.durationMin) })}</p>` : ''}
    </div>
  </form>`;

  const form = el.querySelector('form');
  const f = form.elements;
  const read = () => {
    const distanceKm = parseNum(f.dist.value);
    const m = parseNum(f.min.value || '0'), s = parseNum(f.sec.value || '0');
    const durationMin = (Number.isFinite(m) ? m : 0) + (Number.isFinite(s) ? s : 0) / 60;
    return { distanceKm, durationMin };
  };
  const update = () => {
    const { distanceKm, durationMin } = read();
    const p = paceText(distanceKm, durationMin);
    el.querySelector('#pace').innerHTML = p ? `${p}<span class="unit">/${t('run.km')}</span>` : `<span class="meta">${t('run.paceEmpty')}</span>`;
    const km = weekOther + (distanceKm > 0 ? distanceKm : 0);
    el.querySelector('#wk-val').textContent = t('run.weekValue', { km: num(km), goal });
    el.querySelector('#wk-fill').style.inlineSize = `${Math.min(100, (km / goal) * 100)}%`;
    el.querySelector('#wk-bar').setAttribute('aria-valuenow', String(+km.toFixed(2)));
  };
  wireSteppers(form, { dist: DIST_STEP }, (n) => num(n, 2));
  form.querySelector('[data-same]')?.addEventListener('click', (e) => {
    f.dist.value = num(prev.distanceKm, 2);
    f.min.value = Math.floor(prev.durationMin);
    f.sec.value = String(Math.round((prev.durationMin % 1) * 60)).padStart(2, '0');
    fieldError(form, f.min, '');
    f.sec.removeAttribute('aria-invalid');
    update();
    e.currentTarget.remove();
  });
  form.addEventListener('input', update);
  update();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { distanceKm, durationMin } = read();
    fieldError(form, f.dist, distanceKm > 0 ? '' : t('run.errDistance'));
    fieldError(form, f.min, durationMin > 0 ? '' : t('run.errTime'));
    if (durationMin > 0) { f.sec.removeAttribute('aria-invalid'); f.sec.removeAttribute('aria-describedby'); }
    else { f.sec.setAttribute('aria-invalid', 'true'); f.sec.setAttribute('aria-describedby', 'min-err'); }
    if (!(distanceKm > 0)) { f.dist.focus(); return; }
    if (!(durationMin > 0)) { f.min.focus(); return; }
    const speed = parseNum(f.speed.value), incline = parseNum(f.incline.value);
    await saveRun({ date, distanceKm, durationMin: +durationMin.toFixed(2), speedKmh: Number.isFinite(speed) ? speed : null, incline: Number.isFinite(incline) ? incline : null, note: f.note.value.trim() });
    const left = goal - (weekOther + distanceKm);
    toast(t('run.saved', { km: num(distanceKm), pace: paceText(distanceKm, durationMin), rest: left > 0 ? t('run.leftAfter', { km: num(left) }) : t('run.goalMet') }));
    go('/');
  });
}
