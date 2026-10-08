// Mock data repository. Every function is async and returns plain rows shaped like
// the Google Sheets tabs in SPEC.md (machines, workouts, sets, runs, body, settings),
// so swapping this file for a Sheets client later does not touch the screens.
// Machines are referenced by id everywhere, so renaming never loses history.

import { connection, fetchAll, enqueue, flush } from './remote.js';

const KEY = 'phealth.mock.v1';
const CACHE = 'phealth.cache.v1';
// Short unique ids so two phones (or a retry) never collide in the sheet.
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Usual week, Monday first: weights (upper/lower) and/or run, or rest. Only a default:
// any day can be changed on its own (db.plan), and each week can have its own goals.
export const DEFAULT_TEMPLATE = ['upper+run', 'lower+run', 'rest', 'upper+run', 'lower+run', 'run', 'rest'];
export function parseSlot(slot) {
  const parts = String(slot || 'rest').split('+');
  const weights = parts.includes('upper') ? 'upper' : parts.includes('lower') ? 'lower' : null;
  return { weights, run: parts.includes('run') };
}
export function slotOf({ weights, run }) {
  return [weights, run ? 'run' : null].filter(Boolean).join('+') || 'rest';
}
// The usual week and the default goals change over time; a past week is always judged
// by what applied then. Each is kept as a list of { from: week start, value }.
const HISTORY_KEYS = ['weekTemplate', 'runGoalKm', 'weightsGoal'];
function valueAt(settings, key, weekIso) {
  const hist = (settings.history && settings.history[key]) || [];
  let v = settings[key];
  const sorted = [...hist].sort((a, b) => (a.from < b.from ? -1 : 1));
  if (sorted.length) v = (sorted.filter((h) => h.from <= weekIso).pop() || sorted[0]).value;
  return v;
}
// Sheet cell format: "2026-09-28=15|2026-10-05=20" (a bare value counts from the start).
function parseHistory(raw, cast) {
  if (raw === undefined || raw === null || raw === '') return [];
  return String(raw).split('|').map((part) => {
    const i = part.indexOf('=');
    return i === -1 ? { from: '0000-00-00', value: cast(part) } : { from: part.slice(0, i), value: cast(part.slice(i + 1)) };
  });
}
const castTemplate = (v) => String(v).split(',');
const serialise = (hist) => hist.map((h) => `${h.from}=${Array.isArray(h.value) ? h.value.join(',') : h.value}`).join('|');

// routineUpper/Lower: machine ids in the order you do them; null means every machine of that group.
const DEFAULT_SETTINGS = { runGoalKm: 15, weightsGoal: 4, defaultSets: 3, defaultReps: 12, weightStepKg: 2.5, targetWeightKg: null, weekTemplate: DEFAULT_TEMPLATE, restSeconds: 90, routineUpper: null, routineLower: null, language: 'en' };

const CATALOG = [
  ['m01', 'Chest Press', 'upper', 'chest-press', 35],
  ['m02', 'Pec Fly', 'upper', 'pec-fly', 30],
  ['m03', 'Shoulder Press', 'upper', 'shoulder-press', 25],
  ['m04', 'Lat Pulldown', 'upper', 'lat-pulldown', 45],
  ['m05', 'Seated Row', 'upper', 'seated-row', 40],
  ['m06', 'Biceps Curl', 'upper', 'biceps-curl', 20],
  ['m07', 'Triceps Pushdown', 'upper', 'triceps-pushdown', 25],
  ['m08', 'Leg Press', 'lower', 'leg-press', 90],
  ['m09', 'Leg Extension', 'lower', 'leg-extension', 40],
  ['m10', 'Leg Curl', 'lower', 'leg-curl', 35],
  ['m11', 'Hip Abduction', 'lower', 'hip-abduction', 45],
  ['m12', 'Hip Adduction', 'lower', 'hip-adduction', 40],
  ['m13', 'Calf Raise', 'lower', 'calf-raise', 50],
];

// ?today=YYYY-MM-DD lets you preview any weekday; otherwise the real date.
export function today() {
  const q = new URLSearchParams(location.search).get('today');
  const d = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? new Date(`${q}T08:00:00`) : new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}
// The day a log screen writes to: ?d=YYYY-MM-DD in the hash (past days only), else today.
export function activeDate() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('d');
  const t = today();
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const d = new Date(`${q}T12:00:00`);
    if (d <= t) return d;
  }
  return t;
}
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromIso = (s) => new Date(`${s}T12:00:00`);
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export function weekStart(d) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow); }

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function seed(todayDate) {
  const rand = seeded(42);
  const db = {
    seededFor: iso(todayDate),
    settings: { ...DEFAULT_SETTINGS },
    plan: [], weeks: [],
    machines: CATALOG.map(([id, name, group, muscleKey]) => ({ id, name, group, muscleKey, muscle: '', photoUrl: '', active: true })),
    workouts: [], sets: [], runs: [], body: [], drafts: {},
  };
  const base = Object.fromEntries(CATALOG.map(([id, , , , kg]) => [id, kg]));
  const upperDay = ['m01', 'm04', 'm03', 'm05', 'm07'];
  const lowerDay = ['m08', 'm09', 'm10', 'm11', 'm13'];
  let wid = 1, sid = 1, rid = 1, bid = 1;

  for (let back = 35; back >= 1; back--) {
    const d = addDays(todayDate, -back);
    const slot = parseSlot(DEFAULT_TEMPLATE[(d.getDay() + 6) % 7]);
    const plan = slot.weights || (slot.run ? 'runday' : 'rest');
    const weeksAgo = Math.floor(back / 7);
    if ((plan === 'upper' || plan === 'lower') && rand() > 0.08) {
      const w = { id: `w${wid++}`, date: iso(d), type: plan, note: '' };
      db.workouts.push(w);
      (plan === 'upper' ? upperDay : lowerDay).forEach((mid) => {
        const kg = base[mid] + Math.max(0, 5 - weeksAgo) * 2.5 * (mid === 'm08' ? 2 : 1) * 0.5;
        const top = Math.round(kg / 2.5) * 2.5;
        [12, 12, rand() > 0.5 ? 10 : 12].forEach((reps, i) => {
          db.sets.push({ id: `s${sid++}`, workoutId: w.id, machineId: mid, setNo: i + 1, weightKg: top, reps, note: '' });
        });
      });
      const min = 19 + rand() * 3 - (5 - weeksAgo) * 0.25;
      db.runs.push({ id: `r${rid++}`, date: iso(d), distanceKm: 3, durationMin: +min.toFixed(1), speedKmh: null, incline: null, note: '' });
    }
    if (plan === 'runday' && rand() > 0.3) {
      db.runs.push({ id: `r${rid++}`, date: iso(d), distanceKm: 3, durationMin: +(20 + rand() * 2).toFixed(1), speedKmh: null, incline: null, note: '' });
    }
  }
  for (let back = 34; back >= 0; back--) {
    if (back > 0 && rand() < 0.15) continue;
    const kg = 81.6 - (34 - back) * 0.092 + (rand() - 0.5) * 0.6;
    db.body.push({ id: `b${bid++}`, date: iso(addDays(todayDate, -back)), weightKg: +kg.toFixed(1), waistCm: null, note: '' });
  }
  return db;
}

// A ?today= preview runs on a throwaway in-memory copy so it never touches saved data.
const preview = new URLSearchParams(location.search).has('today');
let db = null;
let mode = 'mock';
export const dataMode = () => mode;

// ---- Sheets rows (snake_case, as in the sheet) <-> app rows ----
const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const bool = (v) => v === true || String(v).toUpperCase() === 'TRUE';
function fromSheets(data) {
  const st = data.settings || {};
  return {
    settings: {
      runGoalKm: n(st.run_goal_km) ?? 15, weightsGoal: n(st.weights_goal) ?? 4,
      defaultSets: n(st.default_sets) ?? 3, defaultReps: n(st.default_reps) ?? 12,
      weightStepKg: n(st.weight_step_kg) ?? 2.5, targetWeightKg: n(st.target_weight_kg),
      weekTemplate: DEFAULT_TEMPLATE,
      restSeconds: n(st.rest_seconds) ?? 90,
      routineUpper: st.routine_upper ? String(st.routine_upper).split(',').filter(Boolean) : null,
      routineLower: st.routine_lower ? String(st.routine_lower).split(',').filter(Boolean) : null,
      history: {
        weekTemplate: parseHistory(st.week_template, castTemplate),
        runGoalKm: parseHistory(st.run_goal_km, Number),
        weightsGoal: parseHistory(st.weights_goal, Number),
      },
    },
    plan: (data.plan || []).map((r) => ({ date: String(r.date), weights: r.weights ? String(r.weights) : null, run: bool(r.run), runKm: n(r.run_km), note: String(r.note || '') })),
    weeks: (data.weeks || []).map((r) => ({ weekStart: String(r.week_start), runGoalKm: n(r.run_goal_km), weightsGoal: n(r.weights_goal) })),
    machines: [...new Map(data.machines.map((r) => [String(r.id), r])).values()].map((r) => ({ id: String(r.id), name: String(r.name), group: String(r.group), muscle: String(r.muscle || ''), muscleKey: String(r.muscle_key || ''), photoUrl: String(r.photo_url || ''), active: bool(r.active) })),
    workouts: data.workouts.map((r) => ({ id: String(r.id), date: String(r.date), type: String(r.type), note: String(r.note || '') })),
    sets: data.sets.map((r) => ({ id: String(r.id), workoutId: String(r.workout_id), machineId: String(r.machine_id), setNo: n(r.set_no), weightKg: n(r.weight_kg) ?? 0, reps: n(r.reps) ?? 0, note: String(r.note || '') })),
    runs: data.runs.map((r) => ({ id: String(r.id), date: String(r.date), distanceKm: n(r.distance_km) ?? 0, durationMin: n(r.duration_min), speedKmh: n(r.speed_kmh), incline: n(r.incline), note: String(r.note || '') })),
    body: data.body.map((r) => ({ id: String(r.id), date: String(r.date), weightKg: n(r.weight_kg), waistCm: n(r.waist_cm), note: String(r.note || '') })).filter((b) => b.weightKg),
  };
}
const machineRow = (m) => ({ id: m.id, name: m.name, group: m.group, muscle: m.muscle, muscle_key: m.muscleKey, photo_url: m.photoUrl, active: m.active });
const remote = (action, payload) => { if (mode === 'sheets') enqueue(action, payload); };

// Call once before the first screen. With a Sheets connection the sheet is the
// source of truth; the last copy stays on the phone so a slow start still shows data.
export async function init() {
  if (preview || !connection()) { mode = 'mock'; load(); return { mode }; }
  mode = 'sheets';
  let cached = null;
  try { const raw = localStorage.getItem(CACHE); if (raw) cached = JSON.parse(raw); } catch { /* */ }
  // With a copy on the phone, show it at once and refresh from the sheet behind it.
  if (cached) {
    db = cached;
    refresh().then((r) => window.dispatchEvent(new CustomEvent('phealth:data', { detail: r })));
    return { mode, fresh: false, cached: true };
  }
  const r = await refresh();
  if (!r.ok) db = { settings: { ...DEFAULT_SETTINGS }, plan: [], weeks: [], machines: [], workouts: [], sets: [], runs: [], body: [], drafts: {} };
  return { mode, fresh: r.ok, error: r.error };
}

async function refresh() {
  try {
    await flush();
    const fresh = fromSheets(await fetchAll());
    for (const k of HISTORY_KEYS) {
      const h = fresh.settings.history[k];
      if (h.length) fresh.settings[k] = [...h].sort((a, b) => (a.from < b.from ? -1 : 1)).pop().value;
    }
    db = { ...fresh, drafts: db?.drafts || cachedDrafts() };
    persist();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}
function cachedDrafts() {
  try { return JSON.parse(localStorage.getItem(CACHE))?.drafts || {}; } catch { return {}; }
}

function load() {
  if (db) return db;
  if (!preview) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) db = JSON.parse(raw);
    } catch { /* storage blocked: run in memory */ }
  }
  if (!db) { db = seed(today()); persist(); }
  db.plan ||= []; db.weeks ||= [];
  db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
  return db;
}
function persist() {
  if (preview) return;
  try { localStorage.setItem(mode === 'sheets' ? CACHE : KEY, JSON.stringify(db)); } catch { /* in-memory only */ }
}

export async function getSettings() { return { ...load().settings }; }
export async function getMachines() { return load().machines.filter((m) => m.active); }

export async function addMachine({ name, group }) {
  const d = load();
  const id = mode === 'sheets' ? uid('m') : `m${String(d.machines.length + 1).padStart(2, '0')}`;
  const m = { id, name, group, muscleKey: '', muscle: '', photoUrl: '', active: true };
  d.machines.push(m);
  persist();
  remote('addMachine', machineRow(m));
  return m;
}

// Most recent completed session for one machine before a date.
export async function getLastSession(machineId, beforeIso) {
  const d = load();
  const byDate = new Map(d.workouts.map((w) => [w.id, w.date]));
  const rows = d.sets.filter((s) => s.machineId === machineId && byDate.get(s.workoutId) < beforeIso);
  if (!rows.length) return null;
  const lastDate = rows.reduce((m, s) => (byDate.get(s.workoutId) > m ? byDate.get(s.workoutId) : m), '');
  const sets = rows.filter((s) => byDate.get(s.workoutId) === lastDate).sort((a, b) => a.setNo - b.setNo);
  return { date: lastDate, sets: sets.map((s) => ({ weightKg: s.weightKg, reps: s.reps })) };
}

export async function getBestWeight(machineId) {
  return load().sets.filter((s) => s.machineId === machineId).reduce((m, s) => Math.max(m, s.weightKg), 0);
}

// The plan for one day: the day's own entry if it was changed, else the usual week.
export function planFor(isoDate) {
  const d = load();
  const own = d.plan.find((p) => p.date === isoDate);
  if (own) return { weights: own.weights, run: own.run, runKm: own.runKm, note: own.note, custom: true };
  const tpl = valueAt(d.settings, 'weekTemplate', iso(weekStart(fromIso(isoDate)))) || DEFAULT_TEMPLATE;
  const slot = parseSlot(tpl[(fromIso(isoDate).getDay() + 6) % 7]);
  return { ...slot, runKm: null, note: '', custom: false };
}

export async function getWeekGoal(weekStartIso) {
  const d = load();
  const own = d.weeks.find((w) => w.weekStart === weekStartIso);
  return {
    runGoalKm: own?.runGoalKm ?? valueAt(d.settings, 'runGoalKm', weekStartIso),
    weightsGoal: own?.weightsGoal ?? valueAt(d.settings, 'weightsGoal', weekStartIso),
    custom: !!own,
  };
}

/**
 * One week with plan, what was done, and each day's run target. The weekly goal is
 * split evenly over the planned run days (a distance set by hand is taken off first)
 * and stays fixed: running more or less one day never moves the other days. Each week
 * stands alone; a shortfall is shown, never carried over.
 */
export async function getWeek(anchor) {
  const d = load();
  const start = weekStart(anchor);
  const todayIso = iso(today());
  const goal = await getWeekGoal(iso(start));
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i);
    const key = iso(day);
    const workout = d.workouts.find((w) => w.date === key) || null;
    const runKm = d.runs.filter((r) => r.date === key).reduce((s, r) => s + r.distanceKm, 0);
    return { date: day, iso: key, plan: planFor(key), workout, runKm, past: key < todayIso, isToday: key === todayIso };
  });
  const doneKm = days.reduce((s, x) => s + x.runKm, 0);
  const runDays = days.filter((x) => x.plan.run);
  const fixed = runDays.filter((x) => x.plan.runKm).reduce((s, x) => s + x.plan.runKm, 0);
  const auto = runDays.filter((x) => !x.plan.runKm);
  const perAuto = auto.length ? Math.max(0, goal.runGoalKm - fixed) / auto.length : 0;
  days.forEach((x) => {
    // kept exact so the week adds up to the goal; screens round when they show it
    x.runTargetKm = !x.plan.run ? 0 : (x.plan.runKm || perAuto);
  });
  const ended = !days[6].past ? false : true;
  return Object.assign(days, {
    goal, doneKm, ended,
    // positive = still short of the goal, negative = past it
    gapKm: Math.round((goal.runGoalKm - doneKm) * 10) / 10,
    plannedKm: days.reduce((s, x) => s + x.runTargetKm, 0),
    weightsPlanned: days.filter((x) => x.plan.weights).length,
    weightsDone: days.filter((x) => x.workout).length,
    runsPlanned: days.filter((x) => x.plan.run).length,
    runsDone: days.filter((x) => x.runKm > 0).length,
  });
}

// Change one day. Passing null puts the day back on the usual week.
export async function setPlan(isoDate, plan) {
  const d = load();
  d.plan = d.plan.filter((p) => p.date !== isoDate);
  if (plan) d.plan.push({ date: isoDate, weights: plan.weights || null, run: !!plan.run, runKm: plan.runKm || null, note: plan.note || '' });
  persist();
  remote('savePlan', plan
    ? { date: isoDate, weights: plan.weights || '', run: !!plan.run, run_km: plan.runKm || '', note: plan.note || '' }
    : { date: isoDate, clear: true });
}

export async function setWeekGoal(weekStartIso, { runGoalKm, weightsGoal }) {
  const d = load();
  d.weeks = d.weeks.filter((w) => w.weekStart !== weekStartIso);
  d.weeks.push({ weekStart: weekStartIso, runGoalKm, weightsGoal });
  persist();
  remote('saveWeek', { week_start: weekStartIso, run_goal_km: runGoalKm, weights_goal: weightsGoal });
}

const SETTING_KEYS = { runGoalKm: 'run_goal_km', weightsGoal: 'weights_goal', defaultSets: 'default_sets', defaultReps: 'default_reps', weightStepKg: 'weight_step_kg', targetWeightKg: 'target_weight_kg', weekTemplate: 'week_template', restSeconds: 'rest_seconds', routineUpper: 'routine_upper', routineLower: 'routine_lower' };
export async function saveSettings(patch) {
  const d = load();
  const from = iso(weekStart(today()));
  d.settings.history ||= {};
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify(v) === JSON.stringify(d.settings[k])) { delete patch[k]; continue; }
    if (HISTORY_KEYS.includes(k)) {
      // the first change keeps what applied before it for all earlier weeks
      let hist = d.settings.history[k] || [];
      if (!hist.length) hist = [{ from: '0000-00-00', value: d.settings[k] }];
      d.settings.history[k] = hist.filter((h) => h.from !== from).concat({ from, value: v });
    }
  }
  Object.assign(d.settings, patch);
  persist();
  for (const [k, v] of Object.entries(patch)) {
    if (!SETTING_KEYS[k]) continue;
    const value = HISTORY_KEYS.includes(k) ? serialise(d.settings.history[k]) : Array.isArray(v) ? v.join(',') : (v ?? '');
    remote('saveSetting', { key: SETTING_KEYS[k], value });
  }
}

// Copy every day of one week onto the next, as changed days.
export async function copyWeek(fromStartIso) {
  const from = fromIso(fromStartIso);
  for (let i = 0; i < 7; i++) {
    const p = planFor(iso(addDays(from, i)));
    await setPlan(iso(addDays(from, i + 7)), { weights: p.weights, run: p.run, runKm: p.runKm, note: '' });
  }
}

export async function resetRange(fromIsoDate, toIsoDate) {
  const d = load();
  const hits = d.plan.filter((p) => p.date >= fromIsoDate && p.date <= toIsoDate).map((p) => p.date);
  for (const date of hits) await setPlan(date, null);
  return hits.length;
}

export async function getWorkoutOn(isoDate) {
  const d = load();
  const w = d.workouts.find((x) => x.date === isoDate);
  if (!w) return null;
  const sets = d.sets.filter((s) => s.workoutId === w.id);
  return { ...w, machines: new Set(sets.map((s) => s.machineId)).size, sets: sets.length };
}

export async function getBodySeries() {
  return [...load().body].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function getDraft(isoDate) { return load().drafts[isoDate] || null; }
export async function saveDraft(isoDate, draft) { load().drafts[isoDate] = draft; persist(); }

// Writes one workout row plus its set rows. Only sets marked done are kept.
export async function saveWorkout({ date, type, note, entries }) {
  const d = load();
  const w = { id: uid('w'), date, type, note };
  const newSets = [];
  const prs = [];
  let count = 0;
  for (const e of entries) {
    const done = e.sets.filter((s) => s.done);
    if (!done.length) continue;
    const best = await getBestWeight(e.machineId);
    const top = Math.max(...done.map((s) => s.weightKg));
    if (best > 0 && top > best) prs.push({ machineId: e.machineId, kg: top });
    done.forEach((s, i) => {
      newSets.push({ id: `${w.id}-${count}`, workoutId: w.id, machineId: e.machineId, setNo: i + 1, weightKg: s.weightKg, reps: s.reps, note: i === 0 ? e.note : '' });
      count++;
    });
  }
  const replaced = new Set(d.workouts.filter((x) => x.date === date).map((x) => x.id));
  d.workouts = d.workouts.filter((x) => !replaced.has(x.id));
  d.sets = d.sets.filter((s) => !replaced.has(s.workoutId)).concat(newSets);
  d.workouts.push(w);
  delete d.drafts[date];
  persist();
  remote('saveWorkout', {
    workout: { id: w.id, date, type, note: note || '' },
    sets: newSets.map((x) => ({ id: x.id, workout_id: x.workoutId, machine_id: x.machineId, set_no: x.setNo, weight_kg: x.weightKg, reps: x.reps, note: x.note })),
  });
  return { workout: w, sets: count, prs };
}

// Today's saved workout rebuilt as editable entries, so reopening the log edits it.
export async function getWorkoutEntries(isoDate) {
  const d = load();
  const w = d.workouts.find((x) => x.date === isoDate);
  if (!w) return null;
  const entries = [];
  for (const s of d.sets.filter((x) => x.workoutId === w.id).sort((a, b) => a.setNo - b.setNo)) {
    let e = entries.find((x) => x.machineId === s.machineId);
    if (!e) { e = { machineId: s.machineId, note: s.note || '', sets: [], active: 0 }; entries.push(e); }
    e.sets.push({ weightKg: s.weightKg, reps: s.reps, done: true });
  }
  return { date: isoDate, type: w.type, dayNote: w.note, entries, current: entries[0]?.machineId || null };
}

// ---------- runs ----------
export async function getRuns() {
  return [...load().runs].sort((a, b) => (a.date < b.date ? -1 : 1));
}
export async function getRunOn(isoDate) {
  return load().runs.find((r) => r.date === isoDate) || null;
}
// One run per day: saving again replaces that day's run.
export async function saveRun({ date, distanceKm, durationMin, speedKmh = null, incline = null, note = '' }) {
  const d = load();
  d.runs = d.runs.filter((r) => r.date !== date);
  const row = { id: uid('r'), date, distanceKm, durationMin, speedKmh, incline, note };
  d.runs.push(row);
  persist();
  remote('saveRun', { id: row.id, date, distance_km: distanceKm, duration_min: durationMin, speed_kmh: speedKmh, incline, note });
  return row;
}

// ---------- body ----------
export async function getBodyOn(isoDate) {
  return load().body.find((b) => b.date === isoDate) || null;
}
export async function saveBody({ date, weightKg, waistCm = null, note = '' }) {
  const d = load();
  d.body = d.body.filter((b) => b.date !== date);
  const row = { id: uid('b'), date, weightKg, waistCm, note };
  d.body.push(row);
  persist();
  remote('saveBody', { id: row.id, date, weight_kg: weightKg, waist_cm: waistCm, note });
  return row;
}

// ---------- machines ----------
export async function getAllMachines() { return [...load().machines]; }
export async function updateMachine(id, patch) {
  const m = load().machines.find((x) => x.id === id);
  if (!m) return null;
  Object.assign(m, patch);
  persist();
  remote('updateMachine', machineRow(m));
  return { ...m };
}

// ---------- analytics ----------
// Per-day sessions for one machine: top weight and volume (weight x reps, summed over sets).
export async function getMachineHistory(machineId) {
  const d = load();
  const byId = new Map(d.workouts.map((w) => [w.id, w.date]));
  const days = new Map();
  for (const s of d.sets.filter((x) => x.machineId === machineId)) {
    const date = byId.get(s.workoutId);
    if (!date) continue;
    const row = days.get(date) || { date, topKg: 0, volume: 0, sets: 0 };
    row.topKg = Math.max(row.topKg, s.weightKg);
    row.volume += s.weightKg * s.reps;
    row.sets += 1;
    days.set(date, row);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
export async function getWorkouts() {
  return [...load().workouts].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Machines of one group in routine order: [routine..., the rest of the group...].
export async function getRoutine(group) {
  const d = load();
  const active = d.machines.filter((m) => m.active && m.group === group);
  const ids = d.settings[group === 'upper' ? 'routineUpper' : 'routineLower'];
  const order = ids ? ids.filter((id) => active.some((m) => m.id === id)) : active.map((m) => m.id);
  return { routine: order, others: active.map((m) => m.id).filter((id) => !order.includes(id)) };
}
export async function setRoutine(group, ids) {
  await saveSettings({ [group === 'upper' ? 'routineUpper' : 'routineLower']: ids });
}
