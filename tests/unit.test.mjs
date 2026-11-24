import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN, SESSION_KEYS, buildSessionData, restFor } from '../js/plan.js';
import { KEYS, LEGACY_KEYS, loadState, saveState, loadSessions, saveSessions } from '../js/storage.js';
import {
  formatRest, formatRemaining, ringOffset, remainingAt, createTimer, toggleTimer, isTimerKey, RING_CIRCUMFERENCE,
} from '../js/timers.js';
import { formatSeriesLine, buildSummaryText } from '../js/views.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    dump: () => Object.fromEntries(data),
  };
}

const S1 = SESSION_KEYS[0];

test('claves de almacenamiento con prefijo gymtracker.', () => {
  for (const k of Object.values(KEYS)) assert.match(k, /^gymtracker\./);
});

test('loadSessions lee la clave nueva, cae a la antigua y tolera basura', () => {
  assert.deepEqual(loadSessions(memoryStorage()), []);
  assert.deepEqual(loadSessions(memoryStorage({ [LEGACY_KEYS.sessions]: '[{"id":1}]' })), [{ id: 1 }]);
  assert.deepEqual(
    loadSessions(memoryStorage({ [KEYS.sessions]: '[{"id":2}]', [LEGACY_KEYS.sessions]: '[{"id":1}]' })),
    [{ id: 2 }],
  );
  assert.deepEqual(loadSessions(memoryStorage({ [KEYS.sessions]: '{no json' })), []);
  assert.deepEqual(loadSessions(memoryStorage({ [KEYS.sessions]: '{"a":1}' })), []);
});

test('saveSessions escribe solo la clave nueva y no toca la antigua', () => {
  const st = memoryStorage({ [LEGACY_KEYS.sessions]: '[]' });
  saveSessions([{ id: 3 }], st);
  assert.equal(st.dump()[KEYS.sessions], '[{"id":3}]');
  assert.equal(st.dump()[LEGACY_KEYS.sessions], '[]');
});

test('loadState fusiona con los valores por defecto y rechaza no-objetos', () => {
  const defaults = { activeSession: null, timers: {}, expandedSessions: [] };
  assert.deepEqual(loadState(defaults, memoryStorage()), defaults);
  assert.deepEqual(loadState(defaults, memoryStorage({ [KEYS.state]: '[1,2]' })), defaults);
  assert.deepEqual(loadState(defaults, memoryStorage({ [KEYS.state]: 'null' })), defaults);
  const st = memoryStorage();
  saveState({ ...defaults, activeSession: S1 }, st);
  assert.equal(loadState(defaults, st).activeSession, S1);
});

test('buildSessionData crea una fila por serie y precarga los kg de la última sesión', () => {
  const empty = buildSessionData(S1, []);
  const first = PLAN[S1][0];
  assert.equal(empty[first.name].length, first.series.length);
  assert.deepEqual(empty[first.name][0], { reps: first.series[0].reps, weight: '', weight2: '' });

  const history = [
    { session: S1, timestamp: 1, exercises: [{ name: first.name, series: [{ weight: '10' }] }] },
    { session: S1, timestamp: 2, exercises: [{ name: first.name, series: [{ weight: '20', weight2: '5' }] }] },
    { session: SESSION_KEYS[1], timestamp: 3, exercises: [{ name: first.name, series: [{ weight: '99' }] }] },
  ];
  const data = buildSessionData(S1, history);
  assert.equal(data[first.name][0].weight, '20');
  assert.equal(data[first.name][0].weight2, '5');
  assert.equal(data[first.name][1].weight, '');
});

test('buildSessionData ignora ejercicios desconocidos y entradas corruptas', () => {
  const history = [{ session: S1, timestamp: 1, exercises: [null, { name: '__proto__', series: [{ weight: 'x' }] }, { name: 'otro' }] }];
  const data = buildSessionData(S1, history);
  assert.equal(Object.getPrototypeOf(data), Object.prototype);
  assert.ok(!Object.hasOwn(data, 'otro'));
  assert.deepEqual(buildSessionData('no existe', history), {});
});

test('restFor devuelve el descanso del plan y null en claves inválidas', () => {
  assert.equal(restFor(S1, '0-0'), PLAN[S1][0].series[0].rest);
  assert.equal(restFor(S1, '2-3'), null); // myo-reps última serie: rest 0
  assert.equal(restFor(S1, '99-0'), null);
  assert.equal(restFor(S1, "0-0');alert(1)//"), null);
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

test('formatSeriesLine y buildSummaryText mantienen el formato del resumen', () => {
  assert.equal(formatSeriesLine({ reps: '8-10', weight: '22.5' }, 0), 'Serie 1: 8-10 reps @ 22.5kg');
  assert.equal(formatSeriesLine({ reps: '8', weight: '10', weight2: '5' }, 1), 'Serie 2: 8 reps @ 10kg + 5kg');
  assert.equal(formatSeriesLine({ reps: '8' }, 2), 'Serie 3: 8 reps');
  const txt = buildSummaryText('S', [{ name: 'Ej', series: [{ reps: '8', weight: '1' }] }], '1/1/2026');
  assert.equal(txt, '[GUARDAR SESIÓN]\n📅 1/1/2026 — S\n\n▸ Ej\n  Serie 1: 8 reps @ 1kg\n');
});
