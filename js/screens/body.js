import { t, dateFmt, num } from '../i18n.js';
import { icon } from '../icons.js';
import { go, toast, esc, logHeader, stepperHtml, wireSteppers, parseNum, fieldError } from '../ui.js';
import { today, iso, fromIso, getBodyOn, getBodySeries, saveBody } from '../store.js';

const STEP = 0.1;

export async function renderBody(el) {
  const now = today();
  const date = iso(now);
  const [existing, series] = await Promise.all([getBodyOn(date), getBodySeries()]);
  const prev = [...series].reverse().find((b) => b.date < date);
  const start = existing || { weightKg: prev ? prev.weightKg : 70, waistCm: null, note: '' };

  el.innerHTML = `
  <form class="screen log body-log" novalidate>
    ${logHeader({ t, dateLabel: dateFmt.long(now), title: t('body.title'), active: 'body' })}

    <section class="card current textured glow-rest" aria-label="${t('body.weight')}">
      ${stepperHtml({ id: 'kg', label: t('body.weight'), value: num(start.weightKg, 1), unit: t('body.kg'), decLabel: t('body.dec', { step: num(STEP) }), incLabel: t('body.inc', { step: num(STEP) }) })}
      <p class="meta hint-center">${t('body.hint')}</p>
      ${prev ? `<p class="last-line center">${t('body.last', { date: dateFmt.short(fromIso(prev.date)), kg: num(prev.weightKg) })}</p>` : ''}
    </section>

    <label class="field day-note">
      <span class="label">${t('body.waist')} (${t('body.cm')}) <span class="meta">${t('body.optional')}</span></span>
      <input name="waist" inputmode="decimal" autocomplete="off" placeholder="${t('body.waistPlaceholder')}" value="${start.waistCm ?? ''}">
    </label>

    <label class="field day-note">
      <span class="label">${icon('note')}${t('body.note')}</span>
      <textarea name="note" rows="2" placeholder="${t('body.notePlaceholder')}">${esc(start.note || '')}</textarea>
    </label>

    <div class="finish">
      ${existing ? `<p class="meta">${t('body.todaySaved')}</p>` : ''}
      <button class="btn btn-primary btn-block btn-tall" type="submit">${icon('check')}<span>${t('body.save')}</span></button>
    </div>
  </form>`;

  const form = el.querySelector('form');
  wireSteppers(form, { kg: STEP }, (n) => num(n, 1));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kg = parseNum(form.elements.kg.value);
    const ok = kg > 20 && kg < 400;
    fieldError(form, form.elements.kg, ok ? '' : t('body.err'));
    if (!ok) { form.elements.kg.focus(); return; }
    const waist = parseNum(form.elements.waist.value);
    await saveBody({ date, weightKg: +kg.toFixed(1), waistCm: Number.isFinite(waist) ? waist : null, note: form.elements.note.value.trim() });
    toast(t('body.saved', { kg: num(kg) }));
    go('/');
  });
}
