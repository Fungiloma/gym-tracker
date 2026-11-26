// Persistencia en localStorage (esquema v2).
// - gymtracker.data   datos: { schemaVersion, sessions, settings }
// - gymtracker.draft  sesión en curso (borrador), separada de los datos
// - gymtracker.ui     estado de interfaz: descanso activo, descansos por ejercicio y tarjetas expandidas
// - gymtracker.plan   plan editable { planVersion, exercises, routines }; solo existe si el usuario lo
//                     ha editado o importado. Sin él se usa el plan por defecto de plan.js.
// Las claves v1 (gymtracker.sessions/state y gym-sessions/state) solo se leen, nunca se
// escriben ni se borran. Si gymtracker.data está dañado (o es de una versión más nueva), se intenta
// copiar tal cual a gymtracker.data.backup y, haya copia o no, saveData queda bloqueado en ese
// storage hasta que la app llame a unlockData (cuando el usuario ha descargado el texto original).
// Lo mismo con gymtracker.plan (copia en gymtracker.plan.backup) y con un borrador que ya no se
// puede reconstruir (copia en gymtracker.draft.backup).
import { defaultPlan } from './plan.js';
import { validatePlan } from './routines.js';
import { emptyData, tryValidateData, fromV1Sessions, restoreDraft, isPlainObject, isId, MAX_REST, SCHEMA_VERSION } from './data.js';
import { sanitizeTimer } from './timers.js';

export const KEYS = {
  data: 'gymtracker.data',
  draft: 'gymtracker.draft',
  ui: 'gymtracker.ui',
  backup: 'gymtracker.data.backup',
  plan: 'gymtracker.plan',
  planBackup: 'gymtracker.plan.backup',
  draftBackup: 'gymtracker.draft.backup',
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

// Cuota de localStorage: los navegadores dan unos 5 millones de caracteres por origen (5 MiB en UTF-16 según
// Chromium, Firefox y Safari). No se puede consultar, así que es una estimación: se avisa a partir del 70 %.
export const QUOTA_CHARS = 5_000_000;
export const QUOTA_WARN = 0.7;

// → { chars, ratio } con lo que ocupa la app (claves + valores), o null si no se puede medir.
export function storageUsage(storage = defaultStorage()) {
  try {
    let chars = 0;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || !key.startsWith('gymtracker.')) continue;
      chars += key.length + (storage.getItem(key) || '').length;
    }
    return { chars, ratio: chars / QUOTA_CHARS };
  } catch {
    return null;
  }
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

// Storages cuyo gymtracker.data no se puede sobrescribir todavía (ver loadData).
const locked = new WeakSet();

export function isDataLocked(storage = defaultStorage()) {
  return locked.has(storage);
}

// Solo cuando el usuario ya tiene el texto original fuera de la app.
export function unlockData(storage = defaultStorage()) {
  locked.delete(storage);
}

// Devuelve { data, source, rejected, raw, backup, locked } con source: 'v2' | 'v1' | 'empty' |
// 'corrupt' | 'newer'. backup es el resultado de copiar raw a gymtracker.data.backup (null si no
// hizo falta). Con 'corrupt', 'newer' o registros apartados sin copia, saveData queda bloqueado:
// escribir ahora borraría lo único que queda del original.
export function loadData(storage = defaultStorage()) {
  const raw = get(storage, KEYS.data);
  if (raw !== null) {
    const keep = (source, rest) => {
      const backup = put(storage, KEYS.backup, raw);
      const lock = source !== 'v2' || !backup.ok;
      if (lock) locked.add(storage);
      return { source, raw, backup, locked: lock, ...rest };
    };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return keep('corrupt', { data: emptyData(), rejected: [] });
    }
    if (isPlainObject(parsed) && typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > SCHEMA_VERSION) {
      return keep('newer', { data: emptyData(), rejected: [] });
    }
    const r = tryValidateData(parsed);
    if (!r.ok) return keep('corrupt', { data: emptyData(), rejected: [{ index: -1, error: r.error }] });
    if (r.rejected.length) return keep('v2', { data: r.data, rejected: r.rejected });
    return { data: r.data, source: 'v2', rejected: [], raw: null, backup: null, locked: false };
  }

  let v1raw = get(storage, V1_KEYS.sessions);
  if (v1raw === null) v1raw = get(storage, LEGACY_KEYS.sessions);
  const none = { raw: null, backup: null, locked: false };
  if (v1raw === null) return { data: emptyData(), source: 'empty', rejected: [], ...none };
  let parsed;
  try {
    parsed = JSON.parse(v1raw);
  } catch {
    return { data: emptyData(), source: 'empty', rejected: [{ index: -1, error: 'v1 ilegible' }], ...none };
  }
  const { sessions, rejected } = fromV1Sessions(parsed);
  return { data: { ...emptyData(), sessions }, source: 'v1', rejected, ...none };
}

// { ok: true } | { ok: false, quota, error } | { ok: false, locked: true }
export function saveData(data, storage = defaultStorage()) {
  if (locked.has(storage)) return { ok: false, quota: false, locked: true };
  return put(storage, KEYS.data, JSON.stringify(data));
}

// Devuelve { plan, source, backup } con source: 'stored' | 'default' | 'corrupt'. Un plan guardado que
// no valida se intenta copiar a gymtracker.plan.backup (backup dice si se pudo) y se usa el de por
// defecto (el historial no se toca).
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
  const backup = put(storage, KEYS.planBackup, raw);
  return { plan: defaultPlan(), source: 'corrupt', error: r.error, raw, backup };
}

export function savePlan(plan, storage = defaultStorage()) {
  return put(storage, KEYS.plan, JSON.stringify(plan));
}

// { draft, lost } donde lost es null o { raw, backup }: había borrador pero no se pudo reconstruir
// (p. ej. su rutina ya no está en el plan). Su texto se copia a gymtracker.draft.backup antes de
// que empezar otra rutina lo sobrescriba. Mientras esa copia exista (hasta clearDraftBackup), lost
// la devuelve aunque gymtracker.draft ya tenga otro borrador válido.
export function loadDraftState(storage = defaultStorage()) {
  const raw = get(storage, KEYS.draft);
  let draft = null;
  if (raw !== null) {
    try {
      draft = restoreDraft(JSON.parse(raw));
    } catch {
      draft = null;
    }
    if (!draft) return { draft: null, lost: { raw, backup: put(storage, KEYS.draftBackup, raw) } };
  }
  const kept = get(storage, KEYS.draftBackup);
  return { draft, lost: kept === null ? null : { raw: kept, backup: { ok: true } } };
}

export function clearDraftBackup(storage = defaultStorage()) {
  try {
    storage.removeItem(KEYS.draftBackup);
  } catch (e) {
    console.warn('Error clearing draft backup', e);
  }
}

export function loadDraft(storage = defaultStorage()) {
  return loadDraftState(storage).draft;
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
