// Pestañas de la pantalla de historial: sesiones, ejercicios, gráficas, calendario y cuerpo.
// Funciones de render sin estado propio: reciben el estado de vista y los datos.
import { h, renderHistory, formatDate } from './views.js';
import { lineChart, barChart } from './charts.js';
import { formatSeriesLine, fieldsForExerciseId, BODY_FIELDS } from './data.js';
import { kgToDisplay, unitLabel, fmtWeightNum } from './units.js';
import { muscleVolume, undertrained, MIN_WEEKLY_SETS } from './progress.js';
import {
  listExercises, exerciseProgress, exerciseBests, weeklyStats, weekStreaks, calendarMonth,
  buildWeeklySummary, bodySeries, fmtKg, displayWeight, pairsWeightReps, todayKey, addWeeks, weekStart, keyToTs,
} from './stats.js';

export const TABS = [
  ['sessions', 'Sesiones'],
  ['exercises', 'Ejercicios'],
  ['trends', 'Gráficas'],
  ['muscles', 'Músculos'],
  ['calendar', 'Calendario'],
  ['body', 'Cuerpo'],
];

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const shortDay = ts => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function empty(emoji, title, text) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-state-emoji' }, emoji),
    h('div', { class: 'empty-state-title' }, title),
    text ? h('div', { class: 'empty-state-text' }, text) : null,
  );
}

function card(title, ...children) {
  return h('section', { class: 'stat-card' }, h('div', { class: 'stat-title' }, title), ...children);
}

// Texto normalizado de cada sesión, calculado una vez (las sesiones no cambian): normalizar miles de
// textos en cada tecla era el grueso del coste de buscar.
const searchTexts = new WeakMap();

function searchText(s) {
  let text = searchTexts.get(s);
  if (text === undefined) {
    text = [s.name, s.notes, ...s.exercises.flatMap(ex => [ex.name, ex.notes])].map(norm).join('\n');
    searchTexts.set(s, text);
  }
  return text;
}

export function filterSessions(sessions, search, plan) {
  const q = norm(search || '').trim();
  return sessions.filter(s => {
    if (plan && s.planSessionId !== plan) return false;
    return !q || searchText(s).includes(q);
  });
}

// ==================== EJERCICIOS ====================
function bestsGrid(b) {
  const cell = (label, value) => h('div', { class: 'best-cell' }, h('div', { class: 'best-value' }, value), h('div', { class: 'best-label' }, label));
  return h('div', { class: 'best-grid' },
    cell('Peso máx.', `${fmtWeightNum(b.weight)} ${unitLabel()}`),
    cell('1RM estimado', b.oneRM > 0 ? `${displayWeight(b.oneRM)} ${unitLabel()}` : '—'),
    cell('Reps máx.', String(b.maxReps)),
    cell('Volumen máx.', `${fmtKg(b.volume)} ${unitLabel()}`),
  );
}

function exerciseDetail(state, data) {
  const id = state.exerciseId;
  const info = listExercises(data.sessions).find(e => e.id === id);
  const back = h('button', { class: 'btn btn-secondary mb-16', dataset: { action: 'clear-exercise' } }, '← Todos los ejercicios');
  if (!info) return [back, empty('🔍', 'Ejercicio sin historial')];

  const out = [back, h('div', { class: 'detail-title' }, info.name)];
  if (pairsWeightReps(id)) {
    const bests = exerciseBests(data.sessions, id);
    const progress = exerciseProgress(data.sessions, id);
    if (bests && progress.length) {
      out.push(card('Mejores marcas', bestsGrid(bests)));
      const chart = lineChart([
        { name: '1RM estimado', cls: 'series-a', points: progress.filter(p => p.best1RM !== null).map(p => ({ x: p.ts, y: displayWeight(p.best1RM) })) },
        { name: 'Peso máximo', cls: 'series-b', points: progress.map(p => ({ x: p.ts, y: kgToDisplay(p.topWeight) })) },
      ], { title: `Progresión de ${info.name}`, xLabel: shortDay });
      out.push(card(`Progresión (${unitLabel()})`, chart, h('div', { class: 'chart-legend' },
        h('span', { class: 'legend-a' }, '1RM estimado (Epley)'), h('span', { class: 'legend-b' }, 'Peso máximo'))));
    } else {
      out.push(empty('📈', 'Sin series válidas', 'Hacen falta series hechas con kg y reps (sin calentamiento).'));
    }
  } else {
    out.push(h('div', { class: 'info-box mb-16' }, 'Este ejercicio apunta dos movimientos por serie: no se calcula 1RM ni volumen.'));
  }

  const rows = data.sessions
    .filter(s => s.exercises.some(ex => ex.id === id))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);
  out.push(card(`Últimas ${rows.length} sesiones`, ...rows.map(s => {
    const ex = s.exercises.find(e => e.id === id);
    const fields = fieldsForExerciseId(id);
    return h('div', { class: 'exercise-item' },
      h('div', { class: 'exercise-name' }, formatDate(s.startedAt)),
      ex.series.map((x, i) => h('div', { class: 'series-line' }, formatSeriesLine(x, i, fields))),
    );
  })));
  return out;
}

function exerciseList(state, data) {
  const q = norm(state.search || '').trim();
  const list = listExercises(data.sessions).filter(e => !q || norm(e.name).includes(q));
  if (!list.length) return [empty(q ? '🔍' : '📋', q ? 'Sin resultados' : 'Sin ejercicios aún', q ? 'Prueba con otra búsqueda' : 'Completa una sesión para ver tus ejercicios')];
  return list.map(e => {
    const bests = pairsWeightReps(e.id) ? exerciseBests(data.sessions, e.id) : null;
    return h('button', { class: 'list-row', dataset: { action: 'select-exercise', id: e.id } },
      h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, e.name),
        h('span', { class: 'list-sub' }, `${e.sessions} ${e.sessions === 1 ? 'sesión' : 'sesiones'} · último ${formatDate(e.last)}`)),
      h('span', { class: 'list-side' }, bests && bests.oneRM > 0 ? `${displayWeight(bests.oneRM)} ${unitLabel()}` : ''),
    );
  });
}

// ==================== GRÁFICAS ====================
function trends(state, data, now) {
  if (!data.sessions.length) return [empty('📊', 'Sin datos todavía', 'Las gráficas aparecen al guardar tu primera sesión')];
  const weeks = weeklyStats(data.sessions, 8, now);
  const label = w => String(new Date(w.start).getDate());
  const volume = barChart(weeks.map(w => ({ label: label(w), value: Math.round(kgToDisplay(w.volume)) })), { title: `Volumen semanal en ${unitLabel()}` });
  const freq = barChart(weeks.map(w => ({ label: label(w), value: w.sessions })), { title: 'Sesiones por semana', cls: 'chart-bar alt' });

  const weekTs = addWeeks(weekStart(now), -state.weekOffset);
  const text = buildWeeklySummary(data.sessions, data.body, weekTs);
  const streak = weekStreaks(data.sessions, now);
  return [
    card(`Volumen semanal (${unitLabel()})`, volume, h('div', { class: 'chart-note' }, 'Eje X: día del mes en que empieza cada semana (lunes)')),
    card('Sesiones por semana', freq),
    card('Resumen semanal',
      h('div', { class: 'week-nav' },
        h('button', { class: 'btn btn-secondary', dataset: { action: 'summary-week', delta: '1' }, 'aria-label': 'Semana anterior' }, '‹'),
        h('div', { class: 'week-label', id: 'week-label' }, state.weekOffset === 0 ? 'Esta semana' : `Hace ${state.weekOffset} ${state.weekOffset === 1 ? 'semana' : 'semanas'}`),
        h('button', { class: 'btn btn-secondary', dataset: { action: 'summary-week', delta: '-1' }, disabled: state.weekOffset === 0, 'aria-label': 'Semana siguiente' }, '›'),
      ),
      h('pre', { class: 'summary-text', id: 'weekly-text' }, text),
      h('button', { class: 'btn btn-primary mt-10', id: 'copy-weekly', dataset: { action: 'copy-weekly' } }, '📋 Copiar resumen semanal'),
    ),
    h('div', { class: 'info-box' }, `🔥 Racha: ${streak.current} ${streak.current === 1 ? 'semana' : 'semanas'} seguidas (mejor: ${streak.best})`),
  ];
}

// ==================== CALENDARIO ====================
function calendar(state, data, now) {
  const weeks = calendarMonth(data.sessions, state.calYear, state.calMonth);
  const streak = weekStreaks(data.sessions, now);
  const today = todayKey(now);
  let inMonth = 0;
  weeks.flat().forEach(c => { if (c) inMonth += c.count; });
  return [
    h('div', { class: 'week-nav' },
      h('button', { class: 'btn btn-secondary', dataset: { action: 'cal-month', delta: '-1' }, 'aria-label': 'Mes anterior' }, '‹'),
      h('div', { class: 'week-label', id: 'cal-title' }, `${MONTH_NAMES[state.calMonth]} ${state.calYear}`),
      h('button', { class: 'btn btn-secondary', dataset: { action: 'cal-month', delta: '1' }, 'aria-label': 'Mes siguiente' }, '›'),
    ),
    h('div', { class: 'cal-grid cal-head' }, WEEKDAYS.map(d => h('div', { class: 'cal-wd' }, d))),
    h('div', { class: 'cal-grid', role: 'grid', id: 'cal-grid' }, weeks.flat().map(c => c
      ? h('div', {
        class: 'cal-day' + (c.count ? ' has' : '') + (c.key === today ? ' today' : ''),
        dataset: { date: c.key, count: String(c.count) },
        'aria-label': c.count ? `${c.day}: ${c.count} ${c.count === 1 ? 'sesión' : 'sesiones'}` : String(c.day),
      }, String(c.day))
      : h('div', { class: 'cal-day blank' }))),
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat-pill', id: 'cal-month-count' }, `${inMonth} ${inMonth === 1 ? 'entreno' : 'entrenos'} este mes`),
      h('div', { class: 'stat-pill', id: 'cal-streak' }, `🔥 Racha ${streak.current} ${streak.current === 1 ? 'semana' : 'semanas'} (mejor ${streak.best})`),
    ),
  ];
}

// ==================== MÚSCULOS ====================
function muscles(state, data, now) {
  const weekTs = addWeeks(weekStart(now), -state.weekOffset);
  const vol = muscleVolume(data.sessions, weekTs);
  const low = new Set(undertrained(vol, weekTs, now).map(r => r.id));
  const max = Math.max(MIN_WEEKLY_SETS * 2, ...vol.rows.map(r => r.sets));
  const label = state.weekOffset === 0 ? 'Esta semana (en curso)' : `Hace ${state.weekOffset} ${state.weekOffset === 1 ? 'semana' : 'semanas'}`;
  const out = [
    h('div', { class: 'week-nav' },
      h('button', { class: 'btn btn-secondary', dataset: { action: 'summary-week', delta: '1' }, 'aria-label': 'Semana anterior' }, '‹'),
      h('div', { class: 'week-label', id: 'muscle-week-label' }, label),
      h('button', { class: 'btn btn-secondary', dataset: { action: 'summary-week', delta: '-1' }, disabled: state.weekOffset === 0, 'aria-label': 'Semana siguiente' }, '›'),
    ),
  ];
  if (vol.sessions === 0) {
    out.push(empty('💪', 'Sin sesiones esa semana', 'Elige otra semana o completa una sesión'));
  } else {
    out.push(card('Series por músculo', ...vol.rows.map(r => h('div', { class: 'muscle-row' + (low.has(r.id) ? ' low' : ''), dataset: { muscle: r.id } },
      h('div', { class: 'muscle-head' },
        h('span', { class: 'muscle-name' }, r.label),
        h('span', { class: 'muscle-sets' }, `${r.sets} ${r.sets === 1 ? 'serie' : 'series'}${r.volume > 0 ? ` · ${fmtKg(r.volume)} ${unitLabel()}` : ''}`),
      ),
      h('meter', { class: 'muscle-meter', min: '0', max: String(max), low: String(MIN_WEEKLY_SETS), optimum: String(max), value: String(r.sets), 'aria-label': `${r.label}: ${r.sets} series` }),
      low.has(r.id) ? h('div', { class: 'muscle-warn' }, `Por debajo de ${MIN_WEEKLY_SETS} series esa semana`) : null,
    ))));
    if (vol.unassigned > 0) out.push(h('div', { class: 'chart-note' }, `${vol.unassigned} series de ejercicios sin músculo asignado (sustituidos) no se cuentan.`));
  }
  out.push(h('div', { class: 'info-box mt-10' },
    `Cómo se calcula: cada serie hecha (sin calentamiento) cuenta una vez para el músculo del ejercicio según el mapa del plan; las superseries cuentan para sus dos músculos. El aviso salta si una semana ya terminada queda por debajo de ${MIN_WEEKLY_SETS} series. Es una referencia fija y orientativa, no un consejo personalizado.`));
  return out;
}

// ==================== CUERPO ====================
function body(data) {
  const out = [];
  const w = bodySeries(data.body, 'weight');
  if (w.length) {
    const chart = lineChart([{ name: 'Peso corporal', cls: 'series-a', points: w.map(p => ({ x: p.ts, y: kgToDisplay(p.value) })) }], { title: `Peso corporal en ${unitLabel()}`, xLabel: shortDay });
    out.push(card(`Peso corporal (${unitLabel()})`, chart));
  }
  for (const f of BODY_FIELDS.slice(1)) {
    const pts = bodySeries(data.body, f.key);
    if (pts.length < 2) continue;
    out.push(card(`${f.label} (cm)`, lineChart([{ name: f.label, cls: 'series-b', points: pts.map(p => ({ x: p.ts, y: p.value })) }], { title: `${f.label} en cm`, xLabel: shortDay })));
  }
  if (!data.body.length) {
    out.push(empty('⚖️', 'Sin medidas todavía', 'Apunta tu peso arriba cuando quieras; es opcional'));
    return out;
  }
  const list = [...data.body].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
  out.push(card('Registros', ...list.map(b => h('div', { class: 'body-row' },
    h('div', { class: 'body-row-main' },
      h('div', { class: 'exercise-name' }, formatDate(keyToTs(b.date))),
      h('div', { class: 'series-line' }, BODY_FIELDS.filter(f => b[f.key] !== null).map(f => `${f.label} ${String(f.key === 'weight' ? kgToDisplay(b[f.key]) : b[f.key]).replace('.', ',')} ${f.key === 'weight' ? unitLabel() : f.unit}`).join(' · ')),
    ),
    h('button', { class: 'btn-delete', 'aria-label': `Borrar medida del ${b.date}`, dataset: { action: 'delete-body', date: b.date } }, '🗑'),
  ))));
  return out;
}

// ==================== ENTRADA ====================
// state: { tab, search, plan, limit, exerciseId, calYear, calMonth, weekOffset }
export function renderHistoryView(container, state, data, expandedIds, now = Date.now()) {
  if (state.tab === 'sessions') {
    const filtered = !!(state.search || state.plan);
    renderHistory(container, filterSessions(data.sessions, state.search, state.plan), expandedIds, filtered, state.limit);
  } else if (state.tab === 'exercises') {
    container.replaceChildren(...(state.exerciseId ? exerciseDetail(state, data) : exerciseList(state, data)));
  } else if (state.tab === 'trends') {
    container.replaceChildren(...trends(state, data, now));
  } else if (state.tab === 'muscles') {
    container.replaceChildren(...muscles(state, data, now));
  } else if (state.tab === 'calendar') {
    container.replaceChildren(...calendar(state, data, now));
  } else if (state.tab === 'body') {
    container.replaceChildren(...body(data));
  }
}
