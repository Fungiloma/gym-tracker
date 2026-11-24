// Modelo de datos v2 (funciones puras, sin DOM ni almacenamiento).
//
// gymtracker.data = { schemaVersion: 2, sessions: Session[], settings: {} }
// Session  = { id, planSessionId|null, name, startedAt, endedAt|null, notes, exercises: Exercise[] }
// Exercise = { id, name, notes, series: Series[] }
// Series   = { type, target, weight|null, weight2|null, repsDone|null, rpe|null, done }
//
// Validación estricta para lo que dice ser v2 (se rechaza la sesión entera si algo no
// cuadra) y lector tolerante para la v1 (se convierte lo que se pueda).
import { getPlanSession, findPlanSessionByName, findPlanExercise, fieldsFor } from './plan.js';

export const SCHEMA_VERSION = 2;
export const SERIES_TYPES = ['normal', 'warmup', 'drop', 'failure'];
export const VALUE_KEYS = ['weight', 'weight2', 'repsDone', 'rpe'];
export const LIMITS = {
  weight: { min: 0, max: 1000 },
  weight2: { min: 0, max: 1000 },
  repsDone: { min: 0, max: 1000, integer: true },
  rpe: { min: 1, max: 10 },
  name: 120,
  notes: 2000,
  target: 60,
  exercises: 50,
  series: 50,
  sessions: 20000,
  importBytes: 5_000_000,
};

// Campos para ejercicios que ya no están en el plan (historial importado).
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
  return { schemaVersion: SCHEMA_VERSION, sessions: [], settings: {} };
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

// Valida un documento v2 completo. Lanza si la raíz no es v2; las sesiones inválidas
// se devuelven aparte en `rejected` para que quien llama decida.
export function validateData(raw) {
  check(isPlainObject(raw), 'documento: no es un objeto');
  check(raw.schemaVersion === SCHEMA_VERSION, 'documento: schemaVersion no soportada');
  check(Array.isArray(raw.sessions), 'documento: sessions no es una lista');
  check(raw.settings === undefined || isPlainObject(raw.settings), 'documento: settings inválido');
  const { sessions, rejected } = collectSessions(raw.sessions, validateSession);
  // Aún no hay ajustes conocidos (fase 5): se descarta cualquier clave.
  return { data: { schemaVersion: SCHEMA_VERSION, sessions, settings: {} }, rejected };
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
      return {
        id: planEx ? planEx.id : `v1-ex-${j}`,
        name: text(ex.name, LIMITS.name) || 'Ejercicio',
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
function blankSeries(planSerie) {
  return {
    type: planSerie.drop ? 'drop' : 'normal',
    target: planSerie.reps,
    weight: null, weight2: null, repsDone: null, rpe: null, done: false,
  };
}

export function createDraft(planSessionId, now = Date.now()) {
  const p = getPlanSession(planSessionId);
  if (!p) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(now),
    planSessionId: p.id,
    startedAt: now,
    notes: '',
    exercises: p.exercises.map(ex => ({ id: ex.id, notes: '', series: ex.series.map(blankSeries) })),
  };
}

// Reconstruye un borrador guardado contra el plan actual. Lo que no encaje se descarta
// valor a valor; nunca se devuelve un borrador con forma distinta a la del plan.
export function restoreDraft(raw, now = Date.now()) {
  if (!isPlainObject(raw) || !isId(raw.planSessionId)) return null;
  const draft = createDraft(raw.planSessionId, isTs(raw.startedAt) ? raw.startedAt : now);
  if (!draft) return null;
  if (isId(raw.id)) draft.id = raw.id;
  if (typeof raw.notes === 'string') draft.notes = raw.notes.slice(0, LIMITS.notes);
  const saved = Array.isArray(raw.exercises) ? raw.exercises.filter(isPlainObject) : [];
  draft.exercises.forEach(ex => {
    const src = saved.find(e => e.id === ex.id);
    if (!src) return;
    if (typeof src.notes === 'string') ex.notes = src.notes.slice(0, LIMITS.notes);
    const series = Array.isArray(src.series) ? src.series : [];
    ex.series.forEach((s, i) => {
      const r = series[i];
      if (!isPlainObject(r)) return;
      for (const k of VALUE_KEYS) if (inRange(k, r[k])) s[k] = r[k];
      if (SERIES_TYPES.includes(r.type)) s.type = r.type;
      s.done = typeof r.done === 'boolean' ? r.done : hasValues(s);
    });
  });
  return draft;
}

// Aplica lo que escribe el usuario en una serie. Solo admite campos declarados por el plan.
export function setDraftValue(draft, exIdx, seriesIdx, key, raw) {
  const p = draft && getPlanSession(draft.planSessionId);
  const planEx = p && p.exercises[exIdx];
  const ex = draft && draft.exercises[exIdx];
  const s = ex && ex.series[seriesIdx];
  if (!planEx || !s || ex.id !== planEx.id) return { ok: false, value: null };
  if (!fieldsFor(planEx).some(f => f.key === key)) return { ok: false, value: null };
  const r = parseValue(key, raw);
  if (!r.ok) return r;
  s[key] = r.value;
  s.done = hasValues(s);
  return r;
}

export function draftStats(draft) {
  let total = 0;
  let filled = 0;
  (draft ? draft.exercises : []).forEach(ex => ex.series.forEach(s => {
    total += 1;
    if (hasValues(s)) filled += 1;
  }));
  return { total, filled, missing: total - filled };
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
    exercises: draft.exercises.map((ex, i) => ({
      id: ex.id,
      name: p.exercises[i].name,
      notes: ex.notes,
      series: ex.series.map(s => ({ ...s, done: hasValues(s) })),
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

export function formatSeriesValues(s, fields) {
  const named = fields.some(f => f.label !== f.unit);
  const present = fields.filter(f => s[f.key] !== null && s[f.key] !== undefined);
  if (present.length === 0) return 'sin datos';
  if (named) {
    return present.map(f => `${f.label} ${fmtNum(s[f.key])}${f.unit === 'kg' ? 'kg' : ' reps'}`).join(' + ');
  }
  const kg = present.filter(f => f.unit === 'kg').map(f => `${fmtNum(s[f.key])}kg`).join(' + ');
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
    settings: data.settings,
  };
}

// Analiza un fichero de import. No modifica nada: devuelve lo que se fusionaría.
// { ok: false, error } | { ok: true, format, sessions, fresh, duplicates, rejected }
export function parseImport(textContent, existing = []) {
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
  if (Array.isArray(raw)) {
    format = 'v1';
    result = fromV1Sessions(raw);
  } else if (isPlainObject(raw) && raw.schemaVersion === SCHEMA_VERSION) {
    format = 'v2';
    const r = tryValidateData(raw);
    if (!r.ok) return { ok: false, error: `Formato inválido: ${r.error}` };
    result = { sessions: r.data.sessions, rejected: r.rejected };
  } else if (isPlainObject(raw) && typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: 'El fichero es de una versión más nueva de la app' };
  } else {
    return { ok: false, error: 'Formato desconocido' };
  }

  const known = new Set(existing.map(s => s.id));
  const fresh = result.sessions.filter(s => !known.has(s.id));
  return {
    ok: true,
    format,
    sessions: result.sessions,
    fresh,
    duplicates: result.sessions.length - fresh.length,
    rejected: result.rejected,
  };
}

// Fusión por id: lo local nunca se sobrescribe; solo se añaden ids nuevos.
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
