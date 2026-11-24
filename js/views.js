// Render de pantallas. Todo el texto variable entra con textContent; no se inserta HTML como texto
// con datos ni se interpolan identificadores en JS. Las acciones se declaran con
// data-action y las resuelve la delegación de app.js.
import { PLAN, BADGE, SUPERSET_LABELS, SESSION_KEYS, SESSION_EMOJIS, SESSION_DURATIONS } from './plan.js';
import { formatRest, formatRemaining, ringOffset, RING_CIRCUMFERENCE } from './timers.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Crea un elemento. attrs: class, dataset ({...}) y atributos planos. children: nodos o texto.
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

// ==================== HOME ====================
export function renderHome(container) {
  container.replaceChildren(...SESSION_KEYS.map((sessionName, i) => {
    const exercises = PLAN[sessionName];
    return h('button', {
      class: 'session-btn' + (sessionName.includes('⭐') ? ' star' : ''),
      dataset: { action: 'start-session', index: String(i) },
    },
      h('div', { class: 'session-btn-emoji' }, SESSION_EMOJIS[i]),
      h('div', { class: 'session-btn-content' },
        h('div', { class: 'session-btn-title' }, sessionName),
        h('div', { class: 'session-btn-info' }, `${exercises.length} ejercicios · ${SESSION_DURATIONS[i]} min`),
      ),
      h('div', { class: 'session-btn-arrow' }, '›'),
    );
  }));
}

// ==================== SESSION ====================
export function renderSession(container, sessionName, sessionData, timers) {
  const exercises = PLAN[sessionName] || [];
  container.replaceChildren(...exercises.map((ex, exIdx) =>
    buildExerciseBlock(ex, exIdx, sessionData[ex.name] || [], timers)));
}

function buildExerciseBlock(ex, exIdx, data, timers) {
  const badge = BADGE[ex.type];
  return h('div', { class: 'exercise-block' },
    h('div', { class: 'exercise-header' },
      h('div', { class: 'exercise-header-left' },
        h('div', { class: 'exercise-name-main' }, ex.name),
        h('div', { class: 'exercise-note' }, ex.note),
      ),
      h('span', { class: 'badge badge-' + ex.type }, badge ? badge.label : ''),
    ),
    ex.series.map((s, seriesIdx) => buildSeriesRow(ex, exIdx, s, seriesIdx, data, timers)),
  );
}

function kgInput(className, placeholder, value, exIdx, seriesIdx, field) {
  const input = h('input', {
    type: 'number',
    class: className + ' kg-input',
    placeholder,
    dataset: { ex: String(exIdx), series: String(seriesIdx), field },
  });
  input.value = value;
  return input;
}

function buildSeriesRow(ex, exIdx, s, seriesIdx, data, timers) {
  const key = exIdx + '-' + seriesIdx;
  const row = data[seriesIdx] || {};

  let inputs;
  if (ex.type === 'superset') {
    const labels = SUPERSET_LABELS[ex.name] || ['A', 'B'];
    inputs = h('div', { class: 'superset-inputs' },
      kgInput('input-superset', labels[0], row.weight || '', exIdx, seriesIdx, 'weight'),
      h('span', { class: 'superset-plus' }, '+'),
      kgInput('input-superset', labels[1], row.weight2 || '', exIdx, seriesIdx, 'weight2'),
    );
  } else {
    inputs = kgInput('input-kg', 'kg', row.weight || '', exIdx, seriesIdx, 'weight');
  }

  let timer = null;
  if (s.rest > 0) {
    const active = timers[key];
    timer = active && !isNaN(active.remaining)
      ? buildTimer(key, active.duration, active.remaining, active.paused)
      : buildTimerButton(key, s.rest);
  }

  return h('div', { class: 'series-block' + (s.drop ? ' drop' : '') },
    h('div', { class: 'series-number' }, String(seriesIdx + 1)),
    h('div', { class: 'series-reps' }, s.reps + ' reps'),
    inputs,
    timer,
  );
}

// ==================== TIMERS (DOM) ====================
export function buildTimerButton(key, duration) {
  return h('button', { class: 'timer-btn', dataset: { action: 'start-timer', timerKey: key } },
    '⏱ ' + formatRest(duration));
}

export function buildTimer(key, duration, remaining, paused) {
  const ring = svg('svg', { class: 'timer-circle', viewBox: '0 0 18 18' });
  ring.append(
    svg('circle', { cx: 9, cy: 9, r: 7, fill: 'none', class: 'timer-track', 'stroke-width': 2.5 }),
    svg('circle', {
      cx: 9, cy: 9, r: 7, fill: 'none', class: 'timer-progress', 'stroke-width': 2.5,
      'stroke-dasharray': RING_CIRCUMFERENCE,
      'stroke-dashoffset': ringOffset(remaining, duration),
    }),
  );
  return h('div', {
    class: 'mini-timer' + (remaining <= 10 ? ' warning' : ''),
    dataset: { timerKey: key, duration: String(duration) },
  },
    ring,
    h('span', { class: 'timer-text' }, formatRemaining(remaining)),
    h('div', { class: 'timer-controls' },
      h('button', { class: 'timer-control-btn', dataset: { action: 'toggle-timer', timerKey: key } }, paused ? '▶' : '⏸'),
      h('button', { class: 'timer-control-btn', dataset: { action: 'clear-timer', timerKey: key } }, '✕'),
    ),
  );
}

export function findTimerEl(root, key) {
  return [...root.querySelectorAll('.mini-timer, .timer-btn')]
    .find(el => el.dataset.timerKey === key) || null;
}

export function updateTimerEl(el, remaining, duration) {
  const text = el.querySelector('.timer-text');
  const progress = el.querySelector('.timer-progress');
  if (text) text.textContent = formatRemaining(remaining);
  if (progress) progress.setAttribute('stroke-dashoffset', ringOffset(remaining, duration));
  el.classList.toggle('warning', remaining <= 10);
}

export function setTimerPausedIcon(el, paused) {
  const btn = el.querySelector('.timer-control-btn');
  if (btn) btn.textContent = paused ? '▶' : '⏸';
}

// ==================== SUMMARY ====================
export function formatSeriesLine(s, i) {
  return `Serie ${i + 1}: ${s.reps} reps${s.weight ? ` @ ${s.weight}kg` : ''}${s.weight2 ? ` + ${s.weight2}kg` : ''}`;
}

export function buildSummaryText(sessionName, exercisesData, dateLabel) {
  const lines = [`📅 ${dateLabel} — ${sessionName}`, ''];
  exercisesData.forEach(ex => {
    lines.push(`▸ ${ex.name}`);
    ex.series.forEach((s, i) => lines.push('  ' + formatSeriesLine(s, i)));
    lines.push('');
  });
  return `[GUARDAR SESIÓN]\n${lines.join('\n')}`;
}

// ==================== HISTORY ====================
export function renderHistory(container, sessions, expandedIds) {
  if (sessions.length === 0) {
    container.replaceChildren(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-state-emoji' }, '📋'),
      h('div', { class: 'empty-state-title' }, 'Sin historial aún'),
      h('div', { class: 'empty-state-text' }, 'Completa una sesión para ver el historial'),
    ));
    return;
  }

  const sorted = [...sessions].sort((a, b) => b.timestamp - a.timestamp);
  container.replaceChildren(...sorted.map(session => {
    const id = String(session.id);
    const expanded = expandedIds.some(x => String(x) === id);
    const exercises = Array.isArray(session.exercises) ? session.exercises : [];
    return h('div', { class: 'session-card' + (expanded ? ' expanded' : '') },
      h('div', { class: 'session-header', dataset: { action: 'toggle-expand', id } },
        h('div', { class: 'session-info' },
          h('div', { class: 'session-title' }, String(session.session ?? '')),
          h('div', { class: 'session-date' }, String(session.date ?? '')),
        ),
        h('div', { class: 'session-actions' },
          h('button', { class: 'btn-delete', title: 'Borrar sesión', dataset: { action: 'delete-session', id } }, '🗑'),
          h('button', { class: 'btn-expand' }, '▼'),
        ),
      ),
      h('div', { class: 'session-details' },
        exercises.map(ex => h('div', { class: 'exercise-item' },
          h('div', { class: 'exercise-name' }, String(ex?.name ?? '')),
          (Array.isArray(ex?.series) ? ex.series : []).map((s, i) =>
            h('div', { class: 'series-line' }, formatSeriesLine(s || {}, i))),
        )),
      ),
    );
  }));
}
