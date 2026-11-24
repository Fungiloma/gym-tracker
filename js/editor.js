// Pantallas del editor del plan: rutinas, una rutina y la biblioteca de ejercicios.
// Solo render: todo el texto entra con textContent (vía h). Los clics se declaran con data-action y los
// cambios de campos con data-edit; los resuelve app.js.
import { h } from './views.js';
import { BADGE, MUSCLES } from './plan.js';
import { EXERCISE_TYPES, PLAN_LIMITS, routinesUsing } from './routines.js';

const MUSCLE_LABEL = new Map(MUSCLES.map(m => [m.id, m.label]));

// replaceChildren no acepta listas ni descarta null: se aplana y se filtra antes.
function fill(container, ...children) {
  container.replaceChildren(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
}

function muscleText(ids) {
  return ids.length ? ids.map(id => MUSCLE_LABEL.get(id) || id).join(', ') : 'sin músculo asignado';
}

function routineInfo(r) {
  const series = r.exercises.reduce((n, e) => n + e.series.length, 0);
  return `${r.exercises.length} ejercicios · ${series} series` + (r.duration ? ` · ${r.duration} min` : '');
}

function btn(action, text, data = {}, extra = {}) {
  return h('button', {
    class: extra.class || 'tool-btn', 'aria-label': extra.label, disabled: extra.disabled ? 'disabled' : null,
    dataset: { action, ...data },
  }, text);
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

// ==================== RUTINAS ====================
// ctx = { used: usedIds(...), preview: resultado de parsePlanImport o null }
export function renderRoutines(container, plan, ctx) {
  const active = plan.routines.filter(r => !r.archived);
  const archived = plan.routines.filter(r => r.archived);
  const exercises = plan.exercises.filter(e => !e.archived).length;
  fill(container,
    h('section', { class: 'data-box' },
      h('div', { class: 'data-box-title' }, 'Rutinas'),
      h('div', { class: 'data-box-text' }, 'Las rutinas activas aparecen en la pantalla de inicio en este orden. Una rutina con historial no se borra: se archiva y sus sesiones siguen en el historial.'),
      active.length ? h('div', { class: 'editor-list' }, active.map((r, i) => h('div', { class: 'editor-row', dataset: { routine: r.id } },
        h('div', { class: 'editor-row-main' },
          h('div', { class: 'editor-row-title' }, `${r.emoji || '🏋️'} ${r.name}`),
          h('div', { class: 'editor-row-info' }, routineInfo(r)),
        ),
        h('div', { class: 'editor-row-tools' },
          btn('routine-move', '↑', { id: r.id, dir: '-1' }, { label: `Subir ${r.name}`, disabled: i === 0 }),
          btn('routine-move', '↓', { id: r.id, dir: '1' }, { label: `Bajar ${r.name}`, disabled: i === active.length - 1 }),
          btn('routine-edit', '✏️ Editar', { id: r.id }, { label: `Editar ${r.name}` }),
          btn('routine-duplicate', '⧉', { id: r.id }, { label: `Duplicar ${r.name}` }),
          btn('routine-remove', ctx.used.routines.has(r.id) ? '🗄️' : '🗑', { id: r.id }, {
            label: ctx.used.routines.has(r.id) ? `Archivar ${r.name}` : `Borrar ${r.name}`,
          }),
        ),
      ))) : h('div', { class: 'data-box-text mt-10' }, 'No hay rutinas activas.'),
      h('div', { class: 'editor-new' },
        h('input', {
          type: 'text', id: 'new-routine-name', class: 'text-input', maxlength: String(PLAN_LIMITS.name),
          placeholder: 'Nombre de la nueva rutina', autocomplete: 'off', 'aria-label': 'Nombre de la nueva rutina',
        }),
        h('button', { class: 'btn btn-primary', dataset: { action: 'routine-create' } }, '+ Crear rutina'),
      ),
      archived.length ? h('details', { class: 'editor-archived' },
        h('summary', {}, `Archivadas (${archived.length})`),
        archived.map(r => h('div', { class: 'editor-row' },
          h('div', { class: 'editor-row-main' },
            h('div', { class: 'editor-row-title' }, r.name),
            h('div', { class: 'editor-row-info' }, routineInfo(r)),
          ),
          h('div', { class: 'editor-row-tools' }, btn('routine-restore', 'Restaurar', { id: r.id }, { label: `Restaurar ${r.name}` })),
        )),
      ) : null,
    ),
    h('section', { class: 'data-box mt-10' },
      h('div', { class: 'data-box-title' }, 'Biblioteca de ejercicios'),
      h('div', { class: 'data-box-text' }, `${exercises} ejercicios activos. Nombre, tipo y músculos; el historial se enlaza por id, así que renombrar no lo rompe.`),
      h('button', { class: 'btn btn-secondary mt-10', dataset: { action: 'go-screen', screen: 'library' } }, '📚 Abrir biblioteca'),
    ),
    h('section', { class: 'data-box mt-10' },
      h('div', { class: 'data-box-title' }, 'Plan en JSON'),
      h('div', { class: 'data-box-text' }, 'Exporta el plan para guardarlo o pasarlo a otro móvil. Importar sustituye rutinas y biblioteca; lo que use tu historial se conserva archivado. El plan no va en la copia del historial: expórtalo aparte.'),
      h('div', { class: 'data-actions' },
        h('button', { class: 'btn btn-secondary', dataset: { action: 'plan-export' } }, 'Exportar plan'),
        h('button', { class: 'btn btn-secondary', dataset: { action: 'plan-import-open' } }, 'Importar plan'),
        h('button', { class: 'btn btn-ghost', dataset: { action: 'plan-reset' } }, 'Volver al plan original'),
      ),
      planImportPreview(ctx.preview),
    ),
  );
}

function planImportPreview(preview) {
  if (!preview) return null;
  if (!preview.ok) {
    return h('div', { class: 'import-preview', role: 'region', 'aria-live': 'polite', id: 'plan-import-preview' },
      h('div', { class: 'import-title error' }, 'No se puede importar el plan'),
      h('div', { class: 'import-line' }, preview.error),
      h('button', { class: 'btn btn-secondary mt-10', dataset: { action: 'plan-import-cancel' } }, 'Cerrar'),
    );
  }
  const names = preview.incoming.names;
  return h('div', { class: 'import-preview', role: 'region', 'aria-live': 'polite', id: 'plan-import-preview' },
    h('div', { class: 'import-title' }, 'Vista previa del plan'),
    h('div', { class: 'import-line' }, `${preview.incoming.routines} rutinas y ${preview.incoming.exercises} ejercicios en el fichero`),
    preview.kept.routines || preview.kept.exercises
      ? h('div', { class: 'import-line' }, `Se conservan archivados ${preview.kept.routines} rutinas y ${preview.kept.exercises} ejercicios con historial`)
      : null,
    h('div', { class: 'import-line warn' }, 'Sustituye el plan actual. Exporta el actual antes si quieres guardarlo.'),
    names.length ? h('ul', { class: 'import-list' }, names.slice(0, 10).map(n => h('li', {}, n)),
      names.length > 10 ? h('li', {}, `… y ${names.length - 10} más`) : null) : null,
    h('div', { class: 'import-actions' },
      h('button', { class: 'btn btn-primary', dataset: { action: 'plan-import-confirm' } }, 'Importar plan'),
      h('button', { class: 'btn btn-secondary', dataset: { action: 'plan-import-cancel' } }, 'Cancelar'),
    ),
  );
}

// ==================== UNA RUTINA ====================
function textInput(value, max, label, edit, data = {}, extra = {}) {
  const input = h('input', {
    type: 'text', class: 'text-input' + (extra.class ? ' ' + extra.class : ''), maxlength: String(max), autocomplete: 'off',
    'aria-label': label, inputmode: extra.inputmode, placeholder: extra.placeholder, dataset: { edit, ...data },
  });
  input.value = value === null || value === undefined ? '' : String(value);
  return input;
}

function seriesRow(s, exIdx, k, count) {
  const at = { ex: String(exIdx), series: String(k) };
  const drop = h('input', { type: 'checkbox', 'aria-label': `Drop set, serie ${k + 1}`, dataset: { edit: 'series-drop', ...at } });
  drop.checked = !!s.drop;
  return h('div', { class: 'editor-series', dataset: at },
    h('span', { class: 'series-number' }, String(k + 1)),
    textInput(s.reps, PLAN_LIMITS.reps, `Repeticiones, serie ${k + 1}`, 'series-reps', at, { placeholder: '8-10' }),
    textInput(s.rest, 4, `Descanso en segundos, serie ${k + 1}`, 'series-rest', at, { inputmode: 'numeric', class: 'editor-rest' }),
    h('label', { class: 'editor-drop' }, drop, h('span', {}, 'drop')),
    btn('routine-series-remove', '✕', at, { label: `Quitar serie ${k + 1}`, disabled: count <= 1 }),
  );
}

export function renderRoutineEditor(container, plan, routineId) {
  const r = plan.routines.find(x => x.id === routineId);
  if (!r) {
    container.replaceChildren(h('div', { class: 'empty-state' }, h('div', { class: 'empty-state-title' }, 'Rutina no encontrada')));
    return;
  }
  const lib = new Map(plan.exercises.map(e => [e.id, e]));
  const inRoutine = new Set(r.exercises.map(e => e.exerciseId));
  const options = plan.exercises.filter(e => !e.archived && !inRoutine.has(e.id));
  fill(container,
    r.archived ? h('div', { class: 'notice notice-warn', role: 'note' }, 'Rutina archivada: restáurala para que vuelva a la pantalla de inicio.') : null,
    h('section', { class: 'data-box' },
      h('div', { class: 'editor-head' },
        field('Nombre', textInput(r.name, PLAN_LIMITS.name, 'Nombre de la rutina', 'routine-name')),
        h('div', { class: 'editor-head-row' },
          field('Emoji', textInput(r.emoji, 4, 'Emoji', 'routine-emoji', {}, { class: 'editor-emoji' })),
          field('Duración (min)', textInput(r.duration, 3, 'Duración en minutos', 'routine-duration', {}, { inputmode: 'numeric' })),
        ),
      ),
    ),
    r.exercises.length ? null : h('div', { class: 'data-box-text mt-10' }, 'Añade ejercicios de la biblioteca para poder empezar esta rutina.'),
    r.exercises.map((entry, i) => {
      const e = lib.get(entry.exerciseId);
      const at = { ex: String(i) };
      return h('section', { class: 'exercise-block editor-ex', dataset: at },
        h('div', { class: 'exercise-header' },
          h('div', { class: 'exercise-header-left' },
            h('div', { class: 'exercise-name-main' }, e.name),
            h('div', { class: 'exercise-note' }, muscleText(e.muscles)),
          ),
          h('span', { class: 'badge badge-' + e.type }, BADGE[e.type].label),
        ),
        h('div', { class: 'exercise-tools' },
          btn('routine-ex-move', '↑', { ...at, dir: '-1' }, { label: `Subir ${e.name}`, disabled: i === 0 }),
          btn('routine-ex-move', '↓', { ...at, dir: '1' }, { label: `Bajar ${e.name}`, disabled: i === r.exercises.length - 1 }),
          btn('routine-ex-remove', 'Quitar', at, { label: `Quitar ${e.name} de la rutina` }),
        ),
        h('div', { class: 'editor-series-head', 'aria-hidden': 'true' },
          h('span', {}, '#'), h('span', {}, 'Reps / rango'), h('span', {}, 'Descanso (s)'), h('span', {}, ''), h('span', {}, ''),
        ),
        entry.series.map((s, k) => seriesRow(s, i, k, entry.series.length)),
        h('div', { class: 'exercise-footer' },
          btn('routine-series-add', '+ Serie', at, { label: `Añadir serie a ${e.name}` }),
          h('span', { class: 'rest-step-value' }, `${entry.series.length} ${entry.series.length === 1 ? 'serie' : 'series'}`),
        ),
        field('Nota', textInput(entry.note, PLAN_LIMITS.note, `Nota de ${e.name}`, 'routine-note', at, { placeholder: 'Técnica, tempo, descanso…' })),
      );
    }),
    h('section', { class: 'data-box mt-10' },
      h('div', { class: 'data-box-title' }, 'Añadir ejercicio'),
      options.length ? h('div', { class: 'editor-new' },
        h('select', { id: 'add-exercise-select', class: 'text-input', 'aria-label': 'Ejercicio de la biblioteca' },
          options.map(e => h('option', { value: e.id }, e.name))),
        h('button', { class: 'btn btn-primary', dataset: { action: 'routine-ex-add' } }, '+ Añadir'),
      ) : h('div', { class: 'data-box-text' }, 'Todos los ejercicios de la biblioteca ya están en la rutina.'),
      h('button', { class: 'btn btn-secondary mt-10', dataset: { action: 'go-screen', screen: 'library' } }, '📚 Crear o editar ejercicios'),
    ),
  );
}

// ==================== BIBLIOTECA ====================
function typeSelect(value, label, data) {
  const sel = h('select', { class: 'text-input', 'aria-label': label, dataset: data },
    EXERCISE_TYPES.map(t => h('option', { value: t }, BADGE[t].label)));
  sel.value = value;
  return sel;
}

function muscleChecks(selected, group, data = {}) {
  return h('fieldset', { class: 'muscle-grid', dataset: { muscles: group } },
    h('legend', {}, 'Músculos'),
    MUSCLES.map(m => {
      const cb = h('input', { type: 'checkbox', value: m.id, dataset: data });
      cb.checked = selected.includes(m.id);
      return h('label', { class: 'muscle-chip' }, cb, h('span', {}, m.label));
    }),
  );
}

// ctx = { used: usedIds(...), editing: id del ejercicio abierto o null }
export function renderLibrary(container, plan, ctx) {
  const active = plan.exercises.filter(e => !e.archived);
  const archived = plan.exercises.filter(e => e.archived);
  fill(container,
    h('section', { class: 'data-box' },
      h('div', { class: 'data-box-title' }, 'Nuevo ejercicio'),
      h('div', { class: 'editor-head' },
        field('Nombre', h('input', {
          type: 'text', id: 'new-exercise-name', class: 'text-input', maxlength: String(PLAN_LIMITS.name),
          autocomplete: 'off', placeholder: 'p. ej. Hip thrust',
        })),
        field('Tipo', typeSelect('traditional', 'Tipo del nuevo ejercicio', { new: 'type' })),
        muscleChecks([], 'new'),
        h('button', { class: 'btn btn-primary', dataset: { action: 'exercise-create' } }, '+ Añadir ejercicio'),
      ),
    ),
    h('section', { class: 'data-box mt-10' },
      h('div', { class: 'data-box-title' }, `Ejercicios (${active.length})`),
      h('div', { class: 'data-box-text' }, 'Un ejercicio con historial no se borra: se archiva. Para borrarlo o archivarlo, quítalo antes de sus rutinas.'),
      h('div', { class: 'editor-list' }, active.map(e => libraryRow(plan, e, ctx))),
      archived.length ? h('details', { class: 'editor-archived' },
        h('summary', {}, `Archivados (${archived.length})`),
        archived.map(e => h('div', { class: 'editor-row' },
          h('div', { class: 'editor-row-main' },
            h('div', { class: 'editor-row-title' }, e.name),
            h('div', { class: 'editor-row-info' }, `${BADGE[e.type].label} · ${muscleText(e.muscles)}`),
          ),
          h('div', { class: 'editor-row-tools' }, btn('exercise-restore', 'Restaurar', { id: e.id }, { label: `Restaurar ${e.name}` })),
        )),
      ) : null,
    ),
  );
}

function libraryRow(plan, e, ctx) {
  const used = ctx.used.exercises.has(e.id);
  const users = routinesUsing(plan, e.id);
  const open = ctx.editing === e.id;
  return h('div', { class: 'editor-row' + (open ? ' open' : ''), dataset: { exercise: e.id } },
    h('div', { class: 'editor-row-main' },
      h('div', { class: 'editor-row-title' }, e.name),
      h('div', { class: 'editor-row-info' }, `${BADGE[e.type].label} · ${muscleText(e.muscles)}` + (users.length ? ` · en ${users.length} rutina${users.length > 1 ? 's' : ''}` : '')),
    ),
    h('div', { class: 'editor-row-tools' },
      btn('exercise-toggle', open ? 'Cerrar' : '✏️ Editar', { id: e.id }, { label: `${open ? 'Cerrar' : 'Editar'} ${e.name}` }),
      btn('exercise-remove', used ? '🗄️' : '🗑', { id: e.id }, { label: used ? `Archivar ${e.name}` : `Borrar ${e.name}` }),
    ),
    open ? h('div', { class: 'editor-head editor-row-edit' },
      field('Nombre', textInput(e.name, PLAN_LIMITS.name, `Nombre de ${e.name}`, 'exercise-name', { id: e.id })),
      field('Tipo', typeSelect(e.type, `Tipo de ${e.name}`, { edit: 'exercise-type', id: e.id })),
      muscleChecks(e.muscles, e.id, { edit: 'exercise-muscles', id: e.id }),
    ) : null,
  );
}
