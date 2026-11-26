import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSessions, getPlanSession, fieldsFor, findPlanExercise } from '../js/plan.js';
const PLAN = planSessions();
import {
  KEYS, V1_KEYS, LEGACY_KEYS, loadData, saveData, loadDraft, saveDraft, clearDraft, loadUi, saveUi,
  loadDraftState, loadPlan, unlockData, isDataLocked, clearDraftBackup,
} from '../js/storage.js';
import {
  formatRest, formatRemaining, ringOffset, remainingAt, createTimer, toggleTimer, adjustTimer, sanitizeTimer, formatElapsed, RING_CIRCUMFERENCE,
} from '../js/timers.js';
import { createDraft, setDraftValue } from '../js/data.js';

// limit: caracteres totales que caben (como la cuota de localStorage); quota: no cabe nada.
function memoryStorage(initial = {}, { quota = false, limit = Infinity } = {}) {
  const data = new Map(Object.entries(initial));
  const size = () => [...data.values()].reduce((n, v) => n + v.length, 0);
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (quota || size() - (data.get(k) || '').length + String(v).length > limit) {
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
  assert.equal(loadData(memoryStorage({ [KEYS.data]: '{"schemaVersion":3,"sessions":[]}' })).source, 'newer');
});

test('loadData: dañado sin sitio para la copia bloquea saveData y no sobrescribe el original', () => {
  // El original ocupa más de la mitad de la cuota: la copia en gymtracker.data.backup no cabe.
  const raw = '{"schemaVersion":2,"sessions":[' + 'x'.repeat(600);
  const st = memoryStorage({ [KEYS.data]: raw }, { limit: 1000 });
  const r = loadData(st);
  assert.equal(r.source, 'corrupt');
  assert.equal(r.backup.ok, false);
  assert.equal(r.backup.quota, true);
  assert.equal(r.locked, true);
  assert.equal(r.raw, raw, 'el texto original vuelve para poder descargarlo');
  assert.equal(st.dump()[KEYS.backup], undefined);
  const w = saveData({ schemaVersion: 2, sessions: [], body: [], settings: {} }, st);
  assert.deepEqual(w, { ok: false, quota: false, locked: true });
  assert.equal(st.dump()[KEYS.data], raw, 'el original sigue intacto tras intentar guardar');
  assert.equal(isDataLocked(st), true);
  unlockData(st);
  assert.deepEqual(saveData({ schemaVersion: 2, sessions: [], body: [], settings: {} }, st), { ok: true });
});

test('loadData: dañado con copia también bloquea; datos válidos no bloquean', () => {
  const st = memoryStorage({ [KEYS.data]: '{roto' });
  const r = loadData(st);
  assert.equal(r.backup.ok, true);
  assert.equal(r.locked, true);
  assert.equal(saveData({ schemaVersion: 2, sessions: [], settings: {} }, st).locked, true);
  assert.equal(st.dump()[KEYS.data], '{roto');

  const ok = memoryStorage({ [KEYS.data]: JSON.stringify({ schemaVersion: 2, sessions: [], settings: {} }) });
  const r2 = loadData(ok);
  assert.equal(r2.locked, false);
  assert.equal(r2.backup, null);
  assert.deepEqual(saveData({ schemaVersion: 2, sessions: [], settings: {} }, ok), { ok: true });
});

test('loadData: schemaVersion mayor es versión más nueva, no dañado, y bloquea la escritura', () => {
  const raw = '{"schemaVersion":3,"sessions":[{"nuevo":true}]}';
  const st = memoryStorage({ [KEYS.data]: raw });
  const r = loadData(st);
  assert.equal(r.source, 'newer');
  assert.equal(r.locked, true);
  assert.equal(st.dump()[KEYS.backup], raw);
  assert.equal(saveData({ schemaVersion: 2, sessions: [], settings: {} }, st).locked, true);
  assert.equal(st.dump()[KEYS.data], raw);
});

test('loadData: registros apartados bloquean solo si la copia falla', () => {
  const raw = '{"schemaVersion":2,"sessions":[{"id":"x"}],"pad":"' + 'p'.repeat(600) + '"}';
  const withRoom = loadData(memoryStorage({ [KEYS.data]: raw }));
  assert.equal(withRoom.source, 'v2');
  assert.equal(withRoom.backup.ok, true);
  assert.equal(withRoom.locked, false);
  const st = memoryStorage({ [KEYS.data]: raw }, { limit: 1000 });
  const full = loadData(st);
  assert.equal(full.rejected.length, 1);
  assert.equal(full.backup.ok, false);
  assert.equal(full.locked, true);
  assert.equal(saveData(full.data, st).locked, true);
  assert.equal(st.dump()[KEYS.data], raw);
});

test('loadPlan: informa de si la copia del plan dañado se pudo hacer', () => {
  const ok = loadPlan(memoryStorage({ [KEYS.plan]: '{roto' }));
  assert.equal(ok.source, 'corrupt');
  assert.equal(ok.backup.ok, true);
  const full = loadPlan(memoryStorage({ [KEYS.plan]: '{roto' }, { quota: true }));
  assert.equal(full.backup.ok, false);
});

test('loadDraftState: borrador de una rutina que ya no está en el plan se copia y se informa', () => {
  const raw = JSON.stringify({
    schemaVersion: 2, id: 'd1', planSessionId: 'mi-rutina', startedAt: Date.UTC(2026, 0, 1), notes: 'nota',
    exercises: [{ id: 'mi-ejercicio', name: 'Mi ejercicio', notes: '', series: [{ weight: 50, repsDone: 8, done: true }] }],
  });
  const st = memoryStorage({ [KEYS.draft]: raw });
  const r = loadDraftState(st);
  assert.equal(r.draft, null);
  assert.equal(r.lost.raw, raw);
  assert.equal(r.lost.backup.ok, true);
  assert.equal(st.dump()[KEYS.draftBackup], raw);
  assert.equal(st.dump()[KEYS.draft], raw, 'el borrador original no se borra al cargar');
  assert.equal(loadDraft(st), null);

  const full = loadDraftState(memoryStorage({ [KEYS.draft]: raw }, { quota: true }));
  assert.equal(full.lost.backup.ok, false);

  // Con otro borrador válido ya en gymtracker.draft, la copia sigue apareciendo hasta borrarla.
  const later = memoryStorage({ [KEYS.draft]: JSON.stringify(createDraft(P1.id, Date.UTC(2026, 0, 2))), [KEYS.draftBackup]: raw });
  const r2 = loadDraftState(later);
  assert.ok(r2.draft);
  assert.equal(r2.lost.raw, raw);
  clearDraftBackup(later);
  assert.equal(loadDraftState(later).lost, null);

  assert.deepEqual(loadDraftState(memoryStorage()), { draft: null, lost: null });
  const d = createDraft(P1.id, Date.UTC(2026, 0, 1));
  const good = loadDraftState(memoryStorage({ [KEYS.draft]: JSON.stringify(d) }));
  assert.equal(good.lost, null);
  assert.equal(good.draft.id, d.id);
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
  assert.equal(back.exercises[0].series[0].done, false, 'escribir no marca la serie como hecha');
  clearDraft(st);
  assert.equal(loadDraft(st), null);
  assert.equal(loadDraft(memoryStorage({ [KEYS.draft]: '{bad' })), null);
  assert.equal(loadDraft(memoryStorage({ [KEYS.draft]: '{"planSessionId":"nope"}' })), null);
});

test('estado de UI separado: ids de texto, descanso y descansos por ejercicio validados', () => {
  const defaults = { timer: null, restByExercise: {}, expandedSessions: [] };
  assert.deepEqual(loadUi(defaults, memoryStorage()), defaults);
  assert.deepEqual(loadUi(defaults, memoryStorage({ [KEYS.ui]: '[1]' })), defaults);
  const st = memoryStorage();
  saveUi({ timers: {}, expandedSessions: ['a', 1, null] }, st);
  assert.deepEqual(loadUi(defaults, st).expandedSessions, ['a']);
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
  assert.deepEqual(t, { duration: 90, endTs: 91_000, paused: false, remaining: 90, label: '' });
  assert.equal(remainingAt(t, 31_000), 60);
  assert.equal(remainingAt(t, 200_000), 0);

  toggleTimer(t, 31_000);
  assert.equal(t.paused, true);
  assert.equal(t.remaining, 60);

  toggleTimer(t, 500_000);
  assert.equal(t.paused, false);
  assert.equal(t.endTs, 560_000);
});

test('sanitizeTimer descarta formas inválidas y conserva el descanso válido', () => {
  const ok = { duration: 90, endTs: 1000, paused: false, remaining: 90, label: 'Press · serie 1' };
  assert.deepEqual(sanitizeTimer(ok), ok);
  assert.equal(sanitizeTimer(null), null);
  assert.equal(sanitizeTimer({ ...ok, duration: 'a' }), null);
  assert.equal(sanitizeTimer({ ...ok, duration: 0 }), null);
  assert.equal(sanitizeTimer({ ...ok, remaining: -1 }), null);
  assert.equal(sanitizeTimer({ ...ok, duration: 99999 }), null);
  assert.equal(sanitizeTimer({ ...ok, label: 5 }).label, '');
});

test('adjustTimer suma y resta 15 s, también en pausa, y termina en 0', () => {
  const t = createTimer(60, 0, 'x');
  assert.equal(adjustTimer(t, 15, 10_000), 65);
  assert.equal(t.endTs, 75_000);
  assert.equal(t.duration, 65, 'la duración crece si lo restante la supera');
  assert.equal(adjustTimer(t, -15, 10_000), 50);
  assert.equal(t.endTs, 60_000);
  toggleTimer(t, 10_000);
  assert.equal(adjustTimer(t, 15, 20_000), 65);
  assert.equal(t.remaining, 65);
  assert.equal(t.paused, true);
  assert.equal(adjustTimer(t, -500, 20_000), 0);
});

test('formatElapsed: m:ss y h:mm:ss', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(59_999), '0:59');
  assert.equal(formatElapsed(61_000), '1:01');
  assert.equal(formatElapsed(3_599_000), '59:59');
  assert.equal(formatElapsed(3_661_000), '1:01:01');
  assert.equal(formatElapsed(-5), '0:00');
});

test('loadUi: descanso activo y descansos por ejercicio saneados', () => {
  const defaults = { timer: null, restByExercise: {}, expandedSessions: [], notifAsked: false };
  const raw = JSON.stringify({
    timer: { duration: 90, endTs: 5, paused: true, remaining: 40, label: 'a' },
    restByExercise: { 'press-banca': 120, 'mal id!': 30, peso: -5, otro: 1.5, cero: 0 },
    notifAsked: true,
  });
  const ui = loadUi(defaults, memoryStorage({ [KEYS.ui]: raw }));
  assert.equal(ui.timer.remaining, 40);
  assert.deepEqual(ui.restByExercise, { 'press-banca': 120, cero: 0 });
  assert.equal(ui.notifAsked, true);
  assert.deepEqual(defaults.restByExercise, {}, 'los valores por defecto no se mutan');
  assert.equal(loadUi(defaults, memoryStorage({ [KEYS.ui]: '{"timer":{"duration":"x"}}' })).timer, null);
});
