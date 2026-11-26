// Pantallas de ajustes y de calculadora de discos. Solo render y parseo de formularios; el estado vive en app.js.
import { h } from './views.js';
import { THEMES, SETTINGS_LIMITS } from './data.js';
import { formatRest } from './timers.js';
import { kgToDisplay, inputToKg, lbToKg, unitLabel, getUnit, parseDecimal } from './units.js';
import { DEFAULT_BAR, DEFAULT_PLATES, plateBreakdown } from './progress.js';

const THEME_LABEL = { auto: 'Sistema', dark: 'Oscuro', light: 'Claro' };

function segmented(key, label, options, current) {
  return h('div', { class: 'setting-row' },
    h('div', { class: 'setting-label' }, label),
    h('div', { class: 'segmented', role: 'group', 'aria-label': label },
      options.map(([value, text]) => h('button', {
        class: 'seg-btn', 'aria-pressed': String(current === value), dataset: { action: 'set-setting', key, value },
      }, text))),
  );
}

function toggle(key, label, hint, on) {
  return h('div', { class: 'setting-row' },
    h('div', { class: 'setting-text' },
      h('div', { class: 'setting-label' }, label),
      hint ? h('div', { class: 'setting-hint' }, hint) : null),
    h('button', {
      class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': label, dataset: { action: 'toggle-setting', key },
    }, on ? 'Sí' : 'No'),
  );
}

// settings: ajustes efectivos (getSettings).
export function renderSettings(container, settings) {
  const rest = settings.defaultRest;
  container.replaceChildren(
    h('section', { class: 'data-box' },
      h('div', { class: 'data-box-title' }, 'Apariencia y unidades'),
      segmented('units', 'Unidades de peso', [['kg', 'kg'], ['lb', 'lb']], settings.units),
      h('div', { class: 'setting-hint' }, 'Los pesos se guardan siempre en kg; la unidad solo cambia lo que ves y lo que escribes. Al cambiarla, la barra y los discos de la calculadora vuelven a los valores por defecto.'),
      segmented('theme', 'Tema', THEMES.map(t => [t, THEME_LABEL[t]]), settings.theme),
    ),
    h('section', { class: 'data-box mt-10' },
      h('div', { class: 'data-box-title' }, 'Descanso y avisos'),
      toggle('sound', 'Sonido al acabar el descanso', null, settings.sound),
      toggle('vibration', 'Vibración al acabar el descanso', null, settings.vibration),
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-label' }, 'Descanso por defecto'),
          h('div', { class: 'setting-hint' }, 'Para ejercicios sin descanso propio, como los sustituidos. Los del plan mantienen el suyo.')),
        h('div', { class: 'rest-step', role: 'group', 'aria-label': 'Descanso por defecto' },
          h('button', { class: 'tool-btn', 'aria-label': 'Restar 15 segundos', dataset: { action: 'step-setting', key: 'defaultRest', delta: '-15' } }, '−'),
          h('span', { class: 'rest-step-value', id: 'default-rest-value' }, rest > 0 ? '⏱ ' + formatRest(rest) : '⏱ sin descanso'),
          h('button', { class: 'tool-btn', 'aria-label': 'Sumar 15 segundos', dataset: { action: 'step-setting', key: 'defaultRest', delta: '15' } }, '+'),
        )),
    ),
    h('section', { class: 'data-box mt-10' },
      h('div', { class: 'data-box-title' }, 'Progresión'),
      toggle('progression', 'Sugerencias y avisos', 'Sugerencia de carga en cada ejercicio y avisos de descarga.', settings.progression),
      h('div', { class: 'explain' },
        h('p', {}, 'Sobrecarga: si en la última sesión de un ejercicio con rango de repeticiones (p. ej. 8-10) hiciste todas las series del plan y en todas llegaste al tope del rango, se sugiere subir la carga 2,5 kg (5 lb) sobre la más alta. Si no, se muestra qué falta. No se aplica a drop sets, myo-reps, superseries ni circuitos.'),
        h('p', {}, 'Descarga: aviso tras 6 semanas seguidas entrenando, o si el 1RM estimado de un ejercicio queda por debajo del 95 % de su mejor valor reciente en las dos últimas sesiones.'),
        h('p', {}, 'Son reglas fijas y orientativas para organizar el entreno. No son asesoramiento médico ni un plan personalizado.')),
    ),
    h('button', { class: 'btn btn-secondary mt-10', dataset: { action: 'open-plates' } }, '🧮 Calculadora de discos'),
  );
}

// ==================== DISCOS ====================
function num(kg) {
  return String(kgToDisplay(kg)).replace('.', ',');
}

// ctx: { totalKg|null, barKg, platesKg }  (barra y discos efectivos, en kg)
export function renderPlates(container, ctx) {
  const unit = unitLabel();
  container.replaceChildren(
    h('div', { class: 'body-form' },
      h('label', { class: 'field' }, h('span', {}, `Peso total (${unit})`),
        h('input', {
          type: 'text', inputmode: 'decimal', id: 'plates-total', class: 'text-input plates-input', autocomplete: 'off', maxlength: '7',
          value: ctx.totalKg ? num(ctx.totalKg) : '',
        })),
      h('div', { class: 'body-grid' },
        h('label', { class: 'field' }, h('span', {}, `Barra (${unit})`),
          h('input', { type: 'text', inputmode: 'decimal', id: 'plates-bar', class: 'text-input plates-input', autocomplete: 'off', maxlength: '7', value: num(ctx.barKg) })),
        h('label', { class: 'field' }, h('span', {}, `Discos por lado (${unit})`),
          h('input', { type: 'text', id: 'plates-list', class: 'text-input plates-input', autocomplete: 'off', maxlength: '80', value: ctx.platesKg.map(num).join(' ') })),
      ),
      h('div', { class: 'setting-hint' }, 'Separa los discos con espacios. Se usan de mayor a menor, sin límite de unidades por tamaño.'),
      h('div', { class: 'field-error', id: 'plates-error', role: 'alert', hidden: 'hidden' }),
      h('div', { class: 'data-actions mt-10' },
        h('button', { class: 'btn btn-secondary', dataset: { action: 'save-plates' } }, 'Guardar barra y discos'),
        h('button', { class: 'btn btn-secondary', dataset: { action: 'reset-plates' } }, 'Valores por defecto'),
      ),
    ),
    h('div', { class: 'stat-card', id: 'plates-result', 'aria-live': 'polite' }),
  );
}

// Lee el formulario en kg. → { totalKg|null, barKg|null, platesKg|null (null si algo no es válido), error }
export function readPlatesForm(root = document) {
  const val = id => (root.getElementById ? root.getElementById(id) : root.querySelector('#' + id)).value;
  const parse = raw => {
    const n = parseDecimal(raw);
    return n !== null && n > 0 ? inputToKg(n) : null;
  };
  const total = String(val('plates-total')).trim() === '' ? null : parse(val('plates-total'));
  const bar = parse(val('plates-bar'));
  const tokens = String(val('plates-list')).trim().split(/[\s;]+/).filter(Boolean);
  const plates = tokens.map(parse);
  let error = '';
  if (total === null && String(val('plates-total')).trim() !== '') error = 'Peso total no válido';
  else if (bar === null) error = 'Barra no válida';
  else if (bar < SETTINGS_LIMITS.bar.min || bar > SETTINGS_LIMITS.bar.max) error = 'La barra queda fuera de rango';
  else if (!tokens.length || plates.some(p => p === null)) error = 'Discos no válidos';
  else if (plates.some(p => p < SETTINGS_LIMITS.plate.min || p > SETTINGS_LIMITS.plate.max)) error = 'Algún disco queda fuera de rango';
  else if (tokens.length > SETTINGS_LIMITS.plates) error = `Máximo ${SETTINGS_LIMITS.plates} tamaños de disco`;
  return { totalKg: total, barKg: bar, platesKg: error ? null : plates, error };
}

export function renderPlateResult(el, form) {
  const err = document.getElementById('plates-error');
  err.textContent = form.error;
  err.hidden = !form.error;
  if (form.error || form.totalKg === null) {
    el.replaceChildren(h('div', { class: 'chart-note' }, form.error ? '' : 'Escribe el peso total que quieres montar.'));
    return null;
  }
  const r = plateBreakdown(form.totalKg, form.barKg, form.platesKg);
  if (!r.ok) {
    el.replaceChildren(h('div', { class: 'plates-line warn' }, r.error === 'below-bar' ? 'El peso es menor que el de la barra.' : 'No hay discos válidos.'));
    return r;
  }
  const unit = unitLabel();
  const parts = r.perSide.map(p => `${p.count} × ${num(p.plate)} ${unit}`);
  el.replaceChildren(
    h('div', { class: 'stat-title' }, 'Por cada lado'),
    r.perSide.length
      ? h('ul', { class: 'plates-list' }, r.perSide.map(p => h('li', { dataset: { plate: String(p.plate) } }, `${p.count} × ${num(p.plate)} ${unit}`)))
      : h('div', { class: 'plates-line' }, 'Solo la barra'),
    h('div', { class: 'plates-line', id: 'plates-sum' }, `Total montado: ${num(r.achieved)} ${unit}${parts.length ? ` (barra ${num(form.barKg)} + 2 × ${parts.join(' + ')})` : ''}`),
    ...(r.remainder > 0 ? [h('div', { class: 'plates-line warn', id: 'plates-warn' }, `No se llega exacto: faltan ${num(r.remainder * 2)} ${unit} (${num(r.remainder)} por lado) con estos discos.`)] : []),
  );
  return r;
}

export function defaultBarKg(unit = getUnit()) {
  return unit === 'lb' ? lbToKg(DEFAULT_BAR.lb) : DEFAULT_BAR.kg;
}

export function defaultPlatesKg(unit = getUnit()) {
  return unit === 'lb' ? DEFAULT_PLATES.lb.map(lbToKg) : [...DEFAULT_PLATES.kg];
}
