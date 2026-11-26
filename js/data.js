// Modelo de datos v2 (funciones puras, sin DOM ni almacenamiento).
//
// gymtracker.data = { schemaVersion: 2, sessions: Session[], body: BodyEntry[], settings: Settings }
// BodyEntry = { date: 'YYYY-MM-DD', weight|null (kg), waist|null, chest|null, arm|null, thigh|null (cm) }
//             una entrada por fecha, al menos una medida; `body` es opcional en ficheros v2 antiguos.
// Session  = { id, planSessionId|null, name, startedAt, endedAt|null, notes, exercises: Exercise[] }
// Exercise = { id, name, notes, series: Series[] }
// Series   = { type, target, weight|null, weight2|null, repsDone|null, rpe|null, done }
//
// Validación estricta para lo que dice ser v2 (se rechaza la sesión entera si algo no
// cuadra) y lector tolerante para la v1 (se convierte lo que se pueda).
import { getPlanSession, findPlanSessionByName, findPlanExercise, findLibraryExerciseByName, fieldsFor } from './plan.js';
import { kgToDisplay, unitLabel } from './units.js';

export const SCHEMA_VERSION = 2;
export const SERIES_TYPES = ['normal', 'warmup', 'drop', 'failure'];
export const VALUE_KEYS = ['weight', 'weight2', 'repsDone', 'rpe'];
export const LIMITS = {
  weight: { min: 0, max: 1000 },
  weight2: { min: 0, max: 1000 },
  repsDone: { min: 0, max: 1000, integer: true },
  rpe: { min: 1, max: 10 },
  bodyWeight: { min: 20, max: 500 },
  bodyCm: { min: 10, max: 300 },
  name: 120,
  notes: 2000,
  target: 60,
  exercises: 50,
  series: 50,
  sessions: 20000,
  body: 5000,
  importBytes: 5_000_000,
};

// ==================== AJUSTES ====================
// settings = claves sueltas, todas opcionales; lo que falta toma el valor de SETTINGS_DEFAULTS.
//   units 'kg'|'lb'        solo cambia lo que se ve y se escribe; los pesos se guardan siempre en kg
//   theme 'auto'|'dark'|'light'
//   sound, vibration, progression  booleanos
//   defaultRest  segundos (0-3600) para ejercicios sin descanso propio, p. ej. los sustituidos; 0 = sin descanso
//   bar          peso de la barra en kg (1-100); si falta, 20 kg o 45 lb según la unidad
//   plates       discos disponibles por lado, en kg, de mayor a menor (1-12); si faltan, los de la unidad
// Un ajuste inválido se descarta (vuelve a su valor por defecto) sin invalidar el documento.
export const SETTINGS_DEFAULTS = {
  units: 'kg', theme: 'auto', sound: true, vibration: true, progression: true, defaultRest: 0,
};
export const THEMES = ['auto', 'dark', 'light'];
export const SETTINGS_LIMITS = { bar: { min: 1, max: 100 }, plate: { min: 0.25, max: 100 }, plates: 12 };

const SETTING_CHECKS = {
  units: v => v === 'kg' || v === 'lb',
  theme: v => THEMES.includes(v),
  sound: v => typeof v === 'boolean',
  vibration: v => typeof v === 'boolean',
  progression: v => typeof v === 'boolean',
  defaultRest: v => Number.isInteger(v) && v >= 0 && v <= MAX_REST,
  bar: v => typeof v === 'number' && Number.isFinite(v) && v >= SETTINGS_LIMITS.bar.min && v <= SETTINGS_LIMITS.bar.max,
  plates: v => Array.isArray(v) && v.length >= 1 && v.length <= SETTINGS_LIMITS.plates
    && v.every(p => typeof p === 'number' && Number.isFinite(p) && p >= SETTINGS_LIMITS.plate.min && p <= SETTINGS_LIMITS.plate.max),
};

// Devuelve solo las claves conocidas y válidas. Los discos se ordenan de mayor a menor y sin repetir.
export function validateSettings(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, check] of Object.entries(SETTING_CHECKS)) {
    if (!Object.hasOwn(raw, key) || !check(raw[key])) continue;
    out[key] = key === 'plates' ? [...new Set(raw[key])].sort((a, b) => b - a) : raw[key];
  }
  return out;
}

// Ajustes efectivos: los por defecto con lo guardado encima.
export function getSettings(data) {
  return { ...SETTINGS_DEFAULTS, ...validateSettings(data && data.settings) };
}

// Cambia un ajuste. null borra la clave (vuelve al valor por defecto).
// { ok: true, settings } | { ok: false } sin tocar nada si el valor no es válido.
export function applySetting(settings, key, value) {
  if (!Object.hasOwn(SETTING_CHECKS, key)) return { ok: false };
  const base = validateSettings(settings);
  if (value === null) {
    delete base[key];
    return { ok: true, settings: base };
  }
  const next = validateSettings({ ...base, [key]: value });
  if (!Object.hasOwn(next, key)) return { ok: false };
  return { ok: true, settings: next };
}

// Campos para ejercicios que no están en la biblioteca (libres o de historial importado).
export const GENERIC_FIELDS = [
  { key: 'weight', unit: 'kg', label: 'kg' },
  { key: 'weight2', unit: 'kg', label: 'kg' },
  { key: 'repsDone', unit: 'reps', label: 'reps' },
];

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MIN_TS = Date.UTC(2000, 0, 1);
const MAX_TS = Date.UTC(2100, 0, 1);

class ValidationError extends Error {}

function check(cond, msg) {
  if (!cond) throw new ValidationError(msg);
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isId(v) {
  return typeof v === 'string' && ID_RE.test(v);
}

function isTs(v) {
  return Number.isInteger(v) && v >= MIN_TS && v < MAX_TS;
}

export function newId(now = Date.now()) {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return now.toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, sessions: [], body: [], settings: {} };
}

export function fieldsForExerciseId(id) {
  const ex = findPlanExercise(id);
  return ex ? fieldsFor(ex) : GENERIC_FIELDS;
}

// ==================== VALORES ====================
function inRange(key, n) {
  const lim = LIMITS[key];
  if (!lim || typeof n !== 'number' || !Number.isFinite(n)) return false;
  if (n < lim.min || n > lim.max) return false;
  return !lim.integer || Number.isInteger(n);
}

// Convierte lo que escribe el usuario (o un valor v1) en número validado.
// '' / null → { ok: true, value: null }. Acepta coma decimal.
export function parseValue(key, raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'number') return inRange(key, raw) ? { ok: true, value: raw } : { ok: false, value: null };
  if (typeof raw !== 'string') return { ok: false, value: null };
  const t = raw.trim().replace(',', '.');
  if (t === '') return { ok: true, value: null };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return { ok: false, value: null };
  const n = Number(t);
  return inRange(key, n) ? { ok: true, value: n } : { ok: false, value: null };
}

export function hasValues(series) {
  return ['weight', 'weight2', 'repsDone'].some(k => series[k] !== null && series[k] !== undefined);
}

// ==================== VALIDACIÓN ESTRICTA (v2) ====================
function str(v, max, field, { optional = false, nonEmpty = false } = {}) {
  if (optional && (v === undefined || v === null)) return '';
  check(typeof v === 'string', `${field}: no es texto`);
  check(v.length <= max, `${field}: demasiado largo`);
  check(!nonEmpty || v.trim().length > 0, `${field}: vacío`);
  return v;
}

function num(key, v) {
  if (v === undefined || v === null) return null;
  check(inRange(key, v), `${key}: valor fuera de rango`);
  return v;
}

export function validateSeries(raw) {
  check(isPlainObject(raw), 'serie: no es un objeto');
  check(SERIES_TYPES.includes(raw.type), 'serie: tipo desconocido');
  check(typeof raw.done === 'boolean', 'serie: done no es booleano');
  return {
    type: raw.type,
    target: str(raw.target, LIMITS.target, 'serie.target', { optional: true }),
    weight: num('weight', raw.weight),
    weight2: num('weight2', raw.weight2),
    repsDone: num('repsDone', raw.repsDone),
    rpe: num('rpe', raw.rpe),
    done: raw.done,
  };
}

export function validateExercise(raw) {
  check(isPlainObject(raw), 'ejercicio: no es un objeto');
  check(isId(raw.id), 'ejercicio: id inválido');
  check(Array.isArray(raw.series) && raw.series.length <= LIMITS.series, 'ejercicio: series inválidas');
  return {
    id: raw.id,
    name: str(raw.name, LIMITS.name, 'ejercicio.name', { nonEmpty: true }),
    notes: str(raw.notes, LIMITS.notes, 'ejercicio.notes', { optional: true }),
    series: raw.series.map(validateSeries),
  };
}

function validateSessionOrThrow(raw) {
  check(isPlainObject(raw), 'sesión: no es un objeto');
  check(isId(raw.id), 'sesión: id inválido');
  check(raw.planSessionId === null || raw.planSessionId === undefined || isId(raw.planSessionId), 'sesión: planSessionId inválido');
  check(isTs(raw.startedAt), 'sesión: startedAt inválido');
  check(raw.endedAt === null || raw.endedAt === undefined || (isTs(raw.endedAt) && raw.endedAt >= raw.startedAt), 'sesión: endedAt inválido');
  check(Array.isArray(raw.exercises) && raw.exercises.length <= LIMITS.exercises, 'sesión: ejercicios inválidos');
  return {
    id: raw.id,
    planSessionId: raw.planSessionId ?? null,
    name: str(raw.name, LIMITS.name, 'sesión.name', { nonEmpty: true }),
    startedAt: raw.startedAt,
    endedAt: raw.endedAt ?? null,
    notes: str(raw.notes, LIMITS.notes, 'sesión.notes', { optional: true }),
    exercises: raw.exercises.map(validateExercise),
  };
}

// { ok: true, session } | { ok: false, error }
export function validateSession(raw) {
  try {
    return { ok: true, session: validateSessionOrThrow(raw) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }
}

function collectSessions(list, convert) {
  const sessions = [];
  const rejected = [];
  const seen = new Set();
  list.slice(0, LIMITS.sessions).forEach((raw, index) => {
    const r = convert(raw, index);
    if (!r.ok) rejected.push({ index, error: r.error });
    else if (seen.has(r.session.id)) rejected.push({ index, error: 'sesión: id duplicado' });
    else {
      seen.add(r.session.id);
      sessions.push(r.session);
    }
  });
  if (list.length > LIMITS.sessions) rejected.push({ index: LIMITS.sessions, error: 'demasiadas sesiones' });
  return { sessions, rejected };
}

// ==================== PESO CORPORAL Y MEDIDAS ====================
export const BODY_FIELDS = [
  { key: 'weight', label: 'Peso', unit: 'kg', limits: 'bodyWeight' },
  { key: 'waist', label: 'Cintura', unit: 'cm', limits: 'bodyCm' },
  { key: 'chest', label: 'Pecho', unit: 'cm', limits: 'bodyCm' },
  { key: 'arm', label: 'Brazo', unit: 'cm', limits: 'bodyCm' },
  { key: 'thigh', label: 'Muslo', unit: 'cm', limits: 'bodyCm' },
];

export function isDateKey(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    && t.getTime() >= MIN_TS && t.getTime() < MAX_TS;
}

function bodyNumber(v, limits, field) {
  if (v === undefined || v === null) return null;
  check(typeof v === 'number' && Number.isFinite(v) && v >= limits.min && v <= limits.max, `${field}: valor fuera de rango`);
  return v;
}

export function validateBodyEntry(raw) {
  try {
    check(isPlainObject(raw), 'medida: no es un objeto');
    check(isDateKey(raw.date), 'medida: fecha inválida');
    const entry = { date: raw.date };
    for (const f of BODY_FIELDS) entry[f.key] = bodyNumber(raw[f.key], LIMITS[f.limits], f.key);
    check(BODY_FIELDS.some(f => entry[f.key] !== null), 'medida: sin ningún valor');
    return { ok: true, entry };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }
}

// Convierte lo que escribe el usuario (coma decimal, vacío) en una entrada validada.
export function parseBodyInput(date, raws) {
  const out = { date };
  for (const f of BODY_FIELDS) {
    const raw = raws && raws[f.key];
    if (raw === undefined || raw === null || String(raw).trim() === '') { out[f.key] = null; continue; }
    const t = String(raw).trim().replace(',', '.');
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return { ok: false, error: `${f.label}: valor no válido` };
    out[f.key] = Number(t);
  }
  const r = validateBodyEntry(out);
  return r.ok ? r : { ok: false, error: r.error.replace(/^medida: /, '') };
}

function collectBody(list) {
  const body = [];
  const rejected = [];
  const seen = new Set();
  list.slice(0, LIMITS.body).forEach((raw, index) => {
    const r = validateBodyEntry(raw);
    if (!r.ok) rejected.push({ index, error: r.error, kind: 'body' });
    else if (seen.has(r.entry.date)) rejected.push({ index, error: 'medida: fecha duplicada', kind: 'body' });
    else {
      seen.add(r.entry.date);
      body.push(r.entry);
    }
  });
  if (list.length > LIMITS.body) rejected.push({ index: LIMITS.body, error: 'demasiadas medidas', kind: 'body' });
  body.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { body, rejected };
}

// Una entrada por fecha: guardar de nuevo la misma fecha la sustituye. Devuelve lista nueva ordenada.
export function upsertBody(body, entry) {
  return [...body.filter(b => b.date !== entry.date), entry].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Valida un documento v2 completo. Lanza si la raíz no es v2; las sesiones inválidas
// se devuelven aparte en `rejected` para que quien llama decida.
export function validateData(raw) {
  check(isPlainObject(raw), 'documento: no es un objeto');
  check(raw.schemaVersion === SCHEMA_VERSION, 'documento: schemaVersion no soportada');
  check(Array.isArray(raw.sessions), 'documento: sessions no es una lista');
  check(raw.settings === undefined || isPlainObject(raw.settings), 'documento: settings inválido');
  check(raw.body === undefined || Array.isArray(raw.body), 'documento: body no es una lista');
  const { sessions, rejected } = collectSessions(raw.sessions, validateSession);
  const b = collectBody(raw.body || []);
  return { data: { schemaVersion: SCHEMA_VERSION, sessions, body: b.body, settings: validateSettings(raw.settings) }, rejected: [...rejected, ...b.rejected] };
}

export function tryValidateData(raw) {
  try {
    return { ok: true, ...validateData(raw) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }
}

// ==================== LECTOR TOLERANTE (v1) ====================
function text(v, max) {
  if (typeof v === 'string') return v.slice(0, max);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function v1Timestamp(raw) {
  for (const v of [raw.timestamp, raw.id]) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (isTs(n)) return n;
  }
  const m = typeof raw.date === 'string' && /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.date);
  if (m) {
    const ts = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12).getTime();
    if (isTs(ts)) return ts;
  }
  return null;
}

function lenient(key, raw) {
  return parseValue(key, raw).value;
}

function v1Series(raw, k, planEx) {
  const s = isPlainObject(raw) ? raw : {};
  const out = {
    type: planEx && planEx.series[k] && planEx.series[k].drop ? 'drop' : 'normal',
    target: text(s.reps, LIMITS.target),
    weight: null, weight2: null, repsDone: null, rpe: null, done: false,
  };
  // La v1 guardaba siempre en weight/weight2, aunque la etiqueta fuese "Reps".
  // En superseries se reubica cada valor en el campo que declara el plan.
  const keys = planEx && planEx.type === 'superset'
    ? fieldsFor(planEx).map(f => f.key)
    : ['weight', 'weight2'];
  out[keys[0]] = lenient(keys[0], s.weight);
  if (keys[1]) out[keys[1]] = lenient(keys[1], s.weight2);
  out.done = hasValues(out);
  return out;
}

function v1Session(raw, index, usedIds) {
  if (!isPlainObject(raw)) return { ok: false, error: 'sesión v1: no es un objeto' };
  const startedAt = v1Timestamp(raw);
  if (startedAt === null) return { ok: false, error: 'sesión v1: sin fecha' };
  const plan = findPlanSessionByName(raw.session);
  const rawId = text(raw.id, 64);
  let id = isId(rawId) ? rawId : `v1-${startedAt}-${index}`;
  if (usedIds.has(id)) id = `v1-${startedAt}-${index}`;
  usedIds.add(id);

  const exercises = (Array.isArray(raw.exercises) ? raw.exercises : [])
    .filter(isPlainObject)
    .slice(0, LIMITS.exercises)
    .map((ex, j) => {
      const planEx = (plan && plan.exercises.find(e => e.name === ex.name)) || null;
      const name = text(ex.name, LIMITS.name) || 'Ejercicio';
      return {
        // Fuera del plan, el id sale del nombre (como al sustituir en una sesión): el id posicional
        // fusionaba ejercicios distintos que ocupaban el mismo lugar en sesiones distintas.
        id: planEx ? planEx.id : slugId(name),
        name,
        notes: '',
        series: (Array.isArray(ex.series) ? ex.series : []).slice(0, LIMITS.series).map((s, k) => v1Series(s, k, planEx)),
      };
    });

  return validateSession({
    id,
    planSessionId: plan ? plan.id : null,
    name: text(raw.session, LIMITS.name).trim() ? text(raw.session, LIMITS.name) : 'Sesión',
    startedAt,
    endedAt: null,
    notes: '',
    exercises,
  });
}

export function fromV1Sessions(list) {
  if (!Array.isArray(list)) return { sessions: [], rejected: [] };
  const usedIds = new Set();
  return collectSessions(list, (raw, i) => v1Session(raw, i, usedIds));
}

// ==================== BORRADOR ====================
// Draft   = { schemaVersion, id, planSessionId, startedAt, notes, exercises: DraftExercise[] }
// DraftExercise = { id, name, notes, substituteFor|null, series: DraftSeries[] }
// DraftSeries   = Series + rest (segundos de descanso tras la serie; 0 = sin descanso)
// El borrador es autodescriptivo: se pueden añadir/quitar series, reordenar y sustituir
// ejercicios sin que el índice siga alineado con el plan.
// Único límite de descanso (segundos): editor del plan, ajuste, descanso por ejercicio y temporizador.
export const MAX_REST = 3600;

function blankSeries(planSerie) {
  return {
    type: planSerie.drop ? 'drop' : 'normal',
    target: planSerie.reps,
    rest: planSerie.rest,
    weight: null, weight2: null, repsDone: null, rpe: null, done: false,
  };
}

function genericSeries(over = {}) {
  return { type: 'normal', target: '', rest: 0, weight: null, weight2: null, repsDone: null, rpe: null, done: false, ...over };
}

function baseDraft(planSessionId, now) {
  const p = getPlanSession(planSessionId);
  if (!p) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(now),
    planSessionId: p.id,
    startedAt: now,
    notes: '',
    exercises: p.exercises.map(ex => ({
      id: ex.id, name: ex.name, notes: '', substituteFor: null, series: ex.series.map(blankSeries),
    })),
  };
}

// Borrador nuevo de una rutina. null si la rutina no existe o no tiene ejercicios.
export function createDraft(planSessionId, now = Date.now()) {
  const d = baseDraft(planSessionId, now);
  return d && d.exercises.length ? d : null;
}

function clampText(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function restoreSeries(r, ref) {
  const s = ref ? { ...ref } : genericSeries();
  if (!isPlainObject(r)) return s;
  for (const k of VALUE_KEYS) if (inRange(k, r[k])) s[k] = r[k];
  if (SERIES_TYPES.includes(r.type)) s.type = r.type;
  if (typeof r.target === 'string') s.target = r.target.slice(0, LIMITS.target);
  if (Number.isInteger(r.rest) && r.rest >= 0 && r.rest <= MAX_REST) s.rest = r.rest;
  s.done = typeof r.done === 'boolean' ? r.done : hasValues(s);
  return s;
}

function restoreExercise(src, base) {
  if (!isPlainObject(src) || !isId(src.id)) return null;
  const planEx = findPlanExercise(src.id);
  const name = typeof src.name === 'string' && src.name.trim() ? src.name.slice(0, LIMITS.name) : (planEx ? planEx.name : null);
  if (!name) return null;
  const ref = base.exercises.find(e => e.id === src.id);
  const raw = Array.isArray(src.series) ? src.series.slice(0, LIMITS.series) : [];
  const refAt = i => (ref ? (ref.series[i] || ref.series[ref.series.length - 1]) : null);
  const series = raw.length
    ? raw.map((r, i) => restoreSeries(r, refAt(i)))
    : (ref ? ref.series.map(s => ({ ...s })) : [genericSeries()]);
  return {
    id: src.id,
    name,
    notes: clampText(src.notes, LIMITS.notes),
    substituteFor: typeof src.substituteFor === 'string' && src.substituteFor ? src.substituteFor.slice(0, LIMITS.name) : null,
    series,
  };
}

// Reconstruye un borrador guardado. Lo que no encaje se descarta valor a valor; los ejercicios
// sin forma válida se omiten y, si no queda ninguno, se parte del plan.
export function restoreDraft(raw, now = Date.now()) {
  if (!isPlainObject(raw) || !isId(raw.planSessionId)) return null;
  // La rutina pudo editarse después de empezar: el borrador guardado manda, la rutina solo rellena huecos.
  const draft = baseDraft(raw.planSessionId, isTs(raw.startedAt) ? raw.startedAt : now);
  if (!draft) return null;
  if (isId(raw.id)) draft.id = raw.id;
  draft.notes = clampText(raw.notes, LIMITS.notes);
  if (Array.isArray(raw.exercises)) {
    const seen = new Set();
    const restored = raw.exercises.slice(0, LIMITS.exercises)
      .map(e => restoreExercise(e, draft))
      .filter(e => e && !seen.has(e.id) && seen.add(e.id));
    if (restored.length) draft.exercises = restored;
  }
  return draft.exercises.length ? draft : null;
}

function fieldsAt(draft, exIdx) {
  const ex = draft && draft.exercises[exIdx];
  return ex ? fieldsForExerciseId(ex.id) : null;
}

// Aplica lo que escribe el usuario en una serie. Solo admite campos declarados por el ejercicio.
// Escribir no marca la serie como hecha; vaciar todos los valores sí la desmarca.
export function setDraftValue(draft, exIdx, seriesIdx, key, raw) {
  const fields = fieldsAt(draft, exIdx);
  const s = fields && draft.exercises[exIdx].series[seriesIdx];
  if (!s || !fields.some(f => f.key === key)) return { ok: false, value: null };
  const r = parseValue(key, raw);
  if (!r.ok) return r;
  s[key] = r.value;
  if (!hasValues(s)) s.done = false;
  return r;
}

// Copia a la serie los valores de `source` solo en los campos del ejercicio y solo donde
// la serie está vacía. Devuelve true si cambió algo.
export function fillSeries(draft, exIdx, seriesIdx, source) {
  const fields = fieldsAt(draft, exIdx);
  const s = fields && draft.exercises[exIdx].series[seriesIdx];
  if (!s || !source) return false;
  let changed = false;
  fields.forEach(f => {
    const v = source[f.key];
    if ((s[f.key] === null || s[f.key] === undefined) && typeof v === 'number' && inRange(f.key, v)) {
      s[f.key] = v;
      changed = true;
    }
  });
  return changed;
}

// Marca o desmarca una serie como hecha. Si está vacía, copia primero la serie de encima
// (si tiene valores) o, si no, la de la sesión anterior (`fallback`).
// { ok: true, done, copied } | { ok: false, error: 'empty' | 'invalid' }
export function toggleSeriesDone(draft, exIdx, seriesIdx, fallback = null) {
  const ex = draft && draft.exercises[exIdx];
  const s = ex && ex.series[seriesIdx];
  if (!s) return { ok: false, error: 'invalid' };
  if (s.done) {
    s.done = false;
    return { ok: true, done: false, copied: false };
  }
  let copied = false;
  if (!hasValues(s)) {
    const above = seriesIdx > 0 ? ex.series[seriesIdx - 1] : null;
    copied = fillSeries(draft, exIdx, seriesIdx, above && hasValues(above) ? above : fallback);
    if (!copied) return { ok: false, error: 'empty' };
  }
  s.done = true;
  return { ok: true, done: true, copied };
}

// Descanso por defecto de un ejercicio: el mayor descanso de sus series.
export function defaultRest(ex) {
  return ex.series.reduce((m, s) => Math.max(m, s.rest || 0), 0);
}

// Descanso que arranca al hacer una serie: el ajuste del usuario para el ejercicio
// (0 = sin descanso) o el de la propia serie. null si no hay descanso.
export function restForSeries(draft, exIdx, seriesIdx, overrides = {}, fallback = 0) {
  const ex = draft && draft.exercises[exIdx];
  const s = ex && ex.series[seriesIdx];
  if (!s) return null;
  const o = overrides && Object.hasOwn(overrides, ex.id) ? overrides[ex.id] : undefined;
  // `fallback` (descanso por defecto del usuario) solo se aplica a ejercicios sin descanso propio en ninguna serie.
  const sec = Number.isFinite(o) ? o : (s.rest || (defaultRest(ex) === 0 ? fallback : 0));
  return sec > 0 ? Math.min(sec, MAX_REST) : null;
}

export function addSeries(draft, exIdx) {
  const ex = draft && draft.exercises[exIdx];
  if (!ex || ex.series.length >= LIMITS.series) return false;
  const lastNormal = [...ex.series].reverse().find(s => s.type === 'normal');
  ex.series.push(genericSeries({ target: lastNormal ? lastNormal.target : '', rest: defaultRest(ex) }));
  return true;
}

// Quita la última serie (nunca la única). Devuelve { index, series } para poder deshacer.
export function removeLastSeries(draft, exIdx) {
  const ex = draft && draft.exercises[exIdx];
  if (!ex || ex.series.length <= 1) return null;
  const index = ex.series.length - 1;
  return { index, series: ex.series.pop() };
}

export function insertSeries(draft, exIdx, index, series) {
  const ex = draft && draft.exercises[exIdx];
  if (!ex || ex.series.length >= LIMITS.series) return false;
  ex.series.splice(Math.min(Math.max(index, 0), ex.series.length), 0, series);
  return true;
}

// Mueve un ejercicio una posición (dir -1 o 1). Devuelve el índice nuevo o -1.
export function moveExercise(draft, exIdx, dir) {
  const list = draft && draft.exercises;
  const to = exIdx + dir;
  if (!list || (dir !== -1 && dir !== 1) || !list[exIdx] || !list[to]) return -1;
  [list[exIdx], list[to]] = [list[to], list[exIdx]];
  return to;
}

export function slugId(name) {
  const slug = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return slug ? `x-${slug}` : `x-${newId().slice(0, 12)}`;
}

// Sustituye un ejercicio por otro de la biblioteca (si el nombre coincide, aunque esté archivado) o por uno libre.
// Conserva el número de series y su descanso; los valores se vacían.
// { ok: true, id } | { ok: false, error: 'invalid' | 'name' | 'duplicate' }
export function substituteExercise(draft, exIdx, rawName) {
  const ex = draft && draft.exercises[exIdx];
  if (!ex) return { ok: false, error: 'invalid' };
  const name = String(rawName ?? '').trim();
  if (!name || name.length > LIMITS.name) return { ok: false, error: 'name' };
  const planEx = findLibraryExerciseByName(name);
  const id = planEx ? planEx.id : slugId(name);
  if (id === ex.id) return { ok: true, id, same: true };
  if (draft.exercises.some(e => e.id === id)) return { ok: false, error: 'duplicate' };
  const rest = defaultRest(ex);
  const origin = ex.substituteFor || ex.name;
  ex.id = id;
  ex.name = planEx ? planEx.name : name;
  ex.substituteFor = origin;
  ex.notes = '';
  ex.series = ex.series.map(() => genericSeries({ rest }));
  return { ok: true, id };
}

export function setNote(draft, exIdx, raw) {
  const text = typeof raw === 'string' ? raw.slice(0, LIMITS.notes) : '';
  if (exIdx === null) {
    if (!draft) return false;
    draft.notes = text;
    return true;
  }
  const ex = draft && draft.exercises[exIdx];
  if (!ex) return false;
  ex.notes = text;
  return true;
}

// total: series del borrador. filled: series con algún valor. missing: series sin ningún valor.
// unchecked: series con valores pero sin ✓; al guardar no cuentan (récords, volumen ni sobrecarga).
export function draftStats(draft) {
  let total = 0;
  let filled = 0;
  let unchecked = 0;
  (draft ? draft.exercises : []).forEach(ex => ex.series.forEach(s => {
    total += 1;
    if (hasValues(s)) {
      filled += 1;
      if (!s.done) unchecked += 1;
    }
  }));
  return { total, filled, missing: total - filled, unchecked };
}

// Convierte el borrador en una sesión v2 validada. Devuelve { ok, session } | { ok:false, error }.
export function finalizeDraft(draft, now = Date.now()) {
  const p = draft && getPlanSession(draft.planSessionId);
  if (!p) return { ok: false, error: 'borrador sin sesión del plan' };
  return validateSession({
    id: draft.id,
    planSessionId: p.id,
    name: p.name,
    startedAt: draft.startedAt,
    endedAt: Math.max(now, draft.startedAt),
    notes: draft.notes,
    exercises: draft.exercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      notes: ex.notes,
      series: ex.series.map(s => ({
        type: s.type, target: s.target, weight: s.weight, weight2: s.weight2,
        repsDone: s.repsDone, rpe: s.rpe, done: !!s.done && hasValues(s),
      })),
    })),
  });
}

// Series de la última sesión guardada del mismo tipo, por id de ejercicio.
export function previousFor(sessions, planSessionId) {
  const last = sessions
    .filter(s => s.planSessionId === planSessionId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const map = new Map();
  if (last) last.exercises.forEach(ex => map.set(ex.id, ex.series));
  return map;
}

// ==================== FORMATO ====================
const TYPE_LABEL = { warmup: 'calentamiento', drop: 'drop', failure: 'fallo' };

function fmtNum(n) {
  return String(n);
}

// Pesos de carga: en la unidad activa. Las reps y el RPE no se convierten.
function fmtField(f, n) {
  return f.unit === 'kg' ? fmtNum(kgToDisplay(n)) : fmtNum(n);
}

export function formatSeriesValues(s, fields) {
  const named = fields.some(f => f.label !== f.unit);
  const present = fields.filter(f => s[f.key] !== null && s[f.key] !== undefined);
  if (present.length === 0) return 'sin datos';
  if (named) {
    return present.map(f => `${f.label} ${fmtField(f, s[f.key])}${f.unit === 'kg' ? unitLabel() : ' reps'}`).join(' + ');
  }
  const kg = present.filter(f => f.unit === 'kg').map(f => `${fmtField(f, s[f.key])}${unitLabel()}`).join(' + ');
  const reps = present.find(f => f.unit === 'reps');
  if (kg && reps) return `${kg} × ${fmtNum(s[reps.key])}`;
  return kg || `${fmtNum(s[reps.key])} reps`;
}

export function formatSeriesLine(s, i, fields) {
  const tag = TYPE_LABEL[s.type] ? ` [${TYPE_LABEL[s.type]}]` : '';
  const target = s.target ? ` (obj. ${s.target})` : '';
  const rpe = s.rpe !== null && s.rpe !== undefined ? ` @RPE ${fmtNum(s.rpe)}` : '';
  return `Serie ${i + 1}${tag}: ${formatSeriesValues(s, fields)}${rpe}${target}`;
}

// Texto corto de la serie anterior para placeholder/aria ("22.5 × 8").
export function formatPrevious(s, fields) {
  if (!s || !hasValues(s)) return '';
  return formatSeriesValues(s, fields);
}

// Texto compacto de la serie anterior para la columna "Anterior" ("22.5 × 8").
export function formatPreviousShort(s, fields) {
  if (!s || !hasValues(s)) return '';
  return fields.filter(f => s[f.key] !== null && s[f.key] !== undefined).map(f => fmtField(f, s[f.key])).join(' × ');
}

export function buildSummaryText(session, dateLabel) {
  const lines = [`📅 ${dateLabel} — ${session.name}`];
  if (session.endedAt) {
    const min = Math.round((session.endedAt - session.startedAt) / 60000);
    lines.push(`⏱ ${min} min`);
  }
  if (session.notes) lines.push(`📝 ${session.notes}`);
  lines.push('');
  session.exercises.forEach(ex => {
    const fields = fieldsForExerciseId(ex.id);
    lines.push(`▸ ${ex.name}`);
    if (ex.notes) lines.push(`  📝 ${ex.notes}`);
    ex.series.forEach((s, i) => lines.push('  ' + formatSeriesLine(s, i, fields)));
    lines.push('');
  });
  return `[GUARDAR SESIÓN]\n${lines.join('\n')}`;
}

// ==================== EXPORT / IMPORT ====================
export function buildExport(data, now = Date.now()) {
  return {
    app: 'gym-tracker',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    sessions: data.sessions,
    body: data.body || [],
    settings: data.settings,
  };
}

// Analiza un fichero de import. No modifica nada: devuelve lo que se fusionaría.
// { ok: false, error } | { ok: true, format, sessions, fresh, duplicates, rejected, freshBody }
export function parseImport(textContent, existing = [], existingBody = []) {
  if (typeof textContent !== 'string') return { ok: false, error: 'Fichero ilegible' };
  if (textContent.length > LIMITS.importBytes) return { ok: false, error: 'Fichero demasiado grande' };
  let raw;
  try {
    raw = JSON.parse(textContent);
  } catch {
    return { ok: false, error: 'El fichero no es JSON válido' };
  }

  let result;
  let format;
  let body = [];
  if (Array.isArray(raw)) {
    format = 'v1';
    result = fromV1Sessions(raw);
  } else if (isPlainObject(raw) && raw.schemaVersion === SCHEMA_VERSION) {
    format = 'v2';
    const r = tryValidateData(raw);
    if (!r.ok) return { ok: false, error: `Formato inválido: ${r.error}` };
    result = { sessions: r.data.sessions, rejected: r.rejected };
    body = r.data.body;
  } else if (isPlainObject(raw) && typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: 'El fichero es de una versión más nueva de la app' };
  } else {
    return { ok: false, error: 'Formato desconocido' };
  }

  const known = new Set(existing.map(s => s.id));
  const knownDates = new Set(existingBody.map(b => b.date));
  const fresh = result.sessions.filter(s => !known.has(s.id));
  return {
    ok: true,
    format,
    sessions: result.sessions,
    fresh,
    duplicates: result.sessions.length - fresh.length,
    rejected: result.rejected,
    freshBody: body.filter(b => !knownDates.has(b.date)),
  };
}

// Fusión por id: lo local nunca se sobrescribe; solo se añaden ids nuevos.
export function mergeBody(existing, incoming) {
  const known = new Set(existing.map(b => b.date));
  const added = incoming.filter(b => !known.has(b.date));
  return { body: [...existing, ...added].sort((a, b) => (a.date < b.date ? -1 : 1)), added: added.length };
}

export function mergeSessions(existing, incoming) {
  const known = new Set(existing.map(s => s.id));
  const added = incoming.filter(s => !known.has(s.id));
  return { sessions: [...existing, ...added], added: added.length };
}

// ==================== CSV ====================
export const CSV_HEADER = [
  'session_id', 'started_at', 'ended_at', 'session', 'exercise_id', 'exercise', 'set', 'type',
  'target', 'weight', 'weight2', 'reps_done', 'rpe', 'done', 'session_notes', 'exercise_notes',
];

// Escapa una celda y neutraliza fórmulas (=, +, -, @, tab, CR) al abrirla en una hoja de cálculo.
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(sessions) {
  const iso = ts => (ts ? new Date(ts).toISOString() : '');
  const rows = [CSV_HEADER];
  [...sessions].sort((a, b) => a.startedAt - b.startedAt).forEach(sess => {
    sess.exercises.forEach(ex => ex.series.forEach((s, i) => rows.push([
      sess.id, iso(sess.startedAt), iso(sess.endedAt), sess.name, ex.id, ex.name, i + 1, s.type,
      s.target, s.weight, s.weight2, s.repsDone, s.rpe, s.done, sess.notes, ex.notes,
    ])));
  });
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
