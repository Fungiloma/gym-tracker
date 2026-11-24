// Render de pantallas. Todo el texto variable entra con textContent; no se inserta HTML como texto
// con datos ni se interpolan identificadores en JS. Las acciones se declaran con
// data-action y las resuelve la delegación de app.js.
import { PLAN, BADGE, getPlanSession, findPlanExercise } from './plan.js';
import { draftStats, formatPrevious, formatPreviousShort, formatSeriesLine, fieldsForExerciseId } from './data.js';
import { sessionVolume, fmtKg } from './stats.js';
import { formatRest, formatRemaining, ringOffset } from './timers.js';

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
// ctx = { previous: Map id → series de la última sesión, restOf(ex) → segundos de descanso mostrados,
//         substituting: índice del ejercicio con el formulario abierto o null }
export function renderSession(container, draft, ctx) {
  const names = [...new Set(PLAN.flatMap(p => p.exercises.map(e => e.name)))];
  container.replaceChildren(...[
    h('details', { class: 'note-box', open: draft.notes ? 'open' : null },
      h('summary', {}, '📝 Notas de la sesión'),
      h('textarea', {
        class: 'note-input', maxlength: '2000', rows: '2', placeholder: 'Cómo te has sentido, molestias…',
        'aria-label': 'Notas de la sesión', dataset: { note: 'session' },
      }, draft.notes),
    ),
    h('div', { class: 'hint' }, 'Toca ✓ en una serie vacía para copiar la anterior; toca la columna "Anterior" para usar la de la última sesión.'),
    draft.exercises.map((ex, exIdx) => buildExerciseBlock(ex, exIdx, draft.exercises.length, ctx)),
    h('datalist', { id: 'exercise-options' }, names.map(n => h('option', { value: n }))),
  ].flat());
}

function exerciseButton(action, exIdx, label, text, extra = {}) {
  return h('button', {
    class: 'tool-btn', 'aria-label': label, disabled: extra.disabled ? 'disabled' : null,
    dataset: { action, ex: String(exIdx), ...(extra.data || {}) },
  }, text);
}

function buildExerciseBlock(ex, exIdx, count, ctx) {
  const planEx = findPlanExercise(ex.id);
  const type = planEx ? planEx.type : 'traditional';
  const badge = BADGE[type];
  const fields = fieldsForExerciseId(ex.id);
  const prevSeries = ctx.previous.get(ex.id) || [];
  const rest = ctx.restOf(ex);
  const note = ex.substituteFor ? `Sustituye a ${ex.substituteFor}` : (planEx ? planEx.note : '');
  return h('div', { class: 'exercise-block', dataset: { ex: String(exIdx) } },
    h('div', { class: 'exercise-header' },
      h('div', { class: 'exercise-header-left' },
        h('div', { class: 'exercise-name-main' }, ex.name),
        h('div', { class: 'exercise-note' }, note),
      ),
      h('span', { class: 'badge badge-' + type }, badge ? badge.label : ''),
    ),
    h('div', { class: 'exercise-tools' },
      exerciseButton('move-exercise', exIdx, 'Subir ejercicio', '↑', { disabled: exIdx === 0, data: { dir: '-1' } }),
      exerciseButton('move-exercise', exIdx, 'Bajar ejercicio', '↓', { disabled: exIdx === count - 1, data: { dir: '1' } }),
      exerciseButton('open-substitute', exIdx, 'Sustituir ejercicio', '⇄ Sustituir'),
    ),
    ctx.substituting === exIdx ? buildSubstituteBox(exIdx) : null,
    h('div', { class: 'series-head', 'aria-hidden': 'true' },
      h('span', {}, 'Anterior'),
      h('span', {}, fields.map(f => f.label).join(' × ')),
      h('span', {}, '✓'),
    ),
    ex.series.map((s, seriesIdx) => buildSeriesRow(ex, exIdx, s, seriesIdx, fields, prevSeries[seriesIdx])),
    h('div', { class: 'exercise-footer' },
      exerciseButton('add-series', exIdx, 'Añadir serie', '+ Serie'),
      exerciseButton('remove-series', exIdx, 'Quitar la última serie', '− Serie', { disabled: ex.series.length <= 1 }),
      h('div', { class: 'rest-step', role: 'group', 'aria-label': 'Descanso de este ejercicio' },
        exerciseButton('rest-step', exIdx, 'Restar 15 segundos al descanso', '−', { data: { delta: '-15' } }),
        h('span', { class: 'rest-step-value' }, rest > 0 ? '⏱ ' + formatRest(rest) : '⏱ sin descanso'),
        exerciseButton('rest-step', exIdx, 'Sumar 15 segundos al descanso', '+', { data: { delta: '15' } }),
      ),
    ),
    h('details', { class: 'note-box', open: ex.notes ? 'open' : null },
      h('summary', {}, '📝 Nota del ejercicio'),
      h('textarea', {
        class: 'note-input', maxlength: '2000', rows: '2', placeholder: 'Ajuste de máquina, sensaciones…',
        'aria-label': `Nota de ${ex.name}`, dataset: { note: 'exercise', ex: String(exIdx) },
      }, ex.notes),
    ),
  );
}

function buildSubstituteBox(exIdx) {
  return h('div', { class: 'substitute-box' },
    h('input', {
      type: 'text', id: 'substitute-input', class: 'text-input', list: 'exercise-options', maxlength: '120',
      placeholder: 'Nombre del ejercicio', autocomplete: 'off', 'aria-label': 'Ejercicio que lo sustituye',
    }),
    h('div', { class: 'substitute-actions' },
      h('button', { class: 'btn btn-primary', dataset: { action: 'confirm-substitute', ex: String(exIdx) } }, 'Sustituir'),
      h('button', { class: 'btn btn-secondary', dataset: { action: 'cancel-substitute' } }, 'Cancelar'),
    ),
  );
}

function valueInput(className, field, value, exIdx, seriesIdx) {
  const isKg = field.unit === 'kg';
  const label = field.label === field.unit ? field.unit : `${field.label} (${field.unit})`;
  const input = h('input', {
    type: 'text',
    class: className + ' kg-input',
    inputmode: isKg ? 'decimal' : 'numeric',
    pattern: isKg ? '[0-9]*[.,]?[0-9]*' : '[0-9]*',
    enterkeyhint: 'next',
    autocomplete: 'off',
    placeholder: field.unit,
    'aria-label': `${label}, serie ${seriesIdx + 1}`,
    dataset: { ex: String(exIdx), series: String(seriesIdx), field: field.key },
  });
  input.value = value === null || value === undefined ? '' : String(value);
  return input;
}

// Fila de una serie, para repintarla sin tocar el resto de la lista.
export function renderSeriesRow(draft, exIdx, seriesIdx, previous) {
  const ex = draft.exercises[exIdx];
  const prev = (previous.get(ex.id) || [])[seriesIdx];
  return buildSeriesRow(ex, exIdx, ex.series[seriesIdx], seriesIdx, fieldsForExerciseId(ex.id), prev);
}

function buildSeriesRow(ex, exIdx, s, seriesIdx, fields, prev) {
  const superset = fields.length === 2 && fields.every(f => f.label !== f.unit);
  const at = { ex: String(exIdx), series: String(seriesIdx) };

  const inputs = h('div', { class: 'series-inputs' });
  fields.forEach((f, i) => {
    if (i > 0) inputs.append(h('span', { class: 'superset-plus' }, superset ? '+' : '×'));
    const cls = superset ? 'input-superset' : (f.unit === 'kg' ? 'input-kg' : 'input-reps');
    inputs.append(valueInput(cls, f, s[f.key], exIdx, seriesIdx));
  });

  const previousText = formatPreviousShort(prev, fields);
  const prevCell = previousText
    ? h('button', {
      class: 'prev-btn', dataset: { action: 'fill-previous', ...at },
      'aria-label': `Usar el valor anterior de la serie ${seriesIdx + 1}: ${formatPrevious(prev, fields)}`,
    }, previousText)
    : h('span', { class: 'prev-empty', 'aria-label': 'Sin valor anterior' }, '—');

  return h('div', {
    class: 'series-block' + (s.type === 'drop' ? ' drop' : '') + (s.done ? ' done' : ''),
    dataset: at,
  },
    h('div', { class: 'series-meta' },
      h('span', { class: 'series-number' }, String(seriesIdx + 1)),
      s.target ? h('span', { class: 'series-reps' }, s.target.includes('reps') ? s.target : `obj. ${s.target}`) : null,
    ),
    h('div', { class: 'series-main' },
      prevCell,
      inputs,
      h('button', {
        class: 'check-btn' + (s.done ? ' on' : ''), 'aria-pressed': String(!!s.done),
        'aria-label': `Serie ${seriesIdx + 1} hecha`, dataset: { action: 'toggle-series', ...at },
      }, '✓'),
    ),
  );
}

// ==================== DESCANSO (barra fija) ====================
// La barra existe en index.html; aquí solo se actualiza su contenido.
export function renderRestBar(bar, timer) {
  bar.hidden = !timer;
  document.getElementById('app').classList.toggle('has-rest', !!timer);
  if (!timer) return;
  bar.querySelector('#rest-label').textContent = timer.label || 'Descanso';
  updateRestBar(bar, timer.remaining, timer.duration);
  const toggle = bar.querySelector('#rest-toggle');
  toggle.textContent = timer.paused ? '▶' : '⏸';
  toggle.setAttribute('aria-label', timer.paused ? 'Reanudar descanso' : 'Pausar descanso');
}

export function updateRestBar(bar, remaining, duration) {
  bar.querySelector('#rest-time').textContent = formatRemaining(remaining);
  bar.querySelector('.timer-progress').setAttribute('stroke-dashoffset', ringOffset(remaining, duration));
  bar.classList.toggle('warning', remaining <= 10);
}

// ==================== HISTORY ====================
export function formatDate(ts) {
  return new Date(ts).toLocaleDateString('es-ES');
}

// filtered: hay búsqueda o filtro activo, así que una lista vacía no significa "sin historial".
export function renderHistory(container, sessions, expandedIds, filtered = false) {
  if (sessions.length === 0) {
    container.replaceChildren(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-state-emoji' }, filtered ? '🔍' : '📋'),
      h('div', { class: 'empty-state-title' }, filtered ? 'Sin resultados' : 'Sin historial aún'),
      h('div', { class: 'empty-state-text' }, filtered ? 'Prueba con otra búsqueda o quita el filtro' : 'Completa una sesión para ver el historial'),
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
          sessionVolume(session) > 0 ? h('div', { class: 'session-volume' }, `${fmtKg(sessionVolume(session))} kg de volumen`) : null,
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
    preview.freshBody && preview.freshBody.length
      ? h('div', { class: 'import-line' }, `${preview.freshBody.length} medidas corporales nuevas se añadirán`)
      : null,
    preview.rejected.length
      ? h('div', { class: 'import-line warn' }, `${preview.rejected.length} rechazadas por datos inválidos`)
      : null,
    shown.length ? h('ul', { class: 'import-list' },
      shown.map(s => h('li', {}, `${formatDate(s.startedAt)} — ${s.name}`)),
      list.length > shown.length ? h('li', {}, `… y ${list.length - shown.length} más`) : null,
    ) : null,
    h('div', { class: 'import-actions' },
      h('button', { class: 'btn btn-primary', dataset: { action: 'import-confirm' }, disabled: preview.fresh.length === 0 && !(preview.freshBody && preview.freshBody.length) }, 'Importar'),
      h('button', { class: 'btn btn-secondary', dataset: { action: 'import-cancel' } }, 'Cancelar'),
    ),
  );
}
