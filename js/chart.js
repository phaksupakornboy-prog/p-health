// Small SVG charts drawn at the container's real pixel width (no stretched text).
// Rules from the dataviz guidance: one y-axis per chart, 2px lines, dotted recessive
// grid, values in text ink (never series colour), crosshair + tooltip on hover/touch,
// and every chart ships a table view next to it.
import { esc } from './ui.js';

const PAD = { top: 12, right: 44, bottom: 24, left: 4 };

function niceTicks(min, max, count = 3) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step = 10 ** Math.floor(Math.log10(span / count));
  const err = (span / count) / step;
  const nice = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * step;
  const lo = Math.floor(min / nice) * nice;
  const hi = Math.ceil(max / nice) * nice;
  const ticks = [];
  for (let v = lo; v <= hi + nice / 2; v += nice) ticks.push(+v.toFixed(6));
  return ticks;
}

/**
 * mount(el, spec) draws into el and redraws on resize.
 * spec: {
 *   kind: 'line' | 'bar',
 *   series: [{ key, label, cls, points: [{ x: number(ms), y: number, label?: string }], dots?: boolean, marks?: Set<index> }],
 *   yFmt: (v) => string, xFmt: (ms) => string, tipFmt: (seriesLabel, point) => string,
 *   goal?: { y, label }, height?: number, yMin?: number
 * }
 */
export function mount(el, spec) {
  const draw = () => {
    const w = Math.max(240, el.clientWidth);
    el.innerHTML = render(w, spec);
    wire(el, w, spec);
  };
  draw();
  if ('ResizeObserver' in window) {
    let last = el.clientWidth;
    new ResizeObserver(() => { if (Math.abs(el.clientWidth - last) > 4) { last = el.clientWidth; draw(); } }).observe(el);
  }
}

function geometry(w, spec) {
  const h = spec.height || 168;
  const all = spec.series.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y).concat(spec.goal ? [spec.goal.y] : []);
  const ticks = niceTicks(spec.yMin ?? Math.min(...ys), Math.max(...ys), h < 150 ? 2 : 3);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const iw = w - PAD.left - PAD.right, ih = h - PAD.top - PAD.bottom;
  const band = spec.kind === 'bar' ? iw / Math.max(1, new Set(xs).size) : 0;
  const X = (x) => spec.kind === 'bar'
    ? PAD.left + band * ([...new Set(xs)].sort((a, b) => a - b).indexOf(x) + 0.5)
    : PAD.left + (xMax === xMin ? iw / 2 : ((x - xMin) / (xMax - xMin)) * iw);
  const Y = (y) => PAD.top + (1 - (y - y0) / (y1 - y0)) * ih;
  return { h, ticks, X, Y, iw, ih, band, xMin, xMax };
}

function render(w, spec) {
  const g = geometry(w, spec);
  const grid = g.ticks.map((tv) => `
    <line class="c-grid" x1="${PAD.left}" x2="${w - PAD.right}" y1="${g.Y(tv).toFixed(1)}" y2="${g.Y(tv).toFixed(1)}"/>
    <text class="c-axis" x="${w - PAD.right + 8}" y="${(g.Y(tv) + 4).toFixed(1)}">${esc(spec.yFmt(tv))}</text>`).join('');
  const xs = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const xLabels = xs.length ? [xs[0], xs[xs.length - 1]].filter((v, i, a) => a.indexOf(v) === i).map((x, i, arr) => `
    <text class="c-axis" x="${g.X(x).toFixed(1)}" y="${g.h - 6}" text-anchor="${arr.length === 1 ? 'middle' : i === 0 ? 'start' : 'end'}">${esc(spec.xFmt(x))}</text>`).join('') : '';
  let marks = '';
  if (spec.kind === 'bar') {
    const s = spec.series[0];
    const bw = Math.max(6, Math.min(28, g.band - 6));
    marks = s.points.map((p) => {
      const x = g.X(p.x) - bw / 2, y = g.Y(Math.max(p.y, 0)), base = g.Y(g.ticks[0]);
      const hgt = Math.max(0, base - y);
      const r = Math.min(4, bw / 2, hgt);
      // 4px rounded data end, square at the baseline
      return `<path class="c-bar ${s.cls} ${p.dim ? 'is-dim' : ''}" d="M${x.toFixed(1)} ${base.toFixed(1)} V${(y + r).toFixed(1)} Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)} H${(x + bw - r).toFixed(1)} Q${(x + bw).toFixed(1)} ${y.toFixed(1)} ${(x + bw).toFixed(1)} ${(y + r).toFixed(1)} V${base.toFixed(1)} Z"/>`;
    }).join('');
  } else {
    marks = spec.series.map((s) => {
      if (!s.points.length) return '';
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${g.X(p.x).toFixed(1)} ${g.Y(p.y).toFixed(1)}`).join(' ');
      const area = s.area ? `<path class="c-area ${s.cls}" d="${d} L${g.X(s.points[s.points.length - 1].x).toFixed(1)} ${g.Y(g.ticks[0]).toFixed(1)} L${g.X(s.points[0].x).toFixed(1)} ${g.Y(g.ticks[0]).toFixed(1)} Z"/>` : '';
      const dots = s.dots ? s.points.map((p) => `<circle class="c-dot ${s.cls}" cx="${g.X(p.x).toFixed(1)}" cy="${g.Y(p.y).toFixed(1)}" r="2.5"/>`).join('') : '';
      const flags = s.marks ? [...s.marks].map((i) => s.points[i]).filter(Boolean).map((p) => `<circle class="c-flag ${s.cls}" cx="${g.X(p.x).toFixed(1)}" cy="${g.Y(p.y).toFixed(1)}" r="5"/>`).join('') : '';
      return `${area}<path class="c-line ${s.cls} ${s.thin ? 'is-thin' : ''}" d="${d}"/>${dots}${flags}`;
    }).join('');
  }
  const goal = spec.goal ? `<line class="c-goal" x1="${PAD.left}" x2="${w - PAD.right}" y1="${g.Y(spec.goal.y).toFixed(1)}" y2="${g.Y(spec.goal.y).toFixed(1)}"/>
    <text class="c-goal-label" x="${PAD.left + 4}" y="${(g.Y(spec.goal.y) - 6).toFixed(1)}">${esc(spec.goal.label)}</text>` : '';
  return `<svg class="chart-svg" width="${w}" height="${g.h}" viewBox="0 0 ${w} ${g.h}" aria-hidden="true" focusable="false">
    ${grid}${xLabels}${goal}${marks}
    <line class="c-cross" x1="0" x2="0" y1="${PAD.top}" y2="${g.h - PAD.bottom}" visibility="hidden"/>
    <g class="c-hover"></g>
    <rect class="c-hit" x="0" y="0" width="${w}" height="${g.h}" fill="transparent"/>
  </svg><div class="chart-tip" hidden></div>`;
}

function wire(el, w, spec) {
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.chart-tip');
  const cross = svg.querySelector('.c-cross');
  const hover = svg.querySelector('.c-hover');
  const g = geometry(w, spec);
  const xs = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  if (!xs.length) return;
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = clientX - r.left;
    let best = xs[0];
    for (const x of xs) if (Math.abs(g.X(x) - px) < Math.abs(g.X(best) - px)) best = x;
    const cx = g.X(best);
    if (spec.kind !== 'bar') { cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible'); }
    const rows = spec.series.map((s) => ({ s, p: s.points.find((p) => p.x === best) })).filter((o) => o.p);
    hover.innerHTML = spec.kind === 'bar' ? '' : rows.map(({ s, p }) => `<circle class="c-hot ${s.cls}" cx="${cx}" cy="${g.Y(p.y)}" r="5"/>`).join('');
    tip.innerHTML = `<p class="chart-tip-date">${esc(spec.xFmt(best))}</p>${rows.map(({ s, p }) => `<p><span class="key ${s.cls}"></span>${esc(spec.tipFmt(s.label, p))}</p>`).join('')}`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.insetInlineStart = `${Math.min(Math.max(0, cx - tw / 2), w - tw)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); hover.innerHTML = ''; };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
}

// A disclosure with the same numbers as a table: the chart's text alternative.
export function tableHtml(summary, head, rows) {
  return `<details class="chart-table"><summary>${esc(summary)}</summary>
    <div class="table-scroll"><table><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
