import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRepRange, overloadRange, suggestOverload, performanceDrops, deloadNotices, muscleVolume, undertrained,
  plateBreakdown, MIN_WEEKLY_SETS, DEFAULT_PLATES, DEFAULT_BAR,
} from '../js/progress.js';
import { weekStart } from '../js/stats.js';
import { findPlanExercise, planSessions, MUSCLES, musclesOf } from '../js/plan.js';
const PLAN = planSessions();
import { setUnit, progressionStepKg } from '../js/units.js';

afterEach(() => setUnit('kg'));

const set = (weight, repsDone, over = {}) => ({ type: 'normal', target: '8-10', weight, weight2: null, repsDone, rpe: null, done: true, ...over });
const ex = (id, series, name = id) => ({ id, name, notes: '', series });
const sess = (id, startedAt, exercises) => ({ id, planSessionId: null, name: 'S', startedAt, endedAt: null, notes: '', exercises });
const day = (m, d, h = 12) => new Date(2026, m, d, h).getTime(); // 5 ene 2026 es lunes

test('parseRepRange: solo rangos "a-b" con a < b', () => {
  assert.deepEqual(parseRepRange('8-10'), { min: 8, max: 10 });
  assert.deepEqual(parseRepRange(' 12-15 '), { min: 12, max: 15 });
  for (const bad of ['10', '10-10', '12-8', '10-12 DROP', '15-20 (activ.)', '12/brazo + máx', '10×pierna', '', '0-5']) {
    assert.equal(parseRepRange(bad), null, bad);
  }
});

test('overloadRange: solo ejercicios tradicionales con un único rango', () => {
  assert.deepEqual(overloadRange(findPlanExercise('press-banca-mancuernas')), { min: 8, max: 10 });
  assert.deepEqual(overloadRange(findPlanExercise('peso-muerto')), { min: 6, max: 8 });
  for (const id of ['press-inclinado-mancuernas', 'aperturas-polea-alta', 'ss-extension-curl-femoral', 'core-circuito', 'sentadilla-bulgara']) {
    assert.equal(overloadRange(findPlanExercise(id)), null, id);
  }
  assert.equal(overloadRange(null), null);
});

test('suggestOverload: sube la carga si todas las series llegan al tope', () => {
  const sessions = [sess('a', day(0, 5), [ex('press-banca-mancuernas', [set(22.5, 10), set(22.5, 10), set(22.5, 10), set(22.5, 10)])])];
  const r = suggestOverload(sessions, 'press-banca-mancuernas');
  assert.equal(r.status, 'increase');
  assert.equal(r.weight, 22.5);
  assert.equal(r.next, 25);
  assert.deepEqual(r.range, { min: 8, max: 10 });
  assert.equal(r.planned, 4);
});

test('suggestOverload: mantiene la carga si falta alguna serie o repetición', () => {
  const short = [sess('a', day(0, 5), [ex('press-banca-mancuernas', [set(22.5, 10), set(22.5, 10), set(22.5, 9), set(22.5, 10)])])];
  assert.equal(suggestOverload(short, 'press-banca-mancuernas').status, 'hold');
  assert.deepEqual(suggestOverload(short, 'press-banca-mancuernas').reps, [10, 10, 9, 10]);
  const fewer = [sess('a', day(0, 5), [ex('press-banca-mancuernas', [set(22.5, 10), set(22.5, 10), set(22.5, 10)])])];
  const r = suggestOverload(fewer, 'press-banca-mancuernas');
  assert.equal(r.status, 'hold');
  assert.equal(r.done, 3);
  assert.equal(r.next, 22.5);
});

test('suggestOverload: usa la última sesión, ignora calentamiento y series sin hacer y devuelve null sin datos', () => {
  const sessions = [
    sess('old', day(0, 5), [ex('press-banca-mancuernas', [set(20, 10), set(20, 10), set(20, 10), set(20, 10)])]),
    sess('new', day(0, 12), [ex('press-banca-mancuernas', [
      set(10, 15, { type: 'warmup' }), set(22.5, 9), set(22.5, 9), set(22.5, 9), set(22.5, 9), set(22.5, 10, { done: false }),
    ])]),
  ];
  const r = suggestOverload(sessions, 'press-banca-mancuernas');
  assert.equal(r.sessionId, 'new');
  assert.equal(r.status, 'hold');
  assert.equal(suggestOverload([], 'press-banca-mancuernas'), null);
  assert.equal(suggestOverload(sessions, 'sentadilla-bulgara'), null);
  assert.equal(suggestOverload(sessions, 'ejercicio-que-no-existe'), null);
});

test('suggestOverload: el escalón en lb son 5 lb y la carga vuelve a verse redonda', () => {
  const sessions = [sess('a', day(0, 5), [ex('press-banca-mancuernas', [set(45.3592, 10), set(45.3592, 10), set(45.3592, 10), set(45.3592, 10)])])];
  const r = suggestOverload(sessions, 'press-banca-mancuernas', progressionStepKg('lb'));
  setUnit('lb');
  assert.equal(Math.round((r.next / 0.45359237) * 10) / 10, 105);
});

test('deloadNotices: aviso tras 6 semanas seguidas, no antes', () => {
  const week = n => sess('w' + n, day(0, 5 + 7 * n), [ex('press-banca-mancuernas', [set(20, 8)])]);
  const five = [0, 1, 2, 3, 4].map(week);
  const now = day(1, 6); // martes de la semana 5 (la sexta, en curso, sin sesión)
  assert.deepEqual(deloadNotices(five, now).filter(n => n.kind === 'weeks'), []);
  const six = [0, 1, 2, 3, 4, 5].map(week);
  const notices = deloadNotices(six, day(1, 12));
  assert.equal(notices.filter(n => n.kind === 'weeks').length, 1);
  assert.match(notices[0].text, /6 semanas/);
  assert.equal(deloadNotices(six, day(1, 12), 7).filter(n => n.kind === 'weeks').length, 0);
});

test('performanceDrops: dos últimas sesiones por debajo del 95 % del mejor reciente', () => {
  const mk = (n, w) => sess('s' + n, day(0, 5 + 7 * n), [ex('peso-muerto', [set(w, 6, { target: '6-8' })], 'Peso muerto')]);
  const down = [100, 100, 100, 100, 85, 85].map((w, i) => mk(i, w));
  const drops = performanceDrops(down);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].id, 'peso-muerto');
  // Una sola sesión floja no basta; con menos de 4 registros tampoco.
  assert.equal(performanceDrops([100, 100, 100, 100, 100, 85].map((w, i) => mk(i, w))).length, 0);
  assert.equal(performanceDrops([100, 100, 85].map((w, i) => mk(i, w))).length, 0);
  const n = deloadNotices(down, day(1, 20));
  assert.ok(n.some(x => x.kind === 'drop' && x.text.includes('Peso muerto')));
});

test('muscleVolume: cuenta series hechas por músculo, superseries en ambos y sin mapa aparte', () => {
  const w1 = weekStart(day(0, 7));
  const sessions = [
    sess('a', day(0, 5), [
      ex('press-banca-mancuernas', [set(20, 10), set(20, 10), set(20, 8, { type: 'warmup' }), set(20, 10, { done: false })]),
      ex('ss-extension-curl-femoral', [{ ...set(40, null), weight2: 30 }, { ...set(40, null), weight2: 30 }]),
      ex('sustituto-raro', [set(10, 10)]),
    ]),
    sess('b', day(0, 13), [ex('press-banca-mancuernas', [set(20, 10)])]), // otra semana
  ];
  const v = muscleVolume(sessions, w1);
  const row = id => v.rows.find(r => r.id === id);
  assert.equal(v.sessions, 1);
  assert.equal(row('pecho').sets, 2, 'calentamiento y series sin hacer no cuentan');
  assert.equal(row('pecho').volume, 400);
  assert.equal(row('cuadriceps').sets, 2);
  assert.equal(row('femoral').sets, 2);
  assert.equal(row('espalda').sets, 0);
  assert.equal(v.unassigned, 1);
  assert.equal(v.rows.length, MUSCLES.length);
});

test('mapa ejercicio → músculo: todo ejercicio del plan tiene músculos válidos', () => {
  const ids = new Set(MUSCLES.map(m => m.id));
  for (const p of PLAN) {
    for (const e of p.exercises) {
      assert.ok(musclesOf(e.id).length > 0, `${e.id} sin músculo`);
      assert.ok(musclesOf(e.id).every(m => ids.has(m)), `${e.id} con músculo desconocido`);
    }
  }
});

test('undertrained: solo semanas terminadas con sesiones', () => {
  const w1 = weekStart(day(0, 7));
  const sessions = [sess('a', day(0, 5), [ex('press-banca-mancuernas', [set(20, 10), set(20, 10)])])];
  const v = muscleVolume(sessions, w1);
  const now = day(0, 20);
  const low = undertrained(v, w1, now).map(r => r.id);
  assert.ok(low.includes('espalda') && low.includes('pecho'));
  assert.equal(low.length, MUSCLES.length, '2 series de pecho quedan por debajo de ' + MIN_WEEKLY_SETS);
  assert.deepEqual(undertrained(v, w1, day(0, 7)), [], 'semana en curso: sin avisos');
  assert.deepEqual(undertrained(muscleVolume([], w1), w1, now), [], 'semana sin sesiones: sin avisos');
});

test('plateBreakdown: reparto por lado con barra de 20 kg', () => {
  const r = plateBreakdown(100, 20, DEFAULT_PLATES.kg);
  assert.equal(r.ok, true);
  assert.deepEqual(r.perSide, [{ plate: 25, count: 1 }, { plate: 15, count: 1 }]);
  assert.equal(r.achieved, 100);
  assert.equal(r.remainder, 0);
  const r2 = plateBreakdown(62.5, 20, DEFAULT_PLATES.kg);
  assert.deepEqual(r2.perSide, [{ plate: 20, count: 1 }, { plate: 1.25, count: 1 }]);
  assert.equal(r2.achieved, 62.5);
});

test('plateBreakdown: solo la barra, por debajo de la barra, resto sin cubrir y entradas inválidas', () => {
  assert.deepEqual(plateBreakdown(20, 20, [25, 10]).perSide, []);
  assert.deepEqual(plateBreakdown(15, 20, [25]), { ok: false, error: 'below-bar' });
  const r = plateBreakdown(23, 20, [2.5, 1.25]);
  assert.equal(r.achieved, 22.5);
  assert.equal(r.remainder, 0.25);
  assert.deepEqual(plateBreakdown(100, 20, []), { ok: false, error: 'no-plates' });
  assert.deepEqual(plateBreakdown(100, 20, [0, -5, NaN]), { ok: false, error: 'no-plates' });
  assert.deepEqual(plateBreakdown(NaN, 20, [5]), { ok: false, error: 'invalid' });
  // Sin error de coma flotante con discos de 1,25 y 0,5.
  const f = plateBreakdown(21.7, 20, [0.5, 0.25, 0.1]);
  assert.equal(f.remainder, 0);
  assert.equal(f.achieved, 21.7);
});

test('plateBreakdown: discos en lb convertidos a kg', () => {
  const lb = x => Math.round(x * 0.45359237 * 10000) / 10000;
  const r = plateBreakdown(lb(225), lb(DEFAULT_BAR.lb), DEFAULT_PLATES.lb.map(lb));
  assert.deepEqual(r.perSide.map(p => [p.plate, p.count]), [[lb(45), 2]]);
  assert.equal(r.remainder, 0);
});
