import { t, tc, has, dateFmt, num } from '../i18n.js';
import { icon } from '../icons.js';
import { go, toast, esc, logHeader } from '../ui.js';
import {
  today, iso, addDays, fromIso, SCHEDULE, getSettings, getMachines, getLastSession, getDraft, saveDraft,
  saveWorkout, addMachine, getWorkoutEntries,
} from '../store.js';

let S; // screen state: { draft, settings, machines, last: Map, root, error }

function guessType(now) {
  for (let i = 0; i < 7; i++) {
    const d = addDays(now, i);
    const plan = SCHEDULE[d.getDay()];
    if (plan !== 'rest') return { type: plan, forDay: d };
  }
  return { type: 'upper', forDay: now };
}

const machine = (id) => S.machines.find((m) => m.id === id);
const entry = (id) => S.draft.entries.find((e) => e.machineId === id);
const muscle = (m) => (m.muscleKey && has(`machines.${m.muscleKey}`) ? t(`machines.${m.muscleKey}`) : m.muscle);
const fmtKg = (n) => num(n, 2);

function newEntry(id) {
  const last = S.last.get(id);
  const top = last ? Math.max(...last.sets.map((s) => s.weightKg)) : 0;
  return {
    machineId: id, note: '', active: 0,
    sets: Array.from({ length: S.settings.defaultSets }, () => ({ weightKg: top, reps: S.settings.defaultReps, done: false })),
  };
}

function open(id) {
  if (!entry(id)) S.draft.entries.push(newEntry(id));
  S.draft.current = id;
}

function sessionOrder() {
  const inGroup = S.machines.filter((m) => m.group === S.draft.type).map((m) => m.id);
  const started = S.draft.entries.map((e) => e.machineId);
  return [...started, ...inGroup.filter((id) => !started.includes(id))];
}

function commit() {
  saveDraft(S.draft.date, S.draft);
  render();
}

function lastLine(id) {
  const last = S.last.get(id);
  if (!last) return t('log.noHistory');
  const top = Math.max(...last.sets.map((s) => s.weightKg));
  return t('log.lastTimeValue', { kg: fmtKg(top), reps: last.sets.map((s) => s.reps).join(' · ') });
}

function render() {
  const fid = document.activeElement?.dataset?.fid;
  const d = S.draft;
  const cur = entry(d.current);
  const m = machine(d.current);
  const cat = d.type;
  const idx = cur.active;
  const activeSet = cur.sets[idx] || cur.sets[0];
  const step = S.settings.weightStepKg;
  const last = S.last.get(m.id);
  const n = d.entries.indexOf(cur) + 1;
  const g = guessType(fromIso(d.date));

  const setRows = cur.sets.map((s, i) => `
    <li class="set-row ${i === idx ? 'is-active' : ''} ${s.done ? 'is-done' : ''}">
      <button class="set-pick" data-act="pick" data-i="${i}" data-fid="pick-${i}" aria-pressed="${i === idx}">
        <span class="set-no">${t('log.set', { n: i + 1 })}</span>
        <span class="set-kg">${fmtKg(s.weightKg)}<span class="unit">${t('log.kg')}</span></span>
      </button>
      <div class="reps" role="group" aria-label="${t('log.set', { n: i + 1 })} ${t('log.reps')}">
        <button class="btn-round btn-sm" data-act="reps" data-i="${i}" data-d="-1" data-fid="rl-${i}" aria-label="${t('log.repsLess', { n: i + 1 })}" ${s.reps <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
        <span class="reps-val" aria-live="polite">${s.reps}<span class="unit">${t('log.reps')}</span></span>
        <button class="btn-round btn-sm" data-act="reps" data-i="${i}" data-d="1" data-fid="rm-${i}" aria-label="${t('log.repsMore', { n: i + 1 })}">${icon('plus')}</button>
      </div>
      <button class="done-toggle cat-${cat}" data-act="done" data-i="${i}" data-fid="done-${i}" aria-pressed="${s.done}" aria-label="${s.done ? t('log.markUndone', { n: i + 1 }) : t('log.markDone', { n: i + 1 })}">${icon('check')}</button>
    </li>`).join('');

  const list = sessionOrder().filter((id) => id !== d.current).map((id) => {
    const mm = machine(id);
    const e = entry(id);
    const doneSets = e ? e.sets.filter((s) => s.done) : [];
    const isCur = id === d.current;
    const status = isCur ? `<span class="chip chip-now">${t('log.current')}</span>`
      : doneSets.length ? `<span class="chip chip-good">${icon('check')}<span>${t('log.done')}</span></span>` : '';
    const sub = doneSets.length ? t('log.doneSummary', { sets: tc('home.sets', doneSets.length), kg: fmtKg(Math.max(...doneSets.map((s) => s.weightKg))) }) : lastLine(id);
    return `<li><button class="machine-row" data-act="open" data-id="${id}" data-fid="open-${id}" ${isCur ? 'aria-current="true"' : ''}>
      ${mm.group !== d.type ? `<span class="dot dot-${mm.group}" aria-hidden="true"></span>` : ''}
      <span class="machine-row-text"><span class="machine-row-name">${esc(mm.name)}</span><span class="meta">${esc(sub)}</span></span>
      ${status}${isCur ? '' : icon('chevronRight', 'chev')}
    </button></li>`;
  }).join('');

  S.root.innerHTML = `
  <div class="screen log">
    ${logHeader({ t, dateLabel: dateFmt.long(fromIso(d.date)), title: t('log.title'), active: 'weights' })}

    <div class="segmented" role="radiogroup" aria-label="${t('log.typeLabel')}">
      ${['upper', 'lower'].map((ty) => `<button role="radio" class="seg seg-${ty}" data-act="type" data-type="${ty}" data-fid="type-${ty}" aria-checked="${d.type === ty}" tabindex="${d.type === ty ? 0 : -1}"><span class="dot dot-${ty}" aria-hidden="true"></span>${t(`category.${ty}`)}</button>`).join('')}
    </div>
    ${g.type === d.type ? `<p class="meta hint">${t('log.guessed', { day: dateFmt.weekday(g.forDay) })}</p>` : ''}

    <section class="card current textured glow-${m.group}" aria-labelledby="cur-name">
      <p class="eyebrow">${t('log.machineCount', { n })}</p>
      <h2 id="cur-name" class="machine-name"><span class="dot dot-${m.group}" aria-hidden="true"></span>${esc(m.name)}</h2>
      ${muscle(m) ? `<p class="meta">${esc(muscle(m))}</p>` : ''}
      <div class="last">
        <p class="last-line">${last ? `${t('log.lastTime')} · ${dateFmt.short(fromIso(last.date))}: <span class="last-val nowrap">${lastLine(m.id)}</span>` : lastLine(m.id)}</p>
        ${last ? `<button class="btn btn-outline btn-compact" data-act="same" data-fid="same">${icon('repeat')}<span>${t('log.sameAsLast')}</span></button>` : ''}
      </div>

      <div class="stepper" role="group" aria-labelledby="stepper-label">
        <p id="stepper-label" class="label stepper-label">${t('log.weightFor', { n: idx + 1 })}</p>
        <div class="stepper-row">
          <button class="btn-round btn-step" data-act="kg" data-d="-1" data-fid="kg-" aria-label="${t('log.decrease', { step: num(step) })}" ${activeSet.weightKg <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
          <label class="kg-field">
            <span class="sr-only">${t('log.weightFor', { n: idx + 1 })}</span>
            <input class="kg-input" data-act="kg-input" data-fid="kg-input" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${fmtKg(activeSet.weightKg)}" style="--len:${Math.max(2, fmtKg(activeSet.weightKg).length)}">
            <span class="unit">${t('log.kg')}</span>
          </label>
          <button class="btn-round btn-step" data-act="kg" data-d="1" data-fid="kg+" aria-label="${t('log.increase', { step: num(step) })}">${icon('plus')}</button>
        </div>
      </div>

      <h3 class="label sets-label">${t('log.sets')}</h3>
      <ol class="sets">${setRows}</ol>
      <div class="set-tools">
        <button class="btn btn-ghost btn-compact" data-act="add-set" data-fid="add-set">${icon('plus')}<span>${t('log.addSet')}</span></button>
        <button class="btn btn-ghost btn-compact" data-act="remove-set" data-fid="remove-set" ${cur.sets.length <= 1 ? 'disabled' : ''}>${icon('minus')}<span>${t('log.removeSet')}</span></button>
      </div>

      <label class="field">
        <span class="label">${icon('note')}${t('log.note')}</span>
        <textarea data-act="m-note" rows="2" placeholder="${t('log.machineNotePlaceholder')}">${esc(cur.note)}</textarea>
      </label>
    </section>

    <section aria-labelledby="next-title" class="session">
      <h2 id="next-title" class="label section-label">${t('log.upNext')}</h2>
      <ul class="machine-list">${list}</ul>
      <button class="btn btn-outline btn-block" data-act="picker" data-fid="picker">${icon('plus')}<span>${t('log.addMachine')}</span></button>
    </section>

    <label class="field day-note">
      <span class="label">${t('log.dayNote')}</span>
      <textarea data-act="d-note" rows="2" placeholder="${t('log.dayNotePlaceholder')}">${esc(d.dayNote)}</textarea>
    </label>

    <div class="finish">
      ${S.error ? `<p class="error" role="alert" id="finish-err">${icon('alert')}<span>${S.error}</span></p>` : ''}
      <button class="btn btn-primary btn-block btn-tall" data-act="finish" data-fid="finish" ${S.error ? 'aria-describedby="finish-err"' : ''}>
        <span>${t('log.finish')}</span>${icon('arrowRight')}
      </button>
    </div>
  </div>
  ${pickerMarkup()}`;

  if (fid) S.root.querySelector(`[data-fid="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
  // After a tick, bring the next set out from under the bottom nav.
  if (S.reveal !== undefined) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    S.root.querySelectorAll('.set-row')[S.reveal]?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    S.reveal = undefined;
  }
}

function pickerMarkup() {
  const inSession = new Set(S.draft.entries.map((e) => e.machineId));
  const groups = [S.draft.type, S.draft.type === 'upper' ? 'lower' : 'upper'];
  const block = (grp, i) => {
    const items = S.machines.filter((m) => m.group === grp && !inSession.has(m.id));
    if (!items.length) return '';
    return `<h3 class="label section-label">${i === 0 ? t(`category.${grp}`) : t('picker.otherGroup', { group: t(`category.${grp}`) })}</h3>
      <ul class="machine-list">${items.map((m) => `<li><button class="machine-row" data-act="pick-machine" data-id="${m.id}">
        <span class="dot dot-${m.group}" aria-hidden="true"></span>
        <span class="machine-row-text"><span class="machine-row-name">${esc(m.name)}</span><span class="meta">${esc(lastLine(m.id))}</span></span>
        ${icon('plus', 'chev')}</button></li>`).join('')}</ul>`;
  };
  return `<dialog class="sheet" id="picker" aria-labelledby="picker-title"><div class="sheet-body">
    <div class="sheet-head">
      <h2 id="picker-title" class="title">${t('picker.title')}</h2>
      <button class="btn-round" data-act="close-picker" aria-label="${t('picker.close')}">${icon('x')}</button>
    </div>
    ${groups.map(block).join('')}
    <form class="create" data-act="create" novalidate>
      <h3 class="label section-label">${t('picker.createTitle')}</h3>
      <p class="meta">${t('picker.createHint')}</p>
      <label class="field">
        <span class="label">${t('picker.name')}</span>
        <input name="name" autocomplete="off" placeholder="${t('picker.namePlaceholder')}" aria-describedby="name-err">
        <span class="error" id="name-err" hidden>${icon('alert')}<span>${t('picker.nameError')}</span></span>
      </label>
      <fieldset class="field">
        <legend class="label">${t('picker.group')}</legend>
        <div class="segmented">
          ${['upper', 'lower'].map((ty) => `<label class="seg seg-${ty}"><input type="radio" name="group" value="${ty}" ${ty === S.draft.type ? 'checked' : ''}><span class="dot dot-${ty}" aria-hidden="true"></span>${t(`category.${ty}`)}</label>`).join('')}
        </div>
      </fieldset>
      <p class="meta">${t('picker.photoLater')}</p>
      <button class="btn btn-primary btn-block" type="submit">${t('picker.create')}</button>
    </form>
  </div></dialog>`;
}

function clampKg(v) { return Math.max(0, Math.round(v * 100) / 100); }

function setWeight(e, i, v) {
  const old = e.sets[i].weightKg;
  e.sets[i].weightKg = v;
  for (let j = i + 1; j < e.sets.length; j++) if (!e.sets[j].done && e.sets[j].weightKg === old) e.sets[j].weightKg = v;
}

async function onClick(ev) {
  const b = ev.target.closest('[data-act]');
  if (!b || b.disabled || b.tagName === 'FORM') return;
  const d = S.draft;
  const e = entry(d.current);
  const i = Number(b.dataset.i);
  switch (b.dataset.act) {
    case 'type': d.type = b.dataset.type; S.error = ''; break;
    case 'pick': e.active = i; break;
    case 'reps': e.sets[i].reps = Math.max(0, e.sets[i].reps + Number(b.dataset.d)); break;
    case 'kg': setWeight(e, e.active, clampKg(e.sets[e.active].weightKg + Number(b.dataset.d) * S.settings.weightStepKg)); break;
    case 'done': {
      e.sets[i].done = !e.sets[i].done;
      if (e.sets[i].done) {
        S.error = '';
        const next = e.sets.findIndex((s, j) => j > i && !s.done);
        if (next !== -1) { e.active = next; S.reveal = next; }
      }
      break;
    }
    case 'same': {
      const last = S.last.get(e.machineId);
      e.sets = last.sets.map((s) => ({ weightKg: s.weightKg, reps: s.reps, done: false }));
      e.active = 0;
      break;
    }
    case 'add-set': {
      const ls = e.sets[e.sets.length - 1];
      e.sets.push({ weightKg: ls ? ls.weightKg : 0, reps: S.settings.defaultReps, done: false });
      break;
    }
    case 'remove-set': e.sets.pop(); e.active = Math.min(e.active, e.sets.length - 1); break;
    case 'open': open(b.dataset.id); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'picker': S.root.querySelector('#picker').showModal(); return;
    case 'close-picker': S.root.querySelector('#picker').close(); return;
    case 'pick-machine': S.root.querySelector('#picker').close(); open(b.dataset.id); window.scrollTo(0, 0); break;
    case 'finish': return finish();
    default: return;
  }
  commit();
}

async function finish() {
  const d = S.draft;
  const done = d.entries.flatMap((e) => e.sets.filter((s) => s.done));
  if (!done.length) { S.error = t('log.finishEmpty'); render(); return; }
  const machines = d.entries.filter((e) => e.sets.some((s) => s.done)).length;
  const res = await saveWorkout(d);
  let msg = t('log.saved', { machines: tc('home.machines', machines), sets: tc('home.sets', res.sets), km: S.settings.runPerSessionKm });
  const pr = res.prs[0];
  if (pr) msg = t('log.savedWithPr', { name: machine(pr.machineId).name, kg: fmtKg(pr.kg), saved: msg });
  toast(msg, pr ? 'pr' : 'info');
  go('/');
}

function onChange(ev) {
  const el = ev.target;
  const e = entry(S.draft.current);
  if (el.dataset.act === 'kg-input') {
    const v = parseFloat(String(el.value).replace(',', '.'));
    if (!Number.isNaN(v)) setWeight(e, e.active, clampKg(v));
    commit();
  }
}

function onInput(ev) {
  const el = ev.target;
  if (el.dataset.act === 'kg-input') el.style.setProperty('--len', Math.max(2, el.value.length));
  if (el.dataset.act === 'm-note') { entry(S.draft.current).note = el.value; saveDraft(S.draft.date, S.draft); }
  if (el.dataset.act === 'd-note') { S.draft.dayNote = el.value; saveDraft(S.draft.date, S.draft); }
}

function onKey(ev) {
  const el = ev.target;
  if (el.dataset?.act === 'kg-input' && ev.key === 'Enter') { el.blur(); return; }
  if (el.getAttribute?.('role') === 'radio' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) {
    ev.preventDefault();
    S.draft.type = S.draft.type === 'upper' ? 'lower' : 'upper';
    commit();
    S.root.querySelector(`[data-fid="type-${S.draft.type}"]`)?.focus();
  }
}

async function onSubmit(ev) {
  if (!ev.target.matches('form.create')) return;
  ev.preventDefault();
  const f = ev.target;
  const name = f.elements.name.value.trim();
  const err = f.querySelector('#name-err');
  if (!name) {
    err.hidden = false;
    f.elements.name.setAttribute('aria-invalid', 'true');
    f.elements.name.focus();
    return;
  }
  const m = await addMachine({ name, group: f.elements.group.value });
  S.machines.push(m);
  S.root.querySelector('#picker').close();
  open(m.id);
  commit();
}

export async function renderLog(el) {
  const now = today();
  const date = iso(now);
  const [settings, machines] = await Promise.all([getSettings(), getMachines()]);
  const last = new Map(await Promise.all(machines.map(async (m) => [m.id, await getLastSession(m.id, date)])));
  let draft = (await getDraft(date)) || (await getWorkoutEntries(date));
  if (!draft) draft = { date, type: guessType(now).type, entries: [], current: null, dayNote: '' };

  const root = document.createElement('div');
  el.replaceChildren(root);
  S = { draft, settings, machines, last, root, error: '' };
  if (!draft.current) open((machines.find((m) => m.group === draft.type) || machines[0]).id);

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('click', (ev) => { if (ev.target.matches('dialog.sheet')) ev.target.close(); });
  render();
}
