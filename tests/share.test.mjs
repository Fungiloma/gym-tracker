import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildShareCard, CARD_W, CARD_H } from '../js/share.js';
import { setUnit } from '../js/units.js';

afterEach(() => setUnit('kg'));

const set = (weight, repsDone, over = {}) => ({ type: 'normal', target: '', weight, weight2: null, repsDone, rpe: null, done: true, ...over });
const ex = (id, name, series) => ({ id, name, notes: '', series });
const session = exercises => ({ id: 's', planSessionId: null, name: 'Sesión 1: Pecho', startedAt: Date.UTC(2026, 0, 5, 10), endedAt: Date.UTC(2026, 0, 5, 11, 15), notes: '', exercises });

test('buildShareCard: cifras, mejores series y récords', () => {
  const s = session([
    ex('press-banca-mancuernas', 'Press banca mancuernas', [set(20, 10), set(22.5, 8), set(22.5, 9), set(10, 12, { type: 'warmup' })]),
    ex('ss-extension-curl-femoral', 'Superserie', [{ ...set(40, null), weight2: 30 }]),
    ex('vacio', 'Sin hacer', [set(10, 10, { done: false })]),
  ]);
  const m = buildShareCard(s, [{ name: 'Press', kind: 'weight', value: 22.5, previous: 20 }], '5/1/2026');
  assert.equal(m.title, 'Sesión 1: Pecho');
  assert.deepEqual(m.stats.map(x => x.label), ['Duración', 'Volumen', 'Series']);
  assert.equal(m.stats[0].value, '75 min');
  assert.equal(m.stats[1].value, '583 kg');
  assert.equal(m.stats[2].value, '5', 'calentamiento incluido en las series hechas');
  assert.deepEqual(m.exercises.map(e => e.name), ['Press banca mancuernas', 'Superserie']);
  assert.equal(m.exercises[0].line, '22.5 kg × 9');
  assert.equal(m.exercises[1].line, '1 series');
  assert.equal(m.records.length, 1);
  assert.match(m.records[0], /Press: peso 22,5 kg/);
});

test('buildShareCard: en lb convierte; sin duración ni volumen omite esas cifras; limita ejercicios y récords', () => {
  setUnit('lb');
  const s = session([ex('press-banca-mancuernas', 'Press', [set(45.3592, 10)])]);
  const m = buildShareCard(s, [], '5/1/2026');
  assert.equal(m.exercises[0].line, '100 lb × 10');
  assert.equal(m.stats[1].value, '1000 lb');
  setUnit('kg');
  const many = session(Array.from({ length: 8 }, (_, i) => ex('e' + i, 'Ej ' + i, [set(10, 10)])));
  many.endedAt = null;
  const recs = Array.from({ length: 5 }, (_, i) => ({ name: 'R' + i, kind: 'reps', value: 10, previous: 5 }));
  const m2 = buildShareCard(many, recs, 'x');
  assert.equal(m2.exercises.length, 5);
  assert.equal(m2.moreExercises, 3);
  assert.equal(m2.records.length, 3);
  assert.deepEqual(m2.stats.map(x => x.label), ['Volumen', 'Series']);
  assert.equal(CARD_W / CARD_H, 0.8);
});
