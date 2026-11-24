// Render de pantallas. Todo el texto variable entra con textContent; no se inserta HTML como texto
// con datos ni se interpolan identificadores en JS. Las acciones se declaran con
// data-action y las resuelve la delegación de app.js.
import { PLAN, BADGE, getPlanSession, fieldsFor } from './plan.js';
import { draftStats, formatPrevious, formatSeriesLine, fieldsForExerciseId } from './data.js';
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
export function renderHome(container, draft) {
  const items = [];
  const current = draft && getPlanSession(draft.planSessionId);
  if (current) {
    const started = new Date(draft.startedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const { filled, total } = draftStats(draft);
    items.push(h('button', { class: 'resume-card', dataset: { action: 'resume-session' } },
      h('div', { class: 'resume-card-label' }, 'Sesión en curso'),
      h('div', { class: 'resume-card-title' }, current.name),
      h('div', { class: 'resume-card-info' }, `Empezada a las ${started} · ${filled}/${total} series apuntadas · Continuar ›`),
    ));
  }
  PLAN.forEach(p => {
    items.push(h('button', {
      class: 'session-btn' + (p.name.includes('⭐') ? ' star' : '') + (current && current.id === p.id ? ' in-progress' : ''),
      dataset: { action: 'start-session', planId: p.id },
    },
      h('div', { class: 'session-btn-emoji' }, p.emoji),
      h('div', { class: 'session-btn-content' },
        h('div', { class: 'session-btn-title' }, p.name),
        h('div', { class: 'session-btn-info' }, `${p.exercises.length} ejercicios · ${p.duration} min`),
      ),
      h('div', { class: 'session-btn-arrow' }, '›'),
    ));
  });
  container.replaceChildren(...items);
}

// ==================== SESSION ====================
// previous: Map id de ejercicio → series de la última sesión del mismo tipo.
export function renderSession(container, planSession, draft, timers, previous = new Map()) {
  container.replaceChildren(...planSession.exercises.map((ex, exIdx) =>
    buildExerciseBlock(ex, exIdx, draft.exercises[exIdx], timers, previous.get(ex.id) || [])));
}

function buildExerciseBlock(ex, exIdx, data, timers, prevSeries) {
  const badge = BADGE[ex.type];
  return h('div', { class: 'exercise-block' },
    h('div', { class: 'exercise-header' },
      h('div', { class: 'exercise-header-left' },
        h('div', { class: 'exercise-name-main' }, ex.name),
        h('div', { class: 'exercise-note' }, ex.note),
      ),
      h('span', { class: 'badge badge-' + ex.type }, badge ? badge.label : ''),
    ),
    ex.series.map((s, seriesIdx) =>
      buildSeriesRow(ex, exIdx, s, seriesIdx, (data && data.series[seriesIdx]) || {}, timers, prevSeries[seriesIdx])),
  );
}

function valueInput(className, field, value, prevValue, exIdx, seriesIdx) {
  const isKg = field.unit === 'kg';
  const hasPrev = prevValue !== null && prevValue !== undefined;
  const input = h('input', {
    type: 'number',
    class: className + ' kg-input',
    inputmode: isKg ? 'decimal' : 'numeric',
    step: isKg ? 'any' : '1',
    min: '0',
    placeholder: hasPrev ? String(prevValue) : field.unit,
    'aria-label': `${field.label === field.unit ? field.unit : `${field.label} (${field.unit})`}, serie ${seriesIdx + 1}`
      + (hasPrev ? `, anterior ${prevValue}` : ''),
    dataset: { ex: String(exIdx), series: String(seriesIdx), field: field.key },
  });
  input.value = value === null || value === undefined ? '' : String(value);
  return input;
}

function buildSeriesRow(ex, exIdx, s, seriesIdx, row, timers, prev) {
  const key = exIdx + '-' + seriesIdx;
  const fields = fieldsFor(ex);
  const superset = ex.type === 'superset';
  const prevRow = prev || {};

  const inputs = h('div', { class: superset ? 'superset-inputs' : 'series-inputs' });
  fields.forEach((f, i) => {
    if (i > 0) inputs.append(h('span', { class: 'superset-plus' }, superset ? '+' : '×'));
    const cls = superset ? 'input-superset' : (f.unit === 'kg' ? 'input-kg' : 'input-reps');
    inputs.append(valueInput(cls, f, row[f.key], prevRow[f.key], exIdx, seriesIdx));
  });

  let timer = null;
  if (s.rest > 0) {
    const active = timers[key];
    timer = active && !isNaN(active.remaining)
      ? buildTimer(key, active.duration, active.remaining, active.paused)
      : buildTimerButton(key, s.rest);
  }

  const previousText = formatPrevious(prev, fields);
  return h('div', {
    class: 'series-block' + (s.drop ? ' drop' : '') + (row.done ? ' done' : ''),
    title: previousText ? `anterior: ${previousText}` : null,
  },
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

// ==================== HISTORY ====================
export function formatDate(ts) {
  return new Date(ts).toLocaleDateString('es-ES');
}

export function renderHistory(container, sessions, expandedIds) {
  if (sessions.length === 0) {
    container.replaceChildren(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-state-emoji' }, '📋'),
      h('div', { class: 'empty-state-title' }, 'Sin historial aún'),
      h('div', { class: 'empty-state-text' }, 'Completa una sesión para ver el historial'),
    ));
    return;
  }

  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  container.replaceChildren(...sorted.map(session => {
    const id = session.id;
    const expanded = expandedIds.includes(id);
    return h('div', { class: 'session-card' + (expanded ? ' expanded' : ''), dataset: { id } },
      h('div', { class: 'session-header', dataset: { action: 'toggle-expand', id } },
        h('div', { class: 'session-info' },
          h('div', { class: 'session-title' }, session.name),
          h('div', { class: 'session-date' }, formatDate(session.startedAt)),
        ),
        h('div', { class: 'session-actions' },
          h('button', { class: 'btn-delete', title: 'Borrar sesión', 'aria-label': 'Borrar sesión', dataset: { action: 'delete-session', id } }, '🗑'),
          h('button', { class: 'btn-expand', 'aria-label': 'Ver detalle' }, '▼'),
        ),
      ),
      h('div', { class: 'session-details' },
        session.notes ? h('div', { class: 'session-notes' }, session.notes) : null,
        session.exercises.map(ex => {
          const fields = fieldsForExerciseId(ex.id);
          return h('div', { class: 'exercise-item' },
            h('div', { class: 'exercise-name' }, ex.name),
            ex.notes ? h('div', { class: 'exercise-notes' }, ex.notes) : null,
            ex.series.map((s, i) => h('div', { class: 'series-line' }, formatSeriesLine(s, i, fields))),
          );
        }),
      ),
    );
  }));
}

// ==================== IMPORT ====================
// preview: resultado de parseImport. Todo lo que viene del fichero entra como texto.
export function renderImportPreview(container, preview) {
  if (!preview) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }
  container.hidden = false;
  if (!preview.ok) {
    container.replaceChildren(
      h('div', { class: 'import-title error' }, 'No se puede importar'),
      h('div', { class: 'import-line' }, preview.error),
      h('button', { class: 'btn btn-secondary mt-10', dataset: { action: 'import-cancel' } }, 'Cerrar'),
    );
    return;
  }
  const list = [...preview.fresh].sort((a, b) => b.startedAt - a.startedAt);
  const shown = list.slice(0, 10);
  container.replaceChildren(
    h('div', { class: 'import-title' }, 'Vista previa de la importación'),
    h('div', { class: 'import-line' }, `${preview.sessions.length} sesiones válidas en el fichero (formato ${preview.format})`),
    h('div', { class: 'import-line' }, `${preview.fresh.length} nuevas se añadirán`),
    h('div', { class: 'import-line' }, `${preview.duplicates} ya existen y se conservan como están`),
    preview.rejected.length
      ? h('div', { class: 'import-line warn' }, `${preview.rejected.length} rechazadas por datos inválidos`)
      : null,
    shown.length ? h('ul', { class: 'import-list' },
      shown.map(s => h('li', {}, `${formatDate(s.startedAt)} — ${s.name}`)),
      list.length > shown.length ? h('li', {}, `… y ${list.length - shown.length} más`) : null,
    ) : null,
    h('div', { class: 'import-actions' },
      h('button', { class: 'btn btn-primary', dataset: { action: 'import-confirm' }, disabled: preview.fresh.length === 0 }, 'Importar'),
      h('button', { class: 'btn btn-secondary', dataset: { action: 'import-cancel' } }, 'Cancelar'),
    ),
  );
}
