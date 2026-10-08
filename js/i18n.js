// All UI text lives in i18n/<locale>.json. Screens only ever call t().
// Adding Thai later = add i18n/th.json and call setLocale('th').

let dict = {};
let locale = 'en';

// The language is a per-phone choice, so it lives on the device, not in the sheet.
const LANG_KEY = 'phealth.lang';
export function savedLocale() {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'th' || v === 'en') return v; } catch { /* storage blocked */ }
  return 'en';
}
export function chooseLocale(next) {
  try { localStorage.setItem(LANG_KEY, next); } catch { /* storage blocked */ }
}
export const currentLocale = () => locale;

export async function setLocale(next) {
  const res = await fetch(`i18n/${next}.json`);
  dict = await res.json();
  locale = next;
  document.documentElement.lang = next;
}

export function t(key, vars = {}) {
  const raw = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
  if (typeof raw !== 'string') return key;
  return raw.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? vars[name] : `{${name}}`));
}

// Plural-aware lookup: picks "<key>_one" or "<key>_other" by the locale's plural rules.
export function tc(key, count, vars = {}) {
  const form = new Intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other';
  return t(`${key}_${form}`, { count, ...vars });
}

export function has(key) {
  return typeof key.split('.').reduce((o, k) => (o ? o[k] : undefined), dict) === 'string';
}

const fmtCache = new Map();
function fmt(opts) {
  const id = locale + JSON.stringify(opts);
  if (!fmtCache.has(id)) fmtCache.set(id, new Intl.DateTimeFormat(locale, opts));
  return fmtCache.get(id);
}

export const dateFmt = {
  long: (d) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d),
  short: (d) => fmt({ day: 'numeric', month: 'short' }).format(d),
  weekday: (d) => fmt({ weekday: 'long' }).format(d),
  weekdayShort: (d) => fmt({ weekday: 'short' }).format(d),
  weekdayNarrow: (d) => fmt({ weekday: 'narrow' }).format(d),
  day: (d) => fmt({ day: 'numeric' }).format(d),
};

export function num(n, digits = 1) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}

// "78.4" -> 78<span class="dec">.4</span>: the decimals sit smaller, as in ref-01.
export function numHtml(n, digits = 1) {
  const parts = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).formatToParts(n);
  const i = parts.findIndex((x) => x.type === 'decimal');
  const join = (a) => a.map((x) => x.value).join('');
  return i === -1 ? join(parts) : `${join(parts.slice(0, i))}<span class="dec">${join(parts.slice(i))}</span>`;
}
