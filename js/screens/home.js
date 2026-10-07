import { t, tc, dateFmt, num, numHtml } from '../i18n.js';
import { icon } from '../icons.js';
import { today, iso, addDays, getWeek, getSettings, getBodySeries, getWorkoutOn, getDraft, getRunOn } from '../store.js';

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

function dayMarks(day, todayIso, perSessionKm) {
  const past = day.iso < todayIso;
  const isToday = day.iso === todayIso;
  const marks = [];
  const weight = day.workout ? day.workout.type : day.plan !== 'rest' ? day.plan : null;
  if (weight) marks.push({ cat: weight, done: !!day.workout });
  if (day.plan !== 'rest' || day.runKm > 0) marks.push({ cat: 'run', done: day.runKm >= perSessionKm });
  const state = marks.length && marks.every((m) => m.done) ? 'done' : (past || isToday) ? (marks.length ? 'planned' : 'rest') : marks.length ? 'planned' : 'rest';
  return { marks, state, isToday };
}

function sparkline(points) {
  if (points.length < 2) return '';
  const w = 160, h = 48, pad = 4;
  const ys = points.map((p) => p.weightKg);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const xy = points.map((p, i) => [pad + (i / (points.length - 1)) * (w - pad * 2), pad + (1 - (p.weightKg - min) / span) * (h - pad * 2)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = xy[xy.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" class="spark-grid"/>`).join('')}
    <path d="${line}" class="spark-line" fill="none"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" class="spark-dot"/>
  </svg>`;
}

export async function renderHome(el) {
  const now = today();
  const todayIso = iso(now);
  const [week, settings, body, done, draft, runToday] = await Promise.all([
    getWeek(now), getSettings(), getBodySeries(), getWorkoutOn(todayIso), getDraft(todayIso), getRunOn(todayIso),
  ]);
  const runLine = runToday ? `<p class="lead-done">${icon('check')}<span>${t('home.runLogged', { km: num(runToday.distanceKm) })}</span></p>` : '';
  const todayRow = week.find((d) => d.iso === todayIso);
  const plan = todayRow.plan;
  const runKm = week.reduce((s, d) => s + d.runKm, 0);
  const goal = settings.runGoalKm;
  const pct = Math.min(1, runKm / goal);

  // body weight: latest, 7-day average, weekly rate from the last 14 days
  const latest = body[body.length - 1];
  const last7 = body.filter((b) => b.date > iso(addDays(now, -7)));
  const prev7 = body.filter((b) => b.date <= iso(addDays(now, -7)) && b.date > iso(addDays(now, -14)));
  const avg = (rows) => rows.reduce((s, b) => s + b.weightKg, 0) / rows.length;
  const avg7 = last7.length ? avg(last7) : null;
  const rate = last7.length && prev7.length ? avg7 - avg(prev7) : null;
  const spark = body.filter((b) => b.date > iso(addDays(now, -21)));

  // lead card content
  const cat = plan === 'rest' ? 'rest' : plan;
  let leadBody, leadActions;
  if (plan === 'rest') {
    const ranToday = todayRow.runKm > 0;
    leadBody = `<p class="lead-sub">${ranToday ? t('home.restDone') : t('home.restBody', { km: settings.runPerSessionKm })}</p>${runLine}`;
    leadActions = `${ranToday ? '' : `<a class="btn btn-primary" href="#/log/run"><span>${t('home.logRunNow')}</span>${icon('arrowRight')}</a>`}
      <a class="btn btn-ghost" href="#/log">${icon('log')}<span>${t('home.logAnyway')}</span></a>`;
  } else {
    leadBody = `
      <p class="lead-sub">${t(plan === 'upper' ? 'home.planUpper' : 'home.planLower')}</p>
      <p class="lead-run"><span class="dot dot-run" aria-hidden="true"></span>${t('home.planRun', { km: settings.runPerSessionKm })}</p>`;
    if (done) {
      leadBody += `<p class="lead-done">${icon('check')}<span>${t('home.loggedToday')}: ${t('home.loggedSummary', { machines: tc('home.machines', done.machines), sets: tc('home.sets', done.sets) })}</span></p>`;
      leadBody += runLine;
      leadActions = `${runToday ? '' : `<a class="btn btn-primary" href="#/log/run"><span>${t('home.logRunNow')}</span>${icon('arrowRight')}</a>`}
        <a class="btn btn-outline" href="#/log">${icon('log')}<span>${t('home.editWorkout')}</span></a>`;
    } else {
      leadBody += runLine;
      leadActions = `<a class="btn btn-primary" href="#/log"><span>${t(draft ? 'home.continueWorkout' : 'home.startWorkout')}</span>${icon('arrowRight')}</a>`;
    }
  }

  const days = week.map((d) => {
    const m = dayMarks(d, todayIso, settings.runPerSessionKm);
    const stateLabel = m.isToday ? t('home.dayToday') : t(`home.day${m.state[0].toUpperCase()}${m.state.slice(1)}`);
    const parts = m.marks.map((x) => `${t(`category.${x.cat}`)} ${x.done ? t('home.dayDone') : t('home.dayPlanned')}`);
    const label = `${dateFmt.weekday(d.date)} ${dateFmt.day(d.date)}, ${parts.length ? parts.join(', ') : t('home.dayRest')}${m.isToday ? `, ${stateLabel}` : ''}`;
    return `<li class="day ${m.isToday ? 'is-today' : ''}" aria-label="${label}">
      <span class="day-name" aria-hidden="true">${dateFmt.weekdayNarrow(d.date)}</span>
      <span class="day-num" aria-hidden="true">${dateFmt.day(d.date)}</span>
      <span class="day-marks" aria-hidden="true">${m.marks.length
        ? m.marks.map((x) => `<span class="mark mark-${x.cat} ${x.done ? 'is-done' : ''}"></span>`).join('')
        : '<span class="mark mark-rest"></span>'}</span>
    </li>`;
  }).join('');

  const left = Math.max(0, goal - runKm);
  const rateTxt = rate === null ? '' : `${rate > 0 ? '+' : rate < 0 ? '−' : ''}${num(Math.abs(rate), 1)}`;

  el.innerHTML = `
  <div class="screen home">
    <header class="top">
      <p class="eyebrow">${dateFmt.long(now)}</p>
      <a class="btn-round" href="#/settings" aria-label="${t('settings.open')}">${icon('settings')}</a>
    </header>

    <section class="card lead textured glow-${cat}" aria-labelledby="lead-title">
      <div class="lead-title">
        <p class="eyebrow">${t('home.today')}</p>
        <h1 id="lead-title" class="display">${plan === 'rest' ? t('home.restTitle') : t(`category.${plan}`)}</h1>
      </div>
      ${leadBody}
      <div class="lead-actions">${leadActions}</div>
    </section>

    <section class="card week" aria-labelledby="week-title">
      <div class="card-head">
        <h2 id="week-title" class="label">${t('home.week')}</h2>
        <p class="meta">${t('home.weekRange', { start: dateFmt.short(week[0].date), end: dateFmt.short(week[6].date) })}</p>
      </div>
      <ol class="days">${days}</ol>
      <ul class="legend" aria-label="${t('home.legend')}">
        <li><span class="mark mark-upper is-done" aria-hidden="true"></span>${t('category.upper')}</li>
        <li><span class="mark mark-lower is-done" aria-hidden="true"></span>${t('category.lower')}</li>
        <li><span class="mark mark-run is-done" aria-hidden="true"></span>${t('category.run')}</li>
      </ul>
    </section>

    <div class="pair">
      <section class="card ring-card glow-run" aria-labelledby="ring-title">
        <h2 id="ring-title" class="label">${t('home.runRing')}</h2>
        <div class="ring" role="img" aria-label="${num(runKm)} ${t('home.runOf', { goal })}">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <defs><linearGradient id="ringStroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" class="ring-stop-start"/><stop offset="1" class="ring-stop-end"/>
            </linearGradient></defs>
            <circle cx="60" cy="60" r="${RING_R}" class="ring-track"/>
            <circle cx="60" cy="60" r="40" class="ring-dots"/>
            <circle cx="60" cy="60" r="${RING_R}" class="ring-value" stroke-dasharray="${(RING_C * pct).toFixed(1)} ${RING_C.toFixed(1)}" transform="rotate(-90 60 60)"/>
          </svg>
          <p class="ring-center" aria-hidden="true"><span class="num-lg">${numHtml(runKm)}</span><span class="meta">${t('home.runOf', { goal })}</span></p>
        </div>
        <p class="meta ring-foot">${left > 0 ? t('home.runLeft', { km: num(left) }) : t('home.runGoalMet')}</p>
        <a class="btn btn-outline btn-compact card-action" href="#/log/run">${icon('plus')}<span>${t('logTabs.run')}</span></a>
      </section>

      <section class="card body-card" aria-labelledby="body-title">
        <h2 id="body-title" class="label">${t('home.bodyWeight')}</h2>
        ${latest ? `
        <p class="num-xl">${numHtml(latest.weightKg)}<span class="unit">${t('log.kg')}</span></p>
        ${rate !== null ? `<p class="chip chip-neutral">${icon(rate <= 0 ? 'trendDown' : 'trendUp')}<span>${t('home.perWeek', { delta: rateTxt })}</span></p>` : ''}
        ${sparkline(spark)}
        <p class="meta">${avg7 !== null ? t('home.avg7', { kg: num(avg7) }) : ''}</p>
        <p class="meta">${t('home.weighedAt', { date: dateFmt.short(new Date(`${latest.date}T12:00:00`)) })}</p>` : ''}
        <a class="btn btn-outline btn-compact card-action" href="#/log/body">${icon('plus')}<span>${t('home.logWeightNow')}</span></a>
      </section>
    </div>

    <footer class="page-end"><p class="meta">${t('home.weekSummary', {
      weights: week.filter((d) => d.workout).length,
      weightsPlan: week.filter((d) => d.plan !== 'rest').length,
      runs: week.filter((d) => d.runKm >= settings.runPerSessionKm).length,
      runsPlan: week.filter((d) => d.plan !== 'rest').length + 1,
    })}</p></footer>
  </div>`;
}
