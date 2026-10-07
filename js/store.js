// Mock data repository. Every function is async and returns plain rows shaped like
// the Google Sheets tabs in SPEC.md (machines, workouts, sets, runs, body, settings),
// so swapping this file for a Sheets client later does not touch the screens.
// Machines are referenced by id everywhere, so renaming never loses history.

import { connection, fetchAll, enqueue, flush } from './remote.js';

const KEY = 'phealth.mock.v1';
const CACHE = 'phealth.cache.v1';
// Short unique ids so two phones (or a retry) never collide in the sheet.
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const SCHEDULE = { 0: 'rest', 1: 'upper', 2: 'lower', 3: 'rest', 4: 'upper', 5: 'lower', 6: 'rest' };

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
    settings: { runGoalKm: 15, runPerSessionKm: 3, defaultSets: 3, defaultReps: 12, weightStepKg: 2.5, targetWeightKg: null },
    machines: CATALOG.map(([id, name, group, muscleKey]) => ({ id, name, group, muscleKey, muscle: '', photoUrl: '', active: true })),
    workouts: [], sets: [], runs: [], body: [], drafts: {},
  };
  const base = Object.fromEntries(CATALOG.map(([id, , , , kg]) => [id, kg]));
  const upperDay = ['m01', 'm04', 'm03', 'm05', 'm07'];
  const lowerDay = ['m08', 'm09', 'm10', 'm11', 'm13'];
  let wid = 1, sid = 1, rid = 1, bid = 1;

  for (let back = 35; back >= 1; back--) {
    const d = addDays(todayDate, -back);
    const plan = SCHEDULE[d.getDay()];
    const weeksAgo = Math.floor(back / 7);
    if (plan !== 'rest' && rand() > 0.08) {
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
    if (plan === 'rest' && d.getDay() === 6 && rand() > 0.3) {
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
      runGoalKm: n(st.run_goal_km) ?? 15, runPerSessionKm: n(st.run_per_session_km) ?? 3,
      defaultSets: n(st.default_sets) ?? 3, defaultReps: n(st.default_reps) ?? 12,
      weightStepKg: n(st.weight_step_kg) ?? 2.5, targetWeightKg: n(st.target_weight_kg),
    },
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
  if (!r.ok) db = { settings: { runGoalKm: 15, runPerSessionKm: 3, defaultSets: 3, defaultReps: 12, weightStepKg: 2.5, targetWeightKg: null }, machines: [], workouts: [], sets: [], runs: [], body: [], drafts: {} };
  return { mode, fresh: r.ok, error: r.error };
}

async function refresh() {
  try {
    await flush();
    const fresh = fromSheets(await fetchAll());
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

export async function getWeek(anchor) {
  const d = load();
  const start = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i);
    const key = iso(day);
    const workout = d.workouts.find((w) => w.date === key) || null;
    const runKm = d.runs.filter((r) => r.date === key).reduce((s, r) => s + r.distanceKm, 0);
    return { date: day, iso: key, plan: SCHEDULE[day.getDay()], workout, runKm };
  });
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
