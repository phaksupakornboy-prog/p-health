import { t, dateFmt, num, numHtml } from '../i18n.js';
import { icon } from '../icons.js';
import { esc } from '../ui.js';
import { mount, tableHtml } from '../chart.js';
import { paceText } from './run.js';
import { weekResult } from '../dayplan.js';
import {
  getWeek, today, iso, addDays, fromIso, weekStart, getSettings, getBodySeries, getRuns, getWorkouts,
  getAllMachines, getMachineHistory,
} from '../store.js';

const RANGES = { '4w': 28, '3m': 91, all: null };
let range = '4w';
let machineId = null;

const ms = (isoDate) => fromIso(isoDate).getTime();
const signed = (n, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n), d)}`;

function rolling7(rows) {
  return rows.map((r) => {
    const from = iso(addDays(fromIso(r.date), -6));
    const win = rows.filter((x) => x.date >= from && x.date <= r.date);
    return { date: r.date, avg: win.reduce((s, x) => s + x.weightKg, 0) / win.length };
  });
}

export async function renderAnalytics(el) {
  const now = today();
  const days = RANGES[range];
  const fromIsoDate = days ? iso(addDays(now, -days + 1)) : '0000-00-00';
  const inRange = (r) => r.date >= fromIsoDate;

  const [settings, bodyAll, runsAll, workoutsAll, machines] = await Promise.all([
    getSettings(), getBodySeries(), getRuns(), getWorkouts(), getAllMachines(),
  ]);
  const histories = new Map(await Promise.all(machines.map(async (m) => [m.id, await getMachineHistory(m.id)])));

  // ---- body
  const avgAll = rolling7(bodyAll);
  const body = bodyAll.filter(inRange);
  const avg = avgAll.filter(inRange);
  const change = avg.length > 1 ? avg[avg.length - 1].avg - avg[0].avg : null;
  const spanWeeks = avg.length > 1 ? (ms(avg[avg.length - 1].date) - ms(avg[0].date)) / (7 * 864e5) : 0;
  const rate = change !== null && spanWeeks > 0 ? change / spanWeeks : null;

  // ---- sessions
  const workouts = workoutsAll.filter(inRange);
  const runs = runsAll.filter(inRange);
  const upperN = workouts.filter((w) => w.type === 'upper').length;
  const lowerN = workouts.filter((w) => w.type === 'lower').length;
  const runKm = runs.reduce((s, r) => s + r.distanceKm, 0);

  // ---- strength
  const withHistory = machines.filter((m) => histories.get(m.id).length);
  if (!machineId || !withHistory.some((m) => m.id === machineId)) {
    machineId = [...withHistory].sort((a, b) => (histories.get(b.id).at(-1).date > histories.get(a.id).at(-1).date ? 1 : -1))[0]?.id || null;
  }
  const mSel = machines.find((m) => m.id === machineId);
  const histAll = machineId ? histories.get(machineId) : [];
  const prIdx = new Set();
  let runMax = 0;
  histAll.forEach((h, i) => { if (h.topKg > runMax) { if (i > 0) prIdx.add(i); runMax = h.topKg; } });
  const offset = histAll.findIndex(inRange);
  const hist = offset === -1 ? [] : histAll.slice(offset);
  const histPr = new Set([...prIdx].filter((i) => i >= offset).map((i) => i - offset));
  const best = histAll.reduce((m, h) => Math.max(m, h.topKg), 0);
  const latestIsPr = histAll.length > 1 && prIdx.has(histAll.length - 1);

  // ---- running per week
  const weeks = [];
  const firstWeek = weekStart(days ? addDays(now, -days + 1) : fromIso(runsAll[0]?.date || iso(now)));
  for (let w = firstWeek; w <= now; w = addDays(w, 7)) {
    const a = iso(w), b = iso(addDays(w, 6));
    const wkRuns = runsAll.filter((r) => r.date >= a && r.date <= b);
    const wkW = workoutsAll.filter((x) => x.date >= a && x.date <= b);
    weeks.push({ start: w, iso: a, km: wkRuns.reduce((s, r) => s + r.distanceKm, 0), runs: wkRuns, workouts: wkW, plan: await getWeek(w) });
  }
  const goal = settings.runGoalKm;
  const paceRuns = runs.filter((r) => r.distanceKm > 0 && r.durationMin > 0);

  const rangeBtns = Object.keys(RANGES).map((k) => `<button role="radio" class="seg" data-range="${k}" aria-checked="${k === range}" tabindex="${k === range ? 0 : -1}" aria-label="${t(`analytics.r${k === 'all' ? 'All' : k}Long`)}">${t(`analytics.r${k === 'all' ? 'All' : k}`)}</button>`).join('');

  const chips = withHistory.map((m) => `<li><button class="chip-btn" data-machine="${m.id}" aria-pressed="${m.id === machineId}"><span class="dot dot-${m.group}" aria-hidden="true"></span>${esc(m.name)}</button></li>`).join('');

  const consistency = [...weeks].reverse().slice(0, 12).map((w) => {
    const cells = Array.from({ length: 7 }, (_, i) => {
      const d = iso(addDays(w.start, i));
      const wo = w.workouts.find((x) => x.date === d);
      const rn = w.runs.find((x) => x.date === d);
      const future = d > iso(now);
      const p = w.plan[i].plan;
      // what was planned but not done shows hollow, as on the Home week strip
      const planned = `${p.weights && !wo ? `<span class="mark mark-${p.weights}"></span>` : ''}${p.run && !rn ? '<span class="mark mark-run"></span>' : ''}`;
      return `<span class="cal-cell ${future ? 'is-future' : ''} ${d === iso(now) ? 'is-today' : ''}" aria-hidden="true">${wo ? `<span class="mark mark-${wo.type} is-done"></span>` : ''}${rn ? '<span class="mark mark-run is-done"></span>' : ''}${planned}${!wo && !rn && !planned ? '<span class="mark mark-rest"></span>' : ''}</span>`;
    }).join('');
    const wp = w.plan;
    const label = `${t('analytics.weekOf', { date: dateFmt.short(w.start) })}: ${t('analytics.weightsOf', { n: wp.weightsDone, of: wp.weightsPlanned })}, ${t('analytics.runsOf', { n: wp.runsDone, of: wp.runsPlanned })}`;
    return `<li class="cal-row" aria-label="${label}">
      <span class="cal-week meta" aria-hidden="true">${dateFmt.short(w.start)}</span>
      <span class="cal-cells">${cells}</span>
      <span class="cal-count meta" aria-hidden="true">${wp.weightsDone}/${wp.weightsPlanned} · ${wp.runsDone}/${wp.runsPlanned}</span>
    </li>`;
  }).join('');

  el.innerHTML = `
  <div class="screen analytics">
    <header class="top">
      <h1 class="title-lg">${t('analytics.title')}</h1>
    </header>
    <div class="segmented seg-3" role="radiogroup" aria-label="${t('analytics.range')}">${rangeBtns}</div>

    <section class="card textured glow-rest" aria-labelledby="a-body">
      <h2 id="a-body" class="label">${t('analytics.body')}</h2>
      ${body.length ? `
      <div class="hero-row">
        <p class="num-xl">${change === null ? numHtml(body.at(-1).weightKg) : signed(change)}<span class="unit">${t('body.kg')}</span></p>
        ${rate !== null ? `<p class="chip chip-neutral">${icon(rate <= 0 ? 'trendDown' : 'trendUp')}<span>${t('analytics.rate', { delta: signed(rate) })}</span></p>` : ''}
      </div>
      <p class="meta">${change === null ? '' : t('analytics.from', { kg: num(avg[0].avg) })}</p>
      <ul class="legend legend-lines">
        <li><span class="key s-ink"></span>${t('analytics.avg7')}</li>
        <li><span class="key key-dot s-soft"></span>${t('analytics.daily')}</li>
      </ul>
      <div class="chart" data-chart="body" role="img" aria-label="${t('analytics.chartBody', { summary: t('analytics.summaryFromTo', { from: `${num(body[0].weightKg)} ${t('body.kg')}`, to: `${num(body.at(-1).weightKg)} ${t('body.kg')}` }) })}"></div>
      ${tableHtml(t('analytics.table'), [t('analytics.date'), t('analytics.daily'), t('analytics.avg7')], body.map((b) => [dateFmt.short(fromIso(b.date)), num(b.weightKg), num(avgAll.find((a) => a.date === b.date).avg)]))}
      ` : `<p class="meta">${t('analytics.noBody')}</p>`}
    </section>

    <section class="card" aria-labelledby="a-sessions">
      <h2 id="a-sessions" class="label">${t('analytics.sessions')}</h2>
      <dl class="stats">
        <div><dt><span class="dot dot-upper" aria-hidden="true"></span>${t('analytics.upperCount')}</dt><dd class="num-lg">${upperN}</dd></div>
        <div><dt><span class="dot dot-lower" aria-hidden="true"></span>${t('analytics.lowerCount')}</dt><dd class="num-lg">${lowerN}</dd></div>
        <div><dt><span class="dot dot-run" aria-hidden="true"></span>${t('analytics.runCount')}</dt><dd class="num-lg">${runs.length}</dd><dd class="meta">${t('analytics.runKm', { km: num(runKm) })}</dd></div>
      </dl>
    </section>

    <section class="card" aria-labelledby="a-strength">
      <h2 id="a-strength" class="label">${t('analytics.strength')}</h2>
      ${mSel ? `
      <ul class="chip-scroll" aria-label="${t('analytics.pickMachine')}">${chips}</ul>
      <div class="hero-row">
        <div><p class="machine-row-name">${esc(mSel.name)}</p><p class="meta">${t('analytics.best', { kg: num(best, 2) })} · ${t('analytics.sessionsOn', { n: hist.length })}</p></div>
        ${latestIsPr ? `<p class="chip chip-good">${icon('trophy')}<span>${t('analytics.newBest')}</span></p>` : ''}
      </div>
      ${hist.length ? `
      <p class="label chart-title">${t('analytics.topWeight')}</p>
      ${histPr.size ? `<ul class="legend legend-lines"><li><span class="key-ring s-${mSel.group}" aria-hidden="true"></span>${t('analytics.newBestKey')}</li></ul>` : ''}
      <div class="chart" data-chart="top" role="img" aria-label="${t('analytics.chartStrength', { name: esc(mSel.name), summary: t('analytics.summaryFromTo', { from: `${num(hist[0].topKg, 2)} ${t('body.kg')}`, to: `${num(hist.at(-1).topKg, 2)} ${t('body.kg')}` }) })}"></div>
      <p class="label chart-title">${t('analytics.volume')} <span class="meta">${t('analytics.volumeHint')}</span></p>
      <div class="chart" data-chart="volume" role="img" aria-label="${t('analytics.chartVolume', { name: esc(mSel.name) })}"></div>
      ${tableHtml(t('analytics.table'), [t('analytics.date'), t('analytics.topWeight'), t('analytics.volume')], hist.map((h) => [dateFmt.short(fromIso(h.date)), `${num(h.topKg, 2)} ${t('body.kg')}`, num(h.volume, 0)]))}
      ` : `<p class="meta">${t('analytics.noSessions')}</p>`}` : `<p class="meta">${t('analytics.noSessions')}</p>`}
    </section>

    <section class="card textured glow-run" aria-labelledby="a-run">
      <h2 id="a-run" class="label">${t('analytics.running')}</h2>
      <p class="label chart-title">${t('analytics.weeklyKm')}</p>
      <div class="chart" data-chart="weeks" role="img" aria-label="${t('analytics.chartRuns', { summary: weeks.map((w) => `${dateFmt.short(w.start)} ${num(w.km)} ${t('run.km')}`).join(', ') })}"></div>
      ${paceRuns.length > 1 ? `
      <p class="label chart-title">${t('analytics.paceTrend')} <span class="meta">${t('analytics.paceHint')}</span></p>
      <div class="chart" data-chart="pace" role="img" aria-label="${t('analytics.chartPace', { summary: t('analytics.summaryFromTo', { from: paceText(paceRuns[0].distanceKm, paceRuns[0].durationMin), to: paceText(paceRuns.at(-1).distanceKm, paceRuns.at(-1).durationMin) }) })}"></div>` : ''}
      <h3 class="label chart-title">${t('analytics.weekResults')}</h3>
      <ul class="week-results">${[...weeks].reverse().map((w) => `<li>
        <span class="week-row-date">${dateFmt.short(w.start)}</span>
        <span class="meta">${num(w.km)} / ${num(w.plan.goal.runGoalKm)} ${t('run.km')}</span>
        ${w.plan.ended ? weekResult(w.plan) : `<span class="meta">${t('analytics.inProgress')}</span>`}
      </li>`).join('')}</ul>
      ${tableHtml(t('analytics.table'), [t('analytics.week'), t('run.distance')], weeks.map((w) => [dateFmt.short(w.start), `${num(w.km)} ${t('run.km')}`]))}
    </section>

    <section class="card" aria-labelledby="a-cons">
      <h2 id="a-cons" class="label">${t('analytics.consistency')}</h2>
      <p class="meta">${t('analytics.consistencyHint')}</p>
      <div class="cal-row cal-head" aria-hidden="true"><span></span><span class="cal-cells">${Array.from({ length: 7 }, (_, i) => `<span class="meta">${dateFmt.weekdayNarrow(addDays(weeks[0].start, i))}</span>`).join('')}</span><span></span></div>
      <ol class="cal">${consistency}</ol>
      <ul class="legend">
        <li><span class="mark mark-upper is-done" aria-hidden="true"></span>${t('category.upper')}</li>
        <li><span class="mark mark-lower is-done" aria-hidden="true"></span>${t('category.lower')}</li>
        <li><span class="mark mark-run is-done" aria-hidden="true"></span>${t('category.run')}</li>
      </ul>
    </section>
  </div>`;

  // ---- charts
  const short = (x) => dateFmt.short(new Date(x));
  const q = (k) => el.querySelector(`[data-chart="${k}"]`);
  if (q('body')) {
    mount(q('body'), {
      kind: 'line', xFmt: short, yFmt: (v) => num(v), tipFmt: (label, p) => `${label} ${num(p.y)} ${t('body.kg')}`,
      series: [
        { label: t('analytics.daily'), cls: 's-soft', thin: true, dots: true, points: body.map((b) => ({ x: ms(b.date), y: b.weightKg })) },
        { label: t('analytics.avg7'), cls: 's-ink', points: avg.map((a) => ({ x: ms(a.date), y: +a.avg.toFixed(2) })) },
      ],
    });
  }
  if (q('top')) {
    const cls = `s-${mSel.group}`;
    mount(q('top'), {
      kind: 'line', xFmt: short, yFmt: (v) => num(v, 1), tipFmt: (_, p) => `${num(p.y, 2)} ${t('body.kg')}`, height: 140,
      series: [{ label: t('analytics.topWeight'), cls, dots: true, marks: histPr, points: hist.map((h) => ({ x: ms(h.date), y: h.topKg })) }],
    });
    mount(q('volume'), {
      kind: 'bar', xFmt: short, yFmt: (v) => num(v, 0), tipFmt: (_, p) => `${t('analytics.volume')} ${num(p.y, 0)}`, height: 120, yMin: 0,
      series: [{ label: t('analytics.volume'), cls, points: hist.map((h) => ({ x: ms(h.date), y: h.volume })) }],
    });
  }
  mount(q('weeks'), {
    kind: 'bar', xFmt: short, yFmt: (v) => num(v, 0), tipFmt: (_, p) => `${num(p.y)} ${t('run.km')}`, height: 140, yMin: 0,
    goal: { y: goal, label: t('analytics.goal', { goal }) },
    series: [{ label: t('analytics.weeklyKm'), cls: 's-run', points: weeks.map((w) => ({ x: w.start.getTime(), y: +w.km.toFixed(2), dim: w.km < w.plan.goal.runGoalKm })) }],
  });
  if (q('pace')) {
    const fmtPace = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
    mount(q('pace'), {
      kind: 'line', xFmt: short, yFmt: fmtPace, tipFmt: (_, p) => `${fmtPace(p.y)} /${t('run.km')}`, height: 120,
      series: [{ label: t('analytics.paceTrend'), cls: 's-run', dots: true, points: paceRuns.map((r) => ({ x: ms(r.date), y: Math.round((r.durationMin * 60) / r.distanceKm) })) }],
    });
  }

  // ---- controls
  el.querySelector('.chip-btn[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  el.querySelector('[role="radiogroup"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (b && b.dataset.range !== range) { range = b.dataset.range; renderAnalytics(el).then(() => el.querySelector(`[data-range="${range}"]`)?.focus()); }
  });
  el.querySelector('[role="radiogroup"]').addEventListener('keydown', (e) => {
    const keys = Object.keys(RANGES);
    const i = keys.indexOf(range);
    const d = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    range = keys[(i + d + keys.length) % keys.length];
    renderAnalytics(el).then(() => el.querySelector(`[data-range="${range}"]`)?.focus());
  });
  el.querySelector('.chip-scroll')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-machine]');
    if (b && b.dataset.machine !== machineId) {
      machineId = b.dataset.machine;
      const y = window.scrollY;
      renderAnalytics(el).then(() => { window.scrollTo(0, y); el.querySelector(`[data-machine="${machineId}"]`)?.focus({ preventScroll: true }); });
    }
  });
}
