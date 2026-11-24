// Plan editable: validación, import/export y operaciones del editor (funciones puras, sin DOM ni almacenamiento).
// Cada operación recibe un plan validado y devuelve { ok: true, plan } con un plan nuevo validado
// o { ok: false, error } sin tocar el de entrada. Forma del plan: ver plan.js.
//
// Reglas para no romper el historial (que se enlaza por id):
//  - Los ids no cambian al renombrar.
//  - Un ejercicio o rutina con historial (o en la sesión en curso) no se borra: se archiva.
//  - No se borra ni archiva un ejercicio que use una rutina activa; antes hay que quitarlo de ella.
//  - Importar un plan sustituye rutinas y biblioteca, pero lo usado por el historial se conserva archivado.
import { PLAN_VERSION, BADGE, MUSCLES, defaultPlan } from './plan.js';
import { isPlainObject, isId, slugId, newId, LIMITS, MAX_REST } from './data.js';

export const PLAN_LIMITS = {
  exercises: 300,
  routines: 50,
  routineExercises: LIMITS.exercises,
  series: LIMITS.series,
  name: LIMITS.name,
  note: 300,
  emoji: 16,
  reps: LIMITS.target,
  fieldLabel: 30,
  duration: 600,
  rest: MAX_REST,
  importBytes: 1_000_000,
};
export const EXERCISE_TYPES = Object.keys(BADGE);
const MUSCLE_IDS = MUSCLES.map(m => m.id);
const FIELD_UNIT = { weight: 'kg', weight2: 'kg', repsDone: 'reps' };
// Caracteres de control: no tienen sentido en un nombre y algunos rompen la presentación.
const CONTROL_RE = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;

class PlanError extends Error {}

function check(cond, msg) {
  if (!cond) throw new PlanError(msg);
}

function text(v, max, where, { nonEmpty = false, optional = false } = {}) {
  if (optional && (v === undefined || v === null)) return '';
  check(typeof v === 'string', `${where}: no es texto`);
  check(v.length <= max, `${where}: demasiado largo (máx. ${max})`);
  check(!CONTROL_RE.test(v), `${where}: caracteres no permitidos`);
  check(!nonEmpty || v.trim().length > 0, `${where}: vacío`);
  return nonEmpty ? v.trim() : v;
}

function int(v, min, max, where) {
  check(Number.isInteger(v) && v >= min && v <= max, `${where}: debe ser un entero entre ${min} y ${max}`);
  return v;
}

function validateFields(raw, where) {
  check(Array.isArray(raw) && raw.length >= 1 && raw.length <= 2, `${where}: campos inválidos`);
  const keys = new Set();
  return raw.map((f, i) => {
    const w = `${where}, campo ${i + 1}`;
    check(isPlainObject(f), `${w}: no es un objeto`);
    check(Object.hasOwn(FIELD_UNIT, f.key), `${w}: clave desconocida`);
    check(!keys.has(f.key), `${w}: clave repetida`);
    keys.add(f.key);
    check(f.unit === FIELD_UNIT[f.key], `${w}: unidad incorrecta`);
    return { key: f.key, unit: f.unit, label: text(f.label, PLAN_LIMITS.fieldLabel, w, { nonEmpty: true }) };
  });
}

function validateLibraryExercise(raw, i) {
  const where = `ejercicio ${i + 1}`;
  check(isPlainObject(raw), `${where}: no es un objeto`);
  check(isId(raw.id), `${where}: id inválido`);
  const out = {
    id: raw.id,
    name: text(raw.name, PLAN_LIMITS.name, `${where}: nombre`, { nonEmpty: true }),
    type: raw.type,
    muscles: [],
  };
  check(EXERCISE_TYPES.includes(raw.type), `${where}: tipo desconocido`);
  check(raw.muscles === undefined || Array.isArray(raw.muscles), `${where}: músculos inválidos`);
  for (const m of raw.muscles || []) {
    check(MUSCLE_IDS.includes(m), `${where}: músculo desconocido`);
    if (!out.muscles.includes(m)) out.muscles.push(m);
  }
  if (raw.fields !== undefined) out.fields = validateFields(raw.fields, where);
  check(raw.archived === undefined || typeof raw.archived === 'boolean', `${where}: archived no es booleano`);
  if (raw.archived) out.archived = true;
  return out;
}

function validateSerie(raw, where) {
  check(isPlainObject(raw), `${where}: no es un objeto`);
  const out = {
    reps: text(raw.reps, PLAN_LIMITS.reps, `${where}: repeticiones`, { optional: true }),
    rest: int(raw.rest ?? 0, 0, PLAN_LIMITS.rest, `${where}: descanso`),
  };
  check(raw.drop === undefined || typeof raw.drop === 'boolean', `${where}: drop no es booleano`);
  if (raw.drop) out.drop = true;
  return out;
}

function validateRoutine(raw, i, library) {
  const where = `rutina ${i + 1}`;
  check(isPlainObject(raw), `${where}: no es un objeto`);
  check(isId(raw.id), `${where}: id inválido`);
  check(raw.archived === undefined || typeof raw.archived === 'boolean', `${where}: archived no es booleano`);
  const archived = !!raw.archived;
  check(Array.isArray(raw.exercises) && raw.exercises.length <= PLAN_LIMITS.routineExercises, `${where}: ejercicios inválidos`);
  const seen = new Set();
  const out = {
    id: raw.id,
    name: text(raw.name, PLAN_LIMITS.name, `${where}: nombre`, { nonEmpty: true }),
    emoji: text(raw.emoji, PLAN_LIMITS.emoji, `${where}: emoji`, { optional: true }).trim(),
    duration: int(raw.duration ?? 0, 0, PLAN_LIMITS.duration, `${where}: duración`),
    exercises: raw.exercises.map((e, j) => {
      const w = `${where}, ejercicio ${j + 1}`;
      check(isPlainObject(e), `${w}: no es un objeto`);
      check(isId(e.exerciseId), `${w}: id inválido`);
      const lib = library.get(e.exerciseId);
      check(lib, `${w}: el ejercicio "${e.exerciseId}" no está en la biblioteca`);
      check(archived || !lib.archived, `${w}: el ejercicio está archivado`);
      check(!seen.has(e.exerciseId), `${w}: ejercicio repetido en la rutina`);
      seen.add(e.exerciseId);
      check(Array.isArray(e.series) && e.series.length >= 1 && e.series.length <= PLAN_LIMITS.series, `${w}: series inválidas`);
      return {
        exerciseId: e.exerciseId,
        note: text(e.note, PLAN_LIMITS.note, `${w}: nota`, { optional: true }),
        series: e.series.map((x, k) => validateSerie(x, `${w}, serie ${k + 1}`)),
      };
    }),
  };
  if (archived) out.archived = true;
  return out;
}

// Valida un plan completo y devuelve una copia limpia (solo claves conocidas). Todo o nada:
// un plan con una referencia rota o un id repetido no se acepta a medias.
export function validatePlan(raw) {
  try {
    check(isPlainObject(raw), 'plan: no es un objeto');
    check(raw.planVersion === PLAN_VERSION, 'plan: versión no soportada');
    check(Array.isArray(raw.exercises) && raw.exercises.length <= PLAN_LIMITS.exercises, `plan: biblioteca inválida (máx. ${PLAN_LIMITS.exercises})`);
    check(Array.isArray(raw.routines) && raw.routines.length <= PLAN_LIMITS.routines, `plan: rutinas inválidas (máx. ${PLAN_LIMITS.routines})`);
    const library = new Map();
    const exercises = raw.exercises.map((e, i) => {
      const ex = validateLibraryExercise(e, i);
      check(!library.has(ex.id), `ejercicio ${i + 1}: id duplicado`);
      library.set(ex.id, ex);
      return ex;
    });
    const ids = new Set();
    const routines = raw.routines.map((r, i) => {
      const out = validateRoutine(r, i, library);
      check(!ids.has(out.id), `rutina ${i + 1}: id duplicado`);
      ids.add(out.id);
      return out;
    });
    return { ok: true, plan: { planVersion: PLAN_VERSION, exercises, routines } };
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, error: e.message };
    throw e;
  }
}

// ==================== USO EN EL HISTORIAL ====================
// Ids de ejercicios y rutinas que aparecen en el historial o en la sesión en curso.
export function usedIds(sessions, draft = null) {
  const exercises = new Set();
  const routines = new Set();
  for (const s of [...(sessions || []), ...(draft ? [draft] : [])]) {
    if (s.planSessionId) routines.add(s.planSessionId);
    for (const ex of s.exercises || []) exercises.add(ex.id);
  }
  return { exercises, routines };
}

// ==================== EXPORT / IMPORT ====================
export function buildPlanExport(plan, now = Date.now()) {
  return {
    app: 'gym-tracker',
    kind: 'plan',
    planVersion: PLAN_VERSION,
    exportedAt: new Date(now).toISOString(),
    exercises: plan.exercises,
    routines: plan.routines,
  };
}

// Sustituye el plan por `incoming` conservando, archivado, lo que el historial necesita y el
// fichero no trae: rutinas usadas y los ejercicios usados (o referidos por esas rutinas).
export function mergeImportedPlan(current, incoming, used) {
  const exercises = incoming.exercises.map(e => ({ ...e }));
  const routines = incoming.routines.map(r => ({ ...r }));
  const exIds = new Set(exercises.map(e => e.id));
  const rIds = new Set(routines.map(r => r.id));
  const keepExercise = id => {
    if (exIds.has(id)) return;
    const e = current.exercises.find(x => x.id === id);
    if (!e) return;
    exercises.push({ ...e, archived: true });
    exIds.add(id);
  };
  let keptRoutines = 0;
  for (const r of current.routines) {
    if (!used.routines.has(r.id) || rIds.has(r.id)) continue;
    r.exercises.forEach(e => keepExercise(e.exerciseId));
    routines.push({ ...r, archived: true });
    rIds.add(r.id);
    keptRoutines += 1;
  }
  for (const e of current.exercises) if (used.exercises.has(e.id)) keepExercise(e.id);
  const r = validatePlan({ planVersion: PLAN_VERSION, exercises, routines });
  if (!r.ok) return r;
  return { ok: true, plan: r.plan, kept: { routines: keptRoutines, exercises: exercises.length - incoming.exercises.length } };
}

// Analiza un fichero de plan. No cambia nada: devuelve el plan resultante para confirmar.
// { ok: false, error } | { ok: true, plan, incoming: { routines, exercises }, kept }
export function parsePlanImport(textContent, current, used) {
  if (typeof textContent !== 'string') return { ok: false, error: 'Fichero ilegible' };
  if (textContent.length > PLAN_LIMITS.importBytes) return { ok: false, error: 'Fichero demasiado grande' };
  let raw;
  try {
    raw = JSON.parse(textContent);
  } catch {
    return { ok: false, error: 'El fichero no es JSON válido' };
  }
  if (!isPlainObject(raw)) return { ok: false, error: 'Formato desconocido' };
  if (raw.kind !== 'plan') {
    return { ok: false, error: Array.isArray(raw.sessions) ? 'Es una copia del historial, no un plan. Impórtala desde Historial.' : 'Formato desconocido' };
  }
  if (typeof raw.planVersion === 'number' && raw.planVersion > PLAN_VERSION) {
    return { ok: false, error: 'El plan es de una versión más nueva de la app' };
  }
  const v = validatePlan(raw);
  if (!v.ok) return { ok: false, error: `Plan inválido: ${v.error}` };
  const m = mergeImportedPlan(current, v.plan, used);
  if (!m.ok) return { ok: false, error: `Plan inválido: ${m.error}` };
  return {
    ok: true,
    plan: m.plan,
    incoming: { routines: v.plan.routines.length, exercises: v.plan.exercises.length, names: v.plan.routines.filter(r => !r.archived).map(r => r.name) },
    kept: m.kept,
  };
}

// Vuelve al plan original conservando archivado lo que use el historial.
export function resetToDefault(current, used) {
  return mergeImportedPlan(current, defaultPlan(), used);
}

// ==================== EDITOR ====================
const clone = v => JSON.parse(JSON.stringify(v));

function commit(plan) {
  return validatePlan(plan);
}

function uniqueId(base, taken) {
  const root = base.slice(0, 58);
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n++) {
    const id = `${root}-${n}`;
    if (!taken.has(id)) return id;
  }
  return `${root.slice(0, 40)}-${newId().slice(0, 12)}`.replace(/[^A-Za-z0-9_-]/g, '');
}

function routineIndex(plan, id) {
  return plan.routines.findIndex(r => r.id === id);
}

function cleanName(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

// Ids de rutina ocupados: las del plan y las que aparecen en el historial (aunque ya no estén).
export function createRoutine(plan, rawName, used = { routines: new Set() }) {
  const name = cleanName(rawName);
  if (!name) return { ok: false, error: 'Escribe un nombre para la rutina' };
  const taken = new Set([...plan.routines.map(r => r.id), ...used.routines]);
  const id = uniqueId('r-' + slugId(name).slice(2), taken);
  const next = clone(plan);
  next.routines.push({ id, name, emoji: '🏋️', duration: 60, exercises: [] });
  const r = commit(next);
  return r.ok ? { ...r, id } : r;
}

export function duplicateRoutine(plan, id, used = { routines: new Set() }) {
  const i = routineIndex(plan, id);
  if (i < 0) return { ok: false, error: 'Rutina no encontrada' };
  const src = plan.routines[i];
  const name = `${src.name} (copia)`.slice(0, PLAN_LIMITS.name);
  const taken = new Set([...plan.routines.map(r => r.id), ...used.routines]);
  const copy = { ...clone(src), id: uniqueId('r-' + slugId(name).slice(2), taken), name };
  delete copy.archived;
  // Una copia activa no puede llevar ejercicios archivados.
  copy.exercises = copy.exercises.filter(e => {
    const lib = plan.exercises.find(x => x.id === e.exerciseId);
    return lib && !lib.archived;
  });
  const next = clone(plan);
  next.routines.splice(i + 1, 0, copy);
  const r = commit(next);
  return r.ok ? { ...r, id: copy.id } : r;
}

// Mueve una rutina entre las activas (dir -1 o 1), saltando las archivadas.
export function moveRoutine(plan, id, dir) {
  const active = plan.routines.filter(r => !r.archived);
  const i = active.findIndex(r => r.id === id);
  const j = i + dir;
  if (i < 0 || (dir !== 1 && dir !== -1) || j < 0 || j >= active.length) return { ok: false, error: 'No se puede mover' };
  [active[i], active[j]] = [active[j], active[i]];
  const next = clone(plan);
  next.routines = [...clone(active), ...next.routines.filter(r => r.archived)];
  return commit(next);
}

// Cambia nombre, emoji o duración. patch = { name?, emoji?, duration? } con lo que escribe el usuario.
export function updateRoutine(plan, id, patch) {
  const i = routineIndex(plan, id);
  if (i < 0) return { ok: false, error: 'Rutina no encontrada' };
  const next = clone(plan);
  const r = next.routines[i];
  if (patch.name !== undefined) r.name = cleanName(patch.name);
  if (patch.emoji !== undefined) r.emoji = cleanName(patch.emoji);
  if (patch.duration !== undefined) r.duration = toInt(patch.duration);
  return commit(next);
}

// Borra la rutina si no tiene historial; si lo tiene (o hay una sesión en curso de ella), no.
// → { ok, plan, action: 'deleted' | 'archived' } | { ok: false, error }
export function removeRoutine(plan, id, used, draftRoutineId = null) {
  const i = routineIndex(plan, id);
  if (i < 0) return { ok: false, error: 'Rutina no encontrada' };
  if (draftRoutineId === id) return { ok: false, error: 'Hay una sesión en curso de esta rutina. Termínala o descártala antes.' };
  const next = clone(plan);
  let action = 'deleted';
  if (used.routines.has(id)) {
    next.routines[i].archived = true;
    action = 'archived';
  } else {
    next.routines.splice(i, 1);
  }
  const r = commit(next);
  return r.ok ? { ...r, action } : r;
}

export function restoreRoutine(plan, id) {
  const i = routineIndex(plan, id);
  if (i < 0) return { ok: false, error: 'Rutina no encontrada' };
  const next = clone(plan);
  const r = next.routines[i];
  const archivedEx = r.exercises.filter(e => next.exercises.find(x => x.id === e.exerciseId)?.archived);
  // Sus ejercicios archivados vuelven también: una rutina activa no puede usarlos archivados.
  archivedEx.forEach(e => { delete next.exercises.find(x => x.id === e.exerciseId).archived; });
  delete r.archived;
  // Pasa al final de las activas.
  next.routines.splice(i, 1);
  const firstArchived = next.routines.findIndex(x => x.archived);
  next.routines.splice(firstArchived < 0 ? next.routines.length : firstArchived, 0, r);
  return commit(next);
}

function toInt(v) {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim();
  return /^\d{1,6}$/.test(t) ? Number(t) : NaN;
}

function withEntry(plan, routineId, exIdx, fn) {
  const i = routineIndex(plan, routineId);
  if (i < 0) return { ok: false, error: 'Rutina no encontrada' };
  const next = clone(plan);
  const entry = next.routines[i].exercises[exIdx];
  if (!entry) return { ok: false, error: 'Ejercicio no encontrado' };
  const err = fn(entry, next.routines[i]);
  if (err) return { ok: false, error: err };
  return commit(next);
}

// Añade un ejercicio de la biblioteca al final de la rutina, con 3 series de 8-12 y 90 s.
export function addRoutineExercise(plan, routineId, exerciseId) {
  const i = routineIndex(plan, routineId);
  if (i < 0) return { ok: false, error: 'Rutina no encontrada' };
  const lib = plan.exercises.find(e => e.id === exerciseId);
  if (!lib || lib.archived) return { ok: false, error: 'Elige un ejercicio de la biblioteca' };
  if (plan.routines[i].exercises.some(e => e.exerciseId === exerciseId)) return { ok: false, error: 'Ese ejercicio ya está en la rutina' };
  if (plan.routines[i].exercises.length >= PLAN_LIMITS.routineExercises) return { ok: false, error: 'Máximo de ejercicios alcanzado' };
  const next = clone(plan);
  next.routines[i].exercises.push({ exerciseId, note: '', series: Array.from({ length: 3 }, () => ({ reps: '8-12', rest: 90 })) });
  return commit(next);
}

export function removeRoutineExercise(plan, routineId, exIdx) {
  return withEntry(plan, routineId, exIdx, (entry, r) => { r.exercises.splice(exIdx, 1); });
}

export function moveRoutineExercise(plan, routineId, exIdx, dir) {
  return withEntry(plan, routineId, exIdx, (entry, r) => {
    const j = exIdx + dir;
    if ((dir !== 1 && dir !== -1) || j < 0 || j >= r.exercises.length) return 'No se puede mover';
    [r.exercises[exIdx], r.exercises[j]] = [r.exercises[j], r.exercises[exIdx]];
    return null;
  });
}

export function setRoutineNote(plan, routineId, exIdx, raw) {
  return withEntry(plan, routineId, exIdx, entry => { entry.note = typeof raw === 'string' ? raw.trim() : ''; });
}

// La nueva serie copia la última (rango y descanso), sin drop.
export function addRoutineSeries(plan, routineId, exIdx) {
  return withEntry(plan, routineId, exIdx, entry => {
    if (entry.series.length >= PLAN_LIMITS.series) return 'Máximo de series alcanzado';
    const last = entry.series[entry.series.length - 1];
    entry.series.push({ reps: last ? last.reps : '', rest: last ? last.rest : 90 });
    return null;
  });
}

export function removeRoutineSeries(plan, routineId, exIdx, seriesIdx) {
  return withEntry(plan, routineId, exIdx, entry => {
    if (entry.series.length <= 1) return 'Cada ejercicio necesita al menos una serie';
    if (!entry.series[seriesIdx]) return 'Serie no encontrada';
    entry.series.splice(seriesIdx, 1);
    return null;
  });
}

// field: 'reps' (texto), 'rest' (segundos) o 'drop' (booleano).
export function setRoutineSeries(plan, routineId, exIdx, seriesIdx, field, raw) {
  return withEntry(plan, routineId, exIdx, entry => {
    const s = entry.series[seriesIdx];
    if (!s) return 'Serie no encontrada';
    if (field === 'reps') s.reps = typeof raw === 'string' ? raw.trim() : '';
    else if (field === 'rest') s.rest = toInt(raw);
    else if (field === 'drop') {
      if (raw) s.drop = true;
      else delete s.drop;
    } else return 'Campo desconocido';
    return null;
  });
}

// ==================== BIBLIOTECA ====================
// Crea un ejercicio. El id sale del nombre (x-nombre), el mismo que recibe un ejercicio libre al
// sustituir en una sesión, así el historial previo con ese nombre queda enlazado.
export function createExercise(plan, { name: rawName, type = 'traditional', muscles = [] } = {}) {
  const name = cleanName(rawName);
  if (!name) return { ok: false, error: 'Escribe un nombre para el ejercicio' };
  if (plan.exercises.some(e => e.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'Ya hay un ejercicio con ese nombre' };
  const id = uniqueId(slugId(name), new Set(plan.exercises.map(e => e.id)));
  const next = clone(plan);
  next.exercises.push({ id, name, type, muscles: [...muscles] });
  const r = commit(next);
  return r.ok ? { ...r, id } : r;
}

// patch = { name?, type?, muscles? }
export function updateExercise(plan, id, patch) {
  const next = clone(plan);
  const e = next.exercises.find(x => x.id === id);
  if (!e) return { ok: false, error: 'Ejercicio no encontrado' };
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (next.exercises.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'Ya hay un ejercicio con ese nombre' };
    e.name = name;
  }
  if (patch.type !== undefined) e.type = patch.type;
  if (patch.muscles !== undefined) e.muscles = Array.isArray(patch.muscles) ? [...patch.muscles] : patch.muscles;
  return commit(next);
}

// Rutinas activas que usan el ejercicio.
export function routinesUsing(plan, id) {
  return plan.routines.filter(r => !r.archived && r.exercises.some(e => e.exerciseId === id));
}

// Borra el ejercicio si no tiene historial ni rutinas que lo usen; si tiene historial, se archiva.
// → { ok, plan, action: 'deleted' | 'archived' } | { ok: false, error }
export function removeExercise(plan, id, used) {
  const e = plan.exercises.find(x => x.id === id);
  if (!e) return { ok: false, error: 'Ejercicio no encontrado' };
  const users = routinesUsing(plan, id);
  if (users.length) return { ok: false, error: `Está en ${users.map(r => r.name).join(', ')}. Quítalo de la rutina antes.` };
  const next = clone(plan);
  const inArchived = next.routines.some(r => r.exercises.some(x => x.exerciseId === id));
  let action = 'deleted';
  if (used.exercises.has(id) || inArchived) {
    next.exercises.find(x => x.id === id).archived = true;
    action = 'archived';
  } else {
    next.exercises = next.exercises.filter(x => x.id !== id);
  }
  const r = commit(next);
  return r.ok ? { ...r, action } : r;
}

export function restoreExercise(plan, id) {
  const next = clone(plan);
  const e = next.exercises.find(x => x.id === id);
  if (!e) return { ok: false, error: 'Ejercicio no encontrado' };
  delete e.archived;
  return commit(next);
}
