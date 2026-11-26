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
