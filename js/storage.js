// Persistencia en localStorage (esquema v2).
// - gymtracker.data   datos: { schemaVersion, sessions, settings }
// - gymtracker.draft  sesión en curso (borrador), separada de los datos
// - gymtracker.ui     estado de interfaz: descanso activo, descansos por ejercicio y tarjetas expandidas
// - gymtracker.plan   plan editable { planVersion, exercises, routines }; solo existe si el usuario lo
//                     ha editado o importado. Sin él se usa el plan por defecto de plan.js.
// Las claves v1 (gymtracker.sessions/state y gym-sessions/state) solo se leen, nunca se
// escriben ni se borran. Si gymtracker.data está dañado, se copia tal cual a
// gymtracker.data.backup antes de que nada lo pueda sobrescribir (igual con gymtracker.plan).
import { defaultPlan } from './plan.js';
import { validatePlan } from './routines.js';
import { emptyData, tryValidateData, fromV1Sessions, restoreDraft, isPlainObject, isId, MAX_REST } from './data.js';
import { sanitizeTimer } from './timers.js';

export const KEYS = {
  data: 'gymtracker.data',
  draft: 'gymtracker.draft',
  ui: 'gymtracker.ui',
  backup: 'gymtracker.data.backup',
  plan: 'gymtracker.plan',
  planBackup: 'gymtracker.plan.backup',
};

export const V1_KEYS = {
  sessions: 'gymtracker.sessions',
  state: 'gymtracker.state',
};

export const LEGACY_KEYS = {
  sessions: 'gym-sessions',
  state: 'gym-state',
};

function defaultStorage() {
  return globalThis.localStorage;
}

function get(storage, key) {
  try {
    return storage.getItem(key);
  } catch (e) {
    console.warn('Error reading', key, e);
    return null;
  }
}

export function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

// { ok: true } | { ok: false, quota, error }
function put(storage, key, value) {
  try {
    storage.setItem(key, value);
    return { ok: true };
  } catch (e) {
    console.warn('Error saving', key, e);
    return { ok: false, quota: isQuotaError(e), error: e };
  }
}

function backupRaw(storage, raw) {
  put(storage, KEYS.backup, raw);
}

// Devuelve { data, source, rejected } con source: 'v2' | 'v1' | 'empty' | 'corrupt'.
export function loadData(storage = defaultStorage()) {
  const raw = get(storage, KEYS.data);
  if (raw !== null) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      backupRaw(storage, raw);
      return { data: emptyData(), source: 'corrupt', rejected: [] };
    }
    const r = tryValidateData(parsed);
    if (!r.ok) {
      backupRaw(storage, raw);
      return { data: emptyData(), source: 'corrupt', rejected: [{ index: -1, error: r.error }] };
    }
    if (r.rejected.length) backupRaw(storage, raw);
    return { data: r.data, source: 'v2', rejected: r.rejected };
  }

  let v1raw = get(storage, V1_KEYS.sessions);
  if (v1raw === null) v1raw = get(storage, LEGACY_KEYS.sessions);
  if (v1raw === null) return { data: emptyData(), source: 'empty', rejected: [] };
  let parsed;
  try {
    parsed = JSON.parse(v1raw);
  } catch {
    return { data: emptyData(), source: 'empty', rejected: [{ index: -1, error: 'v1 ilegible' }] };
  }
  const { sessions, rejected } = fromV1Sessions(parsed);
  return { data: { ...emptyData(), sessions }, source: 'v1', rejected };
}

export function saveData(data, storage = defaultStorage()) {
  return put(storage, KEYS.data, JSON.stringify(data));
}

// Devuelve { plan, source } con source: 'stored' | 'default' | 'corrupt'. Un plan guardado que no
// valida se copia a gymtracker.plan.backup y se usa el de por defecto (el historial no se toca).
export function loadPlan(storage = defaultStorage()) {
  const raw = get(storage, KEYS.plan);
  if (raw === null) return { plan: defaultPlan(), source: 'default' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const r = validatePlan(parsed);
  if (r.ok) return { plan: r.plan, source: 'stored' };
  put(storage, KEYS.planBackup, raw);
  return { plan: defaultPlan(), source: 'corrupt', error: r.error };
}

export function savePlan(plan, storage = defaultStorage()) {
  return put(storage, KEYS.plan, JSON.stringify(plan));
}

export function loadDraft(storage = defaultStorage()) {
  const raw = get(storage, KEYS.draft);
  if (raw === null) return null;
  try {
    return restoreDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDraft(draft, storage = defaultStorage()) {
  return put(storage, KEYS.draft, JSON.stringify(draft));
}

export function clearDraft(storage = defaultStorage()) {
  try {
    storage.removeItem(KEYS.draft);
  } catch (e) {
    console.warn('Error clearing draft', e);
  }
}

export function loadUi(defaults, storage = defaultStorage()) {
  const raw = get(storage, KEYS.ui);
  const out = { ...defaults };
  if (isPlainObject(defaults.restByExercise)) out.restByExercise = { ...defaults.restByExercise };
  if (Array.isArray(defaults.expandedSessions)) out.expandedSessions = [...defaults.expandedSessions];
  if (raw === null) return out;
  try {
    const saved = JSON.parse(raw);
    if (!isPlainObject(saved)) return out;
    if (Array.isArray(saved.expandedSessions)) {
      out.expandedSessions = saved.expandedSessions.filter(x => typeof x === 'string');
    }
    out.timer = sanitizeTimer(saved.timer);
    if (isPlainObject(saved.restByExercise)) {
      out.restByExercise = {};
      for (const [id, sec] of Object.entries(saved.restByExercise)) {
        if (isId(id) && Number.isInteger(sec) && sec >= 0 && sec <= MAX_REST) out.restByExercise[id] = sec;
      }
    }
    if (typeof saved.notifAsked === 'boolean') out.notifAsked = saved.notifAsked;
    if (typeof saved.guided === 'boolean') out.guided = saved.guided;
    if (Number.isInteger(saved.guidedIndex) && saved.guidedIndex >= 0 && saved.guidedIndex < 100) out.guidedIndex = saved.guidedIndex;
  } catch (e) {
    console.warn('Error loading ui state:', e);
  }
  return out;
}

export function saveUi(ui, storage = defaultStorage()) {
  return put(storage, KEYS.ui, JSON.stringify(ui));
}

// Pide almacenamiento persistente (Chrome Android lo concede según uso/instalación).
export async function requestPersistence(nav = globalThis.navigator) {
  try {
    if (!nav || !nav.storage || typeof nav.storage.persist !== 'function') return false;
    if (typeof nav.storage.persisted === 'function' && await nav.storage.persisted()) return true;
    return await nav.storage.persist();
  } catch {
    return false;
  }
}
