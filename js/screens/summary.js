// A week or month on one page, for the trainer: training done against plan, running
// against the weekly goals, body weight, strength per machine, and notes. Share it as
// text, copy it, or print it.
import { t, tc, dateFmt, num } from '../i18n.js';
import { icon } from '../icons.js';
import { esc, toast } from '../ui.js';
import { paceText } from './run.js';
import { weekResult } from '../dayplan.js';
import {
  today, iso, addDays, fromIso, weekStart, getWeek, getBodySeries, getRuns, getWorkouts,
  getAllMachines, getMachineHistory, planFor,
} from '../store.js';

let span = 'week';
let offset = 0;

function period() {
  const now = today();
  if (span === 'week') {
    const from = addDays(weekStart(now), offset * 7);
    return { from, to: addDays(from, 6) };
  }
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1, 12);
  return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 0, 12) };
}

export async function renderSummary(el) {
  const KG = t('body.kg');
  const KM = t('run.km');
  const { from, to } = period();
  const a = iso(from), b = iso(to);
  const inP = (r) => r.date >= a && r.date <= b;
  const [bodyAll, runsAll, workoutsAll, machines] = await Promise.all([getBodySeries(), getRuns(), getWorkouts(), getAllMachines()]);

  const weeks = [];
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) weeks.push(await getWeek(w));
  const days = weeks.flat().filter((d) => d.iso >= a && d.iso <= b);
  const plannedW = days.filter((d) => d.plan.weights).length;
  const doneW = days.filter((d) => d.workout).length;
  const plannedR = days.filter((d) => d.plan.run).length;
  const doneR = days.filter((d) => d.runKm > 0).length;
  // a past day counts as kept when everything planned for it was done (rest days count too)
  const keptDays = days.filter((d) => d.past)
    .filter((d) => (!d.plan.weights || d.workout) && (!d.plan.run || d.runKm > 0)).length;
  const pastDays = days.filter((d) => d.past).length;

  const runs = runsAll.filter(inP);
  const km = runs.reduce((s, r) => s + r.distanceKm, 0);
  const paced = runs.filter((r) => r.durationMin > 0 && r.distanceKm > 0);
  const best = paced.length ? paced.reduce((x, r) => (r.durationMin / r.distanceKm < x.durationMin / x.distanceKm ? r : x)) : null;
  const avgPace = paced.length ? paceText(paced.reduce((s, r) => s + r.distanceKm, 0), paced.reduce((s, r) => s + r.durationMin, 0)) : '';
  const goalKm = weeks.filter((w) => w[0].iso >= a || span === 'week').reduce((s, w) => s + w.goal.runGoalKm, 0);

  const body = bodyAll.filter(inP);
  const bodyChange = body.length > 1 ? body.at(-1).weightKg - body[0].weightKg : null;
  const waist = body.filter((x) => x.waistCm);

  const strength = [];
  for (const m of machines) {
    const h = await getMachineHistory(m.id);
    const inside = h.filter(inP);
    if (!inside.length) continue;
    const before = h.filter((x) => x.date < a).reduce((mx, x) => Math.max(mx, x.topKg), 0);
    const top = Math.max(...inside.map((x) => x.topKg));
    strength.push({ m, sessions: inside.length, top, before, volume: inside.reduce((s, x) => s + x.volume, 0), pr: before > 0 && top > before });
  }

  const notes = [
    ...workoutsAll.filter(inP).filter((w) => w.note).map((w) => ({ date: w.date, text: w.note, kind: t(`category.${w.type}`) })),
    ...runs.filter((r) => r.note).map((r) => ({ date: r.date, text: r.note, kind: t('category.run') })),
    ...days.map((d) => ({ d, p: planFor(d.iso) })).filter(({ p }) => p.custom && p.note).map(({ d, p }) => ({ date: d.iso, text: p.note, kind: t('plan.title') })),
  ].sort((x, y) => (x.date < y.date ? -1 : 1));

  const label = span === 'week'
    ? `${dateFmt.short(from)} – ${dateFmt.short(to)}`
    : new Intl.DateTimeFormat(document.documentElement.lang, { month: 'long', year: 'numeric' }).format(from);
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}`;

  // plain-text version for sharing or copying into a chat with the trainer
  const text = [
    `P-Health · ${label}`,
    `${t('summary.weights')}: ${t('summary.ofPlanned', { n: doneW, of: plannedW })}`,
    `${t('summary.runs')}: ${t('summary.ofPlanned', { n: doneR, of: plannedR })}, ${num(km)} / ${num(goalKm)} ${KM}${avgPace ? `, ${t('summary.avgPace')} ${avgPace} /${KM}` : ''}`,
    ...(span === 'month' ? weeks.filter((w) => w.ended).map((w) => `  ${dateFmt.short(w[0].date)}: ${num(w.doneKm)} / ${num(w.goal.runGoalKm)} ${KM}${w.gapKm > 0.05 ? ` (${t('plan.resultShort', { km: num(w.gapKm) })})` : ''}`) : []),
    body.length ? `${t('summary.body')}: ${num(body[0].weightKg)} → ${num(body.at(-1).weightKg)} ${KG}${bodyChange !== null ? ` (${signed(bodyChange)} ${KG})` : ''}` : '',
    strength.length ? `${t('summary.strength')}:` : '',
    ...strength.map((s) => `  ${s.m.name}: ${num(s.top, 2)} ${KG}${s.pr ? ` (${t('analytics.newBest')}, ${t('summary.was', { kg: num(s.before, 2) })})` : ''}`),
    notes.length ? `${t('summary.notes')}:` : '',
    ...notes.map((n) => `  ${dateFmt.short(fromIso(n.date))} ${n.kind}: ${n.text}`),
  ].filter(Boolean).join('\n');

  el.innerHTML = `
  <div class="screen summary">
    <header class="top top-bar">
      <a class="btn-round" href="#/analytics" aria-label="${t('summary.back')}">${icon('chevronLeft')}</a>
      <div class="top-title"><h1 class="title">${t('summary.title')}</h1><p class="meta">${label}</p></div>
    </header>
    <div class="segmented no-print" role="radiogroup" aria-label="${t('summary.span')}">
      ${['week', 'month'].map((s) => `<button type="button" role="radio" class="seg" data-span="${s}" aria-checked="${span === s}" tabindex="${span === s ? 0 : -1}">${t(`summary.${s}`)}</button>`).join('')}
    </div>
    <div class="month-nav no-print">
      <button type="button" class="btn-round" data-shift="-1" aria-label="${t('summary.prev')}">${icon('chevronLeft')}</button>
      <p class="title">${label}</p>
      <button type="button" class="btn-round" data-shift="1" aria-label="${t('summary.next')}" ${offset >= 0 ? 'disabled' : ''}>${icon('chevronRight')}</button>
    </div>

    <section class="card textured glow-upper" aria-labelledby="s-train">
      <h2 id="s-train" class="label">${t('summary.training')}</h2>
      <p class="num-xl">${pastDays ? Math.round((keptDays / pastDays) * 100) : 0}<span class="unit">%</span></p>
      <p class="meta">${t('summary.kept', { n: keptDays, of: pastDays })}</p>
      <dl class="stats">
        <div><dt><span class="dot dot-upper" aria-hidden="true"></span>${t('summary.weights')}</dt><dd class="num-lg">${doneW}<span class="unit">/ ${plannedW}</span></dd></div>
        <div><dt><span class="dot dot-run" aria-hidden="true"></span>${t('summary.runs')}</dt><dd class="num-lg">${doneR}<span class="unit">/ ${plannedR}</span></dd></div>
        <div><dt>${t('summary.km')}</dt><dd class="num-lg">${num(km)}<span class="unit">/ ${num(goalKm)}</span></dd></div>
      </dl>
    </section>

    <section class="card" aria-labelledby="s-run">
      <h2 id="s-run" class="label">${t('summary.running')}</h2>
      <ul class="week-results">${weeks.map((w) => `<li>
        <span class="week-row-date">${dateFmt.short(w[0].date)}</span>
        <span class="meta">${num(w.doneKm)} / ${num(w.goal.runGoalKm)} ${KM}</span>
        ${w.ended ? weekResult(w) : `<span class="meta">${w[0].iso > iso(today()) ? t('analytics.upcoming') : t('analytics.inProgress')}</span>`}
      </li>`).join('')}</ul>
      ${paced.length ? `<p class="meta">${t('summary.paceLine', { avg: avgPace, best: paceText(best.distanceKm, best.durationMin), date: dateFmt.short(fromIso(best.date)) })}</p>` : ''}
    </section>

    <section class="card" aria-labelledby="s-body">
      <h2 id="s-body" class="label">${t('summary.body')}</h2>
      ${body.length ? `<p class="summary-line"><span class="num-lg">${num(body[0].weightKg)} → ${num(body.at(-1).weightKg)}</span><span class="unit">${KG}</span>
        ${bodyChange !== null ? `<span class="chip chip-neutral">${signed(bodyChange)} ${KG}</span>` : ''}</p>
        <p class="meta">${tc('summary.weighIns', body.length)}${waist.length ? ` · ${t('summary.waist', { from: num(waist[0].waistCm), to: num(waist.at(-1).waistCm) })}` : ''}</p>`
        : `<p class="meta">${t('summary.noBody')}</p>`}
    </section>

    <section class="card" aria-labelledby="s-str">
      <h2 id="s-str" class="label">${t('summary.strength')}</h2>
      ${strength.length ? `<ul class="week-results">${strength.map((s) => `<li>
        <span class="dot dot-${s.m.group}" aria-hidden="true"></span>
        <span class="week-row-date">${esc(s.m.name)}</span>
        <span class="meta">${num(s.top, 2)} ${KG} · ${tc('summary.sessions', s.sessions)}</span>
        ${s.pr ? `<span class="result result-met">${icon('trophy')}<span>${t('summary.newBestFrom', { kg: num(s.before, 2) })}</span></span>` : ''}
      </li>`).join('')}</ul>` : `<p class="meta">${t('summary.noStrength')}</p>`}
    </section>

    ${notes.length ? `<section class="card" aria-labelledby="s-notes">
      <h2 id="s-notes" class="label">${t('summary.notes')}</h2>
      <ul class="notes">${notes.map((n) => `<li><span class="meta">${dateFmt.short(fromIso(n.date))} · ${esc(n.kind)}</span><p>${esc(n.text)}</p></li>`).join('')}</ul>
    </section>` : ''}

    <div class="finish no-print">
      ${navigator.share ? `<button type="button" class="btn btn-primary btn-block" data-share>${icon('share')}<span>${t('summary.share')}</span></button>` : ''}
      <div class="sheet-actions">
        <button type="button" class="btn btn-outline" data-copy>${icon('copy')}<span>${t('summary.copy')}</span></button>
        <button type="button" class="btn btn-outline" data-print>${icon('printer')}<span>${t('summary.print')}</span></button>
      </div>
    </div>
  </div>`;

  el.querySelector('.summary').addEventListener('click', async (e) => {
    const s = e.target.closest('[data-span]');
    if (s && s.dataset.span !== span) { span = s.dataset.span; offset = 0; return renderSummary(el); }
    const sh = e.target.closest('[data-shift]');
    if (sh && !sh.disabled) { offset += Number(sh.dataset.shift); return renderSummary(el); }
    if (e.target.closest('[data-share]')) {
      try { await navigator.share({ title: `P-Health · ${label}`, text }); } catch { /* cancelled */ }
    }
    if (e.target.closest('[data-copy]')) {
      try { await navigator.clipboard.writeText(text); toast(t('summary.copied')); } catch { toast(t('summary.copyFailed')); }
    }
    if (e.target.closest('[data-print]')) window.print();
  });
}
