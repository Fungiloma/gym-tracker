// Persistencia en localStorage. Claves con prefijo propio para no chocar con otras
// apps del mismo origen (fungiloma.github.io). Las claves antiguas se leen como
// respaldo si la nueva no existe y nunca se borran.
export const KEYS = {
  state: 'gymtracker.state',
  sessions: 'gymtracker.sessions',
};

export const LEGACY_KEYS = {
  state: 'gym-state',
  sessions: 'gym-sessions',
};

function defaultStorage() {
  return globalThis.localStorage;
}

function readJSON(storage, key, legacyKey) {
  let raw = storage.getItem(key);
  if (raw === null && legacyKey) raw = storage.getItem(legacyKey);
  if (raw === null) return undefined;
  return JSON.parse(raw);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function loadState(defaults, storage = defaultStorage()) {
  try {
    const saved = readJSON(storage, KEYS.state, LEGACY_KEYS.state);
    if (isPlainObject(saved)) return { ...defaults, ...saved };
  } catch (e) {
    console.warn('Error loading state:', e);
  }
  return { ...defaults };
}

export function saveState(state, storage = defaultStorage()) {
  try {
    storage.setItem(KEYS.state, JSON.stringify(state));
  } catch (e) {
    console.warn('Error saving state:', e);
  }
}

export function loadSessions(storage = defaultStorage()) {
  try {
    const saved = readJSON(storage, KEYS.sessions, LEGACY_KEYS.sessions);
    return Array.isArray(saved) ? saved : [];
  } catch (e) {
    console.warn('Error loading sessions:', e);
    return [];
  }
}

export function saveSessions(sessions, storage = defaultStorage()) {
  try {
    storage.setItem(KEYS.sessions, JSON.stringify(sessions));
  } catch (e) {
    console.warn('Error saving sessions:', e);
  }
}
