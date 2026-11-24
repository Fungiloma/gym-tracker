import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN, getPlanSession, restFor, fieldsFor, findPlanExercise } from '../js/plan.js';
import {
  KEYS, V1_KEYS, LEGACY_KEYS, loadData, saveData, loadDraft, saveDraft, clearDraft, loadUi, saveUi,
} from '../js/storage.js';
import {
  formatRest, formatRemaining, ringOffset, remainingAt, createTimer, toggleTimer, isTimerKey, sanitizeTimers, RING_CIRCUMFERENCE,
} from '../js/timers.js';
import { createDraft, setDraftValue } from '../js/data.js';

function memoryStorage(initial = {}, { quota = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (quota) {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      data.set(k, String(v));
    },
    removeItem: k => data.delete(k),
    dump: () => Object.fromEntries(data),
  };
}

const P1 = PLAN[0];

test('claves de almacenamiento con prefijo gymtracker.', () => {
  for (const k of [...Object.values(KEYS), ...Object.values(V1_KEYS)]) assert.match(k, /^gymtracker\./);
});

test('plan: ids de sesión y ejercicio únicos y con formato seguro', () => {
  const ids = [...PLAN.map(p => p.id), ...PLAN.flatMap(p => p.exercises.map(e => e.id))];
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  assert.equal(getPlanSession('pierna').name, 'Sesión 2: Pierna');
  assert.equal(getPlanSession('nope'), null);
});

test('plan: superseries con reps declaran repsDone en vez de kg', () => {
  const dom = findPlanExercise('ss-dominadas-press-cerrado');
  assert.deepEqual(fieldsFor(dom).map(f => [f.key, f.unit]), [['repsDone', 'reps'], ['weight', 'kg']]);
  const tri = findPlanExercise('ss-triceps-flexiones');
  assert.deepEqual(fieldsFor(tri).map(f => [f.key, f.unit]), [['weight', 'kg'], ['repsDone', 'reps']]);
  assert.deepEqual(fieldsFor(findPlanExercise('peso-muerto')).map(f => f.key), ['weight', 'repsDone']);
});

test('loadData: vacío, v1 nueva, v1 antigua y prioridad de la clave v2', () => {
  assert.equal(loadData(memoryStorage()).source, 'empty');
  const v1 = JSON.stringify([{ id: 1, timestamp: Date.UTC(2026, 0, 1), session: P1.name, exercises: [] }]);
  const legacy = loadData(memoryStorage({ [LEGACY_KEYS.sessions]: v1 }));
  assert.equal(legacy.source, 'v1');
  assert.equal(legacy.data.sessions[0].planSessionId, P1.id);
  assert.equal(loadData(memoryStorage({ [V1_KEYS.sessions]: v1, [LEGACY_KEYS.sessions]: '[]' })).data.sessions.length, 1);
  const v2 = JSON.stringify({ schemaVersion: 2, sessions: [], settings: {} });
  const r = loadData(memoryStorage({ [KEYS.data]: v2, [V1_KEYS.sessions]: v1 }));
  assert.equal(r.source, 'v2');
  assert.equal(r.data.sessions.length, 0);
});

test('loadData: datos dañados se copian a backup y no se pierden', () => {
  const st = memoryStorage({ [KEYS.data]: '{no json' });
  const r = loadData(st);
  assert.equal(r.source, 'corrupt');
  assert.deepEqual(r.data.sessions, []);
  assert.equal(st.dump()[KEYS.backup], '{no json');

  const st2 = memoryStorage({ [KEYS.data]: '{"schemaVersion":2,"sessions":[{"id":"x"}]}' });
  const r2 = loadData(st2);
  assert.equal(r2.source, 'v2');
  assert.equal(r2.rejected.length, 1);
  assert.ok(st2.dump()[KEYS.backup], 'sesiones rechazadas: se guarda copia');

  assert.equal(loadData(memoryStorage({ [KEYS.data]: '[]' })).source, 'corrupt');
  assert.equal(loadData(memoryStorage({ [KEYS.data]: '{"schemaVersion":3,"sessions":[]}' })).source, 'corrupt');
});

test('saveData escribe solo la clave v2, no toca las v1 e informa de cuota llena', () => {
  const st = memoryStorage({ [LEGACY_KEYS.sessions]: '[]', [V1_KEYS.sessions]: '[]' });
  assert.deepEqual(saveData({ schemaVersion: 2, sessions: [], settings: {} }, st), { ok: true });
  assert.equal(st.dump()[LEGACY_KEYS.sessions], '[]');
  assert.equal(st.dump()[V1_KEYS.sessions], '[]');
  const full = saveData({ schemaVersion: 2, sessions: [], settings: {} }, memoryStorage({}, { quota: true }));
  assert.equal(full.ok, false);
  assert.equal(full.quota, true);
});

test('borrador: guardar, recargar, ignorar basura y borrar', () => {
  const st = memoryStorage();
  const d = createDraft(P1.id, Date.UTC(2026, 0, 1));
  assert.ok(setDraftValue(d, 0, 0, 'weight', '22,5').ok);
  saveDraft(d, st);
  const back = loadDraft(st);
  assert.equal(back.id, d.id);
  assert.equal(back.exercises[0].series[0].weight, 22.5);
  assert.equal(back.exercises[0].series[0].done, true);
  clearDraft(st);
  assert.equal(loadDraft(st), null);
  assert.equal(loadDraft(memoryStorage({ [KEYS.draft]: '{bad' })), null);
  assert.equal(loadDraft(memoryStorage({ [KEYS.draft]: '{"planSessionId":"nope"}' })), null);
});

test('estado de UI separado: solo ids de texto y timers como objeto', () => {
  const defaults = { timers: {}, expandedSessions: [] };
  assert.deepEqual(loadUi(defaults, memoryStorage()), defaults);
  assert.deepEqual(loadUi(defaults, memoryStorage({ [KEYS.ui]: '[1]' })), defaults);
  const st = memoryStorage();
  saveUi({ timers: {}, expandedSessions: ['a', 1, null] }, st);
  assert.deepEqual(loadUi(defaults, st).expandedSessions, ['a']);
});

test('sanitizeTimers descarta claves y números inválidos', () => {
  const ok = { duration: 90, endTs: 1000, paused: false, remaining: 90 };
  assert.deepEqual(sanitizeTimers({ '0-0': ok, 'x': ok, '1-1': { duration: 'a' }, '2-2': null }), { '0-0': ok });
  assert.deepEqual(sanitizeTimers(null), {});
});

test('restFor devuelve el descanso del plan y null en claves inválidas', () => {
  assert.equal(restFor(P1.id, '0-0'), P1.exercises[0].series[0].rest);
  assert.equal(restFor(P1.id, '2-3'), null); // myo-reps última serie: rest 0
  assert.equal(restFor(P1.id, '99-0'), null);
  assert.equal(restFor(P1.id, "0-0');alert(1)//"), null);
  assert.equal(restFor('no existe', '0-0'), null);
});

test('isTimerKey solo acepta "n-n"', () => {
  assert.ok(isTimerKey('3-12'));
  for (const k of ['', '3', '3-', 'a-1', '1-1-1', '1-1"]', undefined]) assert.ok(!isTimerKey(k), String(k));
});

test('formatRest y formatRemaining', () => {
  assert.equal(formatRest(45), '45s');
  assert.equal(formatRest(60), '1m');
  assert.equal(formatRest(90), '1m30s');
  assert.equal(formatRest(165), '2m45s');
  assert.equal(formatRemaining(0), '0s');
  assert.equal(formatRemaining(59), '59s');
  assert.equal(formatRemaining(60), '1:00');
  assert.equal(formatRemaining(125), '2:05');
});

test('ringOffset va de 0 (lleno) a la circunferencia (vacío)', () => {
  assert.equal(ringOffset(90, 90), 0);
  assert.equal(ringOffset(0, 90), RING_CIRCUMFERENCE);
  assert.ok(Math.abs(ringOffset(45, 90) - RING_CIRCUMFERENCE / 2) < 1e-9);
});

test('createTimer, remainingAt y toggleTimer (pausa y reanudación)', () => {
  const t = createTimer(90, 1_000);
  assert.deepEqual(t, { duration: 90, endTs: 91_000, paused: false, remaining: 90 });
  assert.equal(remainingAt(t, 31_000), 60);
  assert.equal(remainingAt(t, 200_000), 0);

  toggleTimer(t, 31_000);
  assert.equal(t.paused, true);
  assert.equal(t.remaining, 60);

  toggleTimer(t, 500_000);
  assert.equal(t.paused, false);
  assert.equal(t.endTs, 560_000);
});
