// Google Sheets link (Apps Script web app in backend/Code.gs).
// The URL and token are entered once on the Settings screen and kept on this device
// only, never in the code, because the app files are public once hosted.

const CONN = 'phealth.remote.v1';
const QUEUE = 'phealth.queue.v1';

const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

export function connection() { return read(CONN, null); }
export function setConnection(c) { if (c) write(CONN, c); else { try { localStorage.removeItem(CONN); } catch { /* */ } } }
export function pendingCount() { return read(QUEUE, []).length; }

// Apps Script can take many seconds on a cold start, and a write often finishes in the
// sheet before its reply arrives. Reads give up sooner than writes.
const READ_TIMEOUT_MS = 60000;
const WRITE_TIMEOUT_MS = 60000;
const RETRY_MS = 30000;

async function call(conn, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(init ? conn.url : `${conn.url}?token=${encodeURIComponent(conn.token)}`, { ...init, signal: ctl.signal });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'timeout' : 'offline');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`http_${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'failed');
  return body.data;
}

export async function fetchAll(conn = connection()) {
  return call(conn);
}

// POST as text/plain: Apps Script cannot answer a CORS preflight, and text/plain needs none.
export async function post(action, payload, conn = connection()) {
  return call(conn, { method: 'POST', body: JSON.stringify({ token: conn.token, action, payload }) });
}

// Writes go through a queue kept on the phone, so a dropped connection never loses a set.
let flushing = null;
let retryTimer = null;
const listeners = new Set();
export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = (state) => listeners.forEach((fn) => fn(state));

export function enqueue(action, payload) {
  const q = read(QUEUE, []);
  q.push({ action, payload, at: Date.now() });
  write(QUEUE, q);
  return flush();
}

export function flush() {
  if (flushing) return flushing;
  const conn = connection();
  if (!conn) return Promise.resolve({ ok: true, pending: 0 });
  flushing = (async () => {
    let q = read(QUEUE, []);
    notify({ state: 'syncing', pending: q.length });
    const kept = [];
    let lastError = null;
    while (q.length) {
      const item = q[0];
      try {
        await post(item.action, item.payload, conn);
      } catch (err) {
        lastError = String(err.message || err);
        // No connection: stop and retry later. Every write is safe to send twice.
        if (/^(timeout|offline|http_)/.test(lastError)) {
          write(QUEUE, kept.concat(read(QUEUE, [])));
          notify({ state: 'error', pending: pendingCount(), error: lastError });
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => flush(), RETRY_MS);
          return { ok: false, pending: pendingCount() };
        }
        // The sheet refused this one (for example an older script that does not know
        // the action yet): keep it for later, but do not hold up the writes behind it.
        kept.push(item);
      }
      q = read(QUEUE, []).slice(1);
      write(QUEUE, q);
    }
    write(QUEUE, kept.concat(read(QUEUE, [])));
    const pending = pendingCount();
    notify(pending ? { state: 'error', pending, error: lastError } : { state: 'synced', pending: 0 });
    return { ok: !pending, pending };
  })().finally(() => { flushing = null; });
  return flushing;
}

if (typeof window !== 'undefined') window.addEventListener('online', () => flush());
