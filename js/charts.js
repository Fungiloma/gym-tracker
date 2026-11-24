// Gráficas SVG propias, sin librerías. Se crean con createElementNS y atributos (sin HTML como texto ni
// style inline: la CSP lo prohíbe); los colores salen de clases en css/app.css.
const NS = 'http://www.w3.org/2000/svg';
export const W = 320;
export const H = 180;
const PAD = { l: 44, r: 10, t: 10, b: 24 };

// Escala "bonita": ticks redondos que cubren [min, max].
export function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const compact = n => (Math.abs(n) >= 10_000 ? `${Math.round(n / 1000)}k` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(Math.round(n * 10) / 10).replace('.', ','));

// Geometría de una gráfica de líneas. series: [{ name, cls, points: [{ x, y }] }]. Devuelve coordenadas listas.
export function lineGeometry(series, { zeroBase = false } = {}) {
  const pts = series.flatMap(s => s.points);
  if (!pts.length) return null;
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const ticks = niceTicks(zeroBase ? Math.min(0, ...ys) : Math.min(...ys), Math.max(...ys));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const px = x => PAD.l + (xMax === xMin ? iw / 2 : ((x - xMin) / (xMax - xMin)) * iw);
  const py = y => PAD.t + ih - (yMax === yMin ? ih / 2 : ((y - yMin) / (yMax - yMin)) * ih);
  return {
    ticks: ticks.map(t => ({ value: t, y: py(t) })),
    series: series.map(s => ({ ...s, coords: s.points.map(p => ({ x: px(p.x), y: py(p.y), value: p.y })) })),
    xMin,
    xMax,
  };
}

// Geometría de barras: [{ label, value }] → [{ label, value, x, y, w, h }] y ticks.
export function barGeometry(bars) {
  if (!bars.length) return null;
  const max = Math.max(...bars.map(b => b.value), 0);
  const ticks = niceTicks(0, max || 1);
  const yMax = ticks[ticks.length - 1];
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / bars.length;
  const w = Math.min(slot * 0.65, 36);
  return {
    ticks: ticks.map(t => ({ value: t, y: PAD.t + ih - (t / yMax) * ih })),
    bars: bars.map((b, i) => {
      const h = (b.value / yMax) * ih;
      return { label: b.label, value: b.value, x: PAD.l + slot * i + (slot - w) / 2, y: PAD.t + ih - h, w, h };
    }),
  };
}

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function frame(title, desc) {
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': title, focusable: 'false' });
  svg.append(el('title', {}, title), el('desc', {}, desc));
  return svg;
}

function grid(svg, ticks) {
  for (const t of ticks) {
    svg.append(
      el('line', { class: 'chart-grid', x1: PAD.l, x2: W - PAD.r, y1: t.y, y2: t.y }),
      el('text', { class: 'chart-label', x: PAD.l - 6, y: t.y + 3, 'text-anchor': 'end' }, compact(t.value)),
    );
  }
}

// series: [{ name, cls, points: [{ x: ts, y }] }]; xLabel(ts) da el texto del eje X (primer y último punto).
export function lineChart(series, { title, xLabel, zeroBase = false } = {}) {
  const g = lineGeometry(series, { zeroBase });
  if (!g) return null;
  const total = series.reduce((n, s) => n + s.points.length, 0);
  const svg = frame(title, `${series.map(s => s.name).join(', ')}: ${total} puntos`);
  grid(svg, g.ticks);
  for (const s of g.series) {
    if (s.coords.length > 1) {
      svg.append(el('polyline', { class: `chart-line ${s.cls}`, fill: 'none', points: s.coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ') }));
    }
    for (const c of s.coords) svg.append(el('circle', { class: `chart-dot ${s.cls}`, cx: c.x.toFixed(1), cy: c.y.toFixed(1), r: 3 }));
  }
  const bottom = H - 6;
  svg.append(el('text', { class: 'chart-label', x: PAD.l, y: bottom, 'text-anchor': 'start' }, xLabel(g.xMin)));
  if (g.xMax !== g.xMin) svg.append(el('text', { class: 'chart-label', x: W - PAD.r, y: bottom, 'text-anchor': 'end' }, xLabel(g.xMax)));
  return svg;
}

// bars: [{ label, value }]
export function barChart(bars, { title, cls = 'chart-bar' } = {}) {
  const g = barGeometry(bars);
  if (!g) return null;
  const svg = frame(title, `${bars.length} barras, máximo ${compact(Math.max(...bars.map(b => b.value)))}`);
  grid(svg, g.ticks);
  for (const b of g.bars) {
    if (b.h > 0) svg.append(el('rect', { class: cls, x: b.x.toFixed(1), y: b.y.toFixed(1), width: b.w.toFixed(1), height: b.h.toFixed(1), rx: 2 }));
    svg.append(el('text', { class: 'chart-label', x: (b.x + b.w / 2).toFixed(1), y: H - 6, 'text-anchor': 'middle' }, b.label));
  }
  return svg;
}
