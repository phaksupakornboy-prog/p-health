import { t, dateFmt, num } from '../i18n.js';
import { icon } from '../icons.js';
import { toast } from '../ui.js';
import { today, iso, addDays, weekStart, getWeek, copyWeek, resetRange } from '../store.js';
import { openDaySheet, weekResult } from '../dayplan.js';
import { dayMarks, dayLabel } from './home.js';

let monthOffset = 0;

export async function renderPlan(el) {
  const now = today();
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1, 12);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  const monthName = new Intl.DateTimeFormat(document.documentElement.lang, { month: 'long', year: 'numeric' }).format(first);

  // whole Monday-first weeks that touch this month
  const weeks = [];
  for (let w = weekStart(first); w <= last; w = addDays(w, 7)) weeks.push(await getWeek(w));
  const inMonth = (d) => d.date.getMonth() === first.getMonth();

  const grid = weeks.map((wk) => wk.map((d) => {
    const marks = dayMarks(d);
    return `<li><button type="button" class="cal-day ${inMonth(d) ? '' : 'is-out'} ${d.isToday ? 'is-today' : ''} ${d.plan.custom ? 'is-custom' : ''} ${d.past ? 'is-past' : ''}"
      data-day="${d.iso}" aria-haspopup="dialog">
      <span class="sr-only">${dayLabel(d)}</span>
      <span class="cal-num" aria-hidden="true">${dateFmt.day(d.date)}</span>
      <span class="day-marks" aria-hidden="true">${marks.map((x) => `<span class="mark mark-${x.cat} ${x.done ? 'is-done' : ''}"></span>`).join('')}</span>
      ${d.plan.runKm && !d.runKm ? `<span class="cal-km" aria-hidden="true">${num(d.plan.runKm)}</span>` : ''}
    </button></li>`;
  }).join('')).join('');

  const weekRows = weeks.map((wk) => {
    const short = wk.goal.runGoalKm - wk.plannedKm;
    return `<li class="week-row">
      <span class="week-row-date">${t('plan.weekRow', { date: dateFmt.short(wk[0].date) })}</span>
      ${wk.ended
        ? `<span class="meta">${t('plan.weekDone', { km: num(wk.doneKm), goal: num(wk.goal.runGoalKm), n: wk.weightsDone, g: wk.goal.weightsGoal })}</span>${weekResult(wk)}`
        : `<span class="meta">${t('plan.weekPlan', { km: num(wk.plannedKm), goal: num(wk.goal.runGoalKm), n: wk.weightsPlanned, g: wk.goal.weightsGoal })}</span>
           ${short > 0.05 ? `<span class="chip chip-neutral">${icon('alert')}<span>${t('plan.short', { km: num(short) })}</span></span>` : ''}`}
    </li>`;
  }).join('');

  const weekdays = Array.from({ length: 7 }, (_, i) => `<span>${dateFmt.weekdayNarrow(addDays(weekStart(now), i))}</span>`).join('');

  el.innerHTML = `
  <div class="screen plan">
    <header class="top top-bar">
      <a class="btn-round" href="#/" aria-label="${t('log.back')}">${icon('chevronLeft')}</a>
      <div class="top-title"><h1 class="title">${t('plan.title')}</h1><p class="meta">${monthName}</p></div>
    </header>

    <section class="card" aria-labelledby="m-title">
      <div class="month-nav">
        <button type="button" class="btn-round" data-month="-1" aria-label="${t('plan.prevMonth')}">${icon('chevronLeft')}</button>
        <h2 id="m-title" class="title">${monthName}</h2>
        <button type="button" class="btn-round" data-month="1" aria-label="${t('plan.nextMonth')}">${icon('chevronRight')}</button>
      </div>
      <div class="cal-head" aria-hidden="true">${weekdays}</div>
      <ol class="cal-grid">${grid}</ol>
      <ul class="legend">
        <li><span class="mark mark-upper is-done" aria-hidden="true"></span>${t('category.upper')}</li>
        <li><span class="mark mark-lower is-done" aria-hidden="true"></span>${t('category.lower')}</li>
        <li><span class="mark mark-run is-done" aria-hidden="true"></span>${t('category.run')}</li>
        <li><span class="custom-key" aria-hidden="true"></span>${t('plan.legendChanged')}</li>
      </ul>
      <p class="meta">${t('home.tapDay')}</p>
    </section>

    <section class="session" aria-labelledby="w-title">
      <h2 id="w-title" class="label section-label">${t('home.week')}</h2>
      <ul class="week-rows">${weekRows}</ul>
    </section>

    <div class="finish">
      <button type="button" class="btn btn-outline btn-block" data-copy>${icon('repeat')}<span>${t('plan.copyWeek')}</span></button>
      <button type="button" class="btn btn-ghost btn-block" data-reset>${t('plan.resetMonth')}</button>
    </div>
  </div>
  <dialog class="sheet" id="reset-confirm" aria-labelledby="reset-title"><div class="sheet-body">
    <h2 id="reset-title" class="title">${t('plan.resetConfirm', { month: monthName })}</h2>
    <div class="sheet-actions">
      <button type="button" class="btn btn-outline" data-cancel>${t('plan.resetCancel')}</button>
      <button type="button" class="btn btn-primary" data-go>${t('plan.resetGo')}</button>
    </div>
  </div></dialog>`;

  const redraw = () => renderPlan(el);
  const confirm = el.querySelector('#reset-confirm');
  el.querySelector('.plan').addEventListener('click', async (e) => {
    const day = e.target.closest('[data-day]');
    if (day) return openDaySheet(day.dataset.day, { onSaved: redraw });
    const m = e.target.closest('[data-month]');
    if (m) { monthOffset += Number(m.dataset.month); return redraw(); }
    if (e.target.closest('[data-copy]')) {
      await copyWeek(iso(weekStart(now)));
      toast(t('plan.copied'));
      return redraw();
    }
    if (e.target.closest('[data-reset]')) confirm.showModal();
  });
  confirm.querySelector('[data-cancel]').addEventListener('click', () => confirm.close());
  confirm.querySelector('[data-go]').addEventListener('click', async () => {
    const n = await resetRange(iso(first), iso(last));
    confirm.close();
    toast(t('plan.resetMonthDone', { n }));
    redraw();
  });
}

