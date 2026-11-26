// Tests de la fase 10b (docs/REVISION-CODIGO.md). Cada bloque falla con el código de master en fe09422.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, setDraftValue, draftStats, finalizeDraft, toggleSeriesDone } from '../js/data.js';
import { sessionVolume, detectRecords, countedSeries } from '../js/stats.js';
import { suggestOverload } from '../js/progress.js';

const ROUTINE = 'pierna';
const DAY = 86_400_000;

// ---------- Bug 3: una serie solo cuenta como hecha con ✓ ----------
test('bug 3: finalizeDraft guarda done solo si la serie tiene ✓ y valores', () => {
  const d = createDraft(ROUTINE, Date.UTC(2026, 5, 1, 10));
  setDraftValue(d, 0, 0, 'weight', '100');
  setDraftValue(d, 0, 0, 'repsDone', '5');
  setDraftValue(d, 0, 1, 'weight', '100');
  setDraftValue(d, 0, 1, 'repsDone', '5');
  toggleSeriesDone(d, 0, 1);
  assert.equal(d.exercises[0].series[1].done, true);
  const r = finalizeDraft(d, Date.UTC(2026, 5, 1, 11));
  assert.equal(r.ok, true);
  const [a, b, c] = r.session.exercises[0].series;
  assert.equal(a.done, false, 'con valores pero sin ✓ no está hecha');
  assert.equal(a.weight, 100, 'el valor se conserva');
  assert.equal(b.done, true);
  assert.equal(c.done, false, 'vacía no está hecha');
});

test('bug 3: draftStats cuenta las series con valores sin ✓', () => {
  const d = createDraft(ROUTINE, Date.UTC(2026, 5, 1, 10));
  const total = d.exercises.reduce((n, e) => n + e.series.length, 0);
  setDraftValue(d, 0, 0, 'weight', '100');
  setDraftValue(d, 0, 0, 'repsDone', '5');
  setDraftValue(d, 0, 1, 'weight', '90');
  toggleSeriesDone(d, 0, 1);
  setDraftValue(d, 0, 2, 'repsDone', '8');
  assert.deepEqual(draftStats(d), { total, filled: 3, missing: total - 3, unchecked: 2 });
});

test('bug 3: las series sin ✓ no cuentan para volumen, récords ni sobrecarga', () => {
  const t0 = Date.UTC(2026, 5, 1, 10);
  const mk = (ts, id, checked) => {
    const d = createDraft(ROUTINE, ts);
    d.id = id;
    for (let i = 0; i < d.exercises[0].series.length; i++) {
      setDraftValue(d, 0, i, 'weight', '100');
      setDraftValue(d, 0, i, 'repsDone', '8');
      if (checked) toggleSeriesDone(d, 0, i);
    }
    return finalizeDraft(d, ts + 3_600_000).session;
  };
  const base = mk(t0, 'base', true);
  const unchecked = mk(t0 + 7 * DAY, 'sin-check', false);
  assert.equal(sessionVolume(unchecked), 0);
  assert.equal(countedSeries(unchecked.exercises[0]).length, 0);
  assert.deepEqual(detectRecords([base], unchecked), []);
  assert.ok(sessionVolume(base) > 0);
  assert.equal(suggestOverload([base, unchecked], unchecked.exercises[0].id, 2.5).status, suggestOverload([base], base.exercises[0].id, 2.5).status);
});

// ---------- Bug 4: récords de repeticiones falsos ----------
const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h, 0).getTime();
let seq = 0;
const set = (weight, reps, over = {}) => ({ type: 'normal', target: '', weight, weight2: null, repsDone: reps, rpe: null, done: true, ...over });
const sess = (ts, series, id = 'prensa') => {
  seq += 1;
  return { id: `r${seq}`, planSessionId: 'pierna', name: 'Pierna', startedAt: ts, endedAt: ts + 3_600_000, notes: '', exercises: [{ id, name: id, notes: '', series }] };
};
const kinds = (prev, cur) => detectRecords(prev, cur).map(r => r.kind).sort();

test('bug 4: tras 100×5, una descarga 60×8 no es récord de repeticiones', () => {
  const old = sess(at(2026, 11, 2), [set(100, 5)]);
  assert.deepEqual(kinds([old], sess(at(2026, 11, 9), [set(60, 8)])), []);
});

test('bug 4: un drop no es récord de repeticiones', () => {
  const old = sess(at(2026, 11, 2), [set(100, 5), set(50, 8)]);
  assert.ok(!kinds([old], sess(at(2026, 11, 9), [set(100, 5), set(50, 12, { type: 'drop' })])).includes('reps'));
});

test('bug 4: subir de 220 a 225 lb da récord de peso y no de repeticiones', () => {
  const kg = lb => Math.round(lb * 0.45359237 * 10000) / 10000;
  const old = sess(at(2026, 11, 2), [set(kg(220), 5)]);
  const cur = sess(at(2026, 11, 9), [set(kg(225), 5)]);
  const out = detectRecords([old], cur);
  assert.ok(out.some(r => r.kind === 'weight'));
  assert.ok(!out.some(r => r.kind === 'reps'), 'un peso nuevo no es récord de reps');
});

test('bug 4: con el mismo peso y más reps sí es récord, también entre lb y kg redondeados', () => {
  const old = sess(at(2026, 11, 2), [set(100, 5), set(100.0227, 6)]);
  const out = detectRecords([old], sess(at(2026, 11, 9), [set(100, 7)]));
  const r = out.find(x => x.kind === 'reps');
  assert.ok(r, 'récord de reps');
  assert.equal(r.value, 7);
  assert.equal(r.previous, 6);
});

test('bug 4: una serie que ya es récord de peso no genera además uno de repeticiones', () => {
  const old = sess(at(2026, 11, 2), [set(100, 5), set(105, 3)]);
  const cur = sess(at(2026, 11, 9), [set(105, 4), set(110, 6)]);
  const ks = kinds([old], cur);
  assert.ok(ks.includes('weight'));
  assert.ok(ks.includes('reps'), '105×4 supera 105×3 y no es récord de peso');
  const rep = detectRecords([old], cur).find(r => r.kind === 'reps');
  assert.equal(rep.value, 4);
  assert.equal(rep.previous, 3);
  const only110 = sess(at(2026, 11, 16), [set(110, 12)]);
  assert.ok(!kinds([old], only110).includes('reps'));
});
