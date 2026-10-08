import { setLocale, savedLocale, t } from './i18n.js';
import { icon } from './icons.js';
import { renderHome } from './screens/home.js';
import { renderLog } from './screens/log.js';
import { renderRun } from './screens/run.js';
import { renderBody } from './screens/body.js';
import { renderAnalytics } from './screens/analytics.js';
import { renderMachines } from './screens/machines.js';
import { renderSettings } from './screens/settings.js';
import { renderPlan } from './screens/plan.js';
import { renderSummary } from './screens/summary.js';
import { init } from './store.js';
import { toast } from './ui.js';

const ROUTES = {
  '/': { key: 'home', icon: 'home', render: renderHome },
  '/log': { key: 'log', icon: 'log', render: renderLog },
  '/analytics': { key: 'analytics', icon: 'chart', render: renderAnalytics },
  '/machines': { key: 'machines', icon: 'dumbbell', render: renderMachines },
};
// Sub-screens that live under a bottom-nav tab.
const SUB = {
  '/log/run': { key: 'log', render: renderRun },
  '/log/body': { key: 'log', render: renderBody },
  '/settings': { key: 'home', render: renderSettings },
  '/plan': { key: 'home', render: renderPlan },
  '/summary': { key: 'analytics', render: renderSummary },
};

const main = document.getElementById('main');
const nav = document.getElementById('nav');
function renderNav(active) {
  nav.innerHTML = `<ul>${Object.entries(ROUTES).map(([path, r]) => `
    <li><a href="#${path}" class="nav-item" ${r.key === active ? 'aria-current="page"' : ''}>
      ${icon(r.icon)}<span>${t(`nav.${r.key}`)}</span>
    </a></li>`).join('')}</ul>`;
}

async function route() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const r = ROUTES[path] || SUB[path] || ROUTES['/'];
  renderNav(r.key);
  main.setAttribute('aria-busy', 'true');
  await r.render(main);
  main.removeAttribute('aria-busy');
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

await setLocale(savedLocale());
const boot = await init();
if (boot.mode === 'sheets' && !boot.fresh && !boot.cached) toast(t('settings.loadError'));
// Fresh rows from the sheet arrived after a start from the phone's copy: redraw read-only
// screens, but never under someone who is mid-entry on a log screen.
window.addEventListener('phealth:data', (e) => {
  if (!e.detail.ok) { toast(t('settings.loadError')); return; }
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  if (['/', '/analytics', '/machines'].includes(path)) route();
});
document.title = t('app.name');
nav.setAttribute('aria-label', t('nav.label'));
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
