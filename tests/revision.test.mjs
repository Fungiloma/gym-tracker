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

// ---------- Bug 11: doble redondeo en récords con lb ----------
test('bug 11: 225 lb se muestra como 225 y 1100 lb de volumen como 1100', async () => {
  const { setUnit, lbToKg, kgToDisplay } = await import('../js/units.js');
  const { formatRecord, exerciseBests, round1 } = await import('../js/stats.js');
  setUnit('lb');
  try {
    const old = sess(at(2026, 11, 2), [set(lbToKg(220), 5), set(lbToKg(200), 5)]);
    const cur = sess(at(2026, 11, 9), [set(lbToKg(225), 5), set(lbToKg(220), 5)]);
    const lines = detectRecords([old], cur).map(formatRecord);
    const w = lines.find(l => l.includes('peso '));
    assert.match(w, /peso 225 lb \(antes 220\)/);
    const v = lines.find(l => l.includes('volumen'));
    assert.match(v, /volumen 2225 lb/);
    const single = sess(at(2026, 11, 16), [set(lbToKg(225), 1)], 'banca');
    const bests = exerciseBests([single], 'banca');
    assert.equal(round1(kgToDisplay(bests.oneRM)), 225, '1RM de una sola repetición = el propio peso');
    const old2 = sess(at(2026, 11, 2), [set(lbToKg(200), 5)], 'remo');
    const cur2 = sess(at(2026, 11, 9), [set(lbToKg(220), 5)], 'remo');
    const vol = detectRecords([old2], cur2).find(r => r.kind === 'volume');
    assert.match(formatRecord(vol), /volumen 1100 lb \(antes 1000\)/);
  } finally {
    setUnit('kg');
  }
});

// ---------- Bug 15: la gráfica de 1RM no dibuja un 0 ----------
test('bug 15: con todas las series por encima de 30 reps no hay 1RM (null, no 0)', async () => {
  const { exerciseProgress } = await import('../js/stats.js');
  const hi = sess(at(2026, 11, 2), [set(20, 35), set(20, 40)]);
  const ok = sess(at(2026, 11, 9), [set(50, 10)]);
  const p = exerciseProgress([hi, ok], 'prensa');
  assert.equal(p.length, 2);
  assert.equal(p[0].best1RM, null);
  assert.equal(p[0].topWeight, 20, 'el peso máximo sigue contando');
  assert.ok(p[1].best1RM > 0);
});

// ---------- Bug 13: el límite de rutinas no cuenta las archivadas ----------
test('bug 13: 50 rutinas activas más archivadas es un plan válido; 51 activas no', async () => {
  const { validatePlan, PLAN_LIMITS, resetToDefault, createRoutine, usedIds } = await import('../js/routines.js');
  const { defaultPlan } = await import('../js/plan.js');
  const base = defaultPlan();
  const mk = (i, archived = false) => ({ id: `r${i}`, name: `Rutina ${i}`, emoji: '', duration: 30, exercises: [], ...(archived ? { archived: true } : {}) });
  const plan = { ...base, routines: [...Array.from({ length: PLAN_LIMITS.routines }, (_, i) => mk(i)), ...Array.from({ length: 10 }, (_, i) => mk(100 + i, true))] };
  assert.equal(validatePlan(plan).ok, true);
  const tooMany = { ...base, routines: Array.from({ length: PLAN_LIMITS.routines + 1 }, (_, i) => mk(i)) };
  assert.equal(validatePlan(tooMany).ok, false);

  // Restablecer el plan con 48 rutinas propias usadas por el historial: 4 originales + 48 archivadas.
  const custom = Array.from({ length: 48 }, (_, i) => mk(i));
  const current = { ...base, routines: [...base.routines, ...custom].slice(0, 50) };
  assert.equal(validatePlan(current).ok, true);
  const used = usedIds(current.routines.map(r => ({ planSessionId: r.id, exercises: [] })));
  const reset = resetToDefault(current, used);
  assert.equal(reset.ok, true, reset.error);
  assert.equal(reset.plan.routines.filter(r => !r.archived).length, 4);
  assert.ok(reset.plan.routines.filter(r => r.archived).length >= 46);

  // Con 50 activas no se puede crear otra, pero sí archivando.
  const full = { ...base, routines: Array.from({ length: 50 }, (_, i) => mk(i)) };
  assert.equal(createRoutine(full, 'Otra').ok, false);
});

// ---------- Bug 14: ids de ejercicios v1 por nombre, no por posición ----------
test('bug 14: dos ejercicios v1 distintos en la misma posición no comparten id', async () => {
  const { fromV1Sessions } = await import('../js/data.js');
  const v1 = (day, name) => ({ id: String(Date.UTC(2024, 0, day)), timestamp: Date.UTC(2024, 0, day), session: 'Sesión libre', exercises: [{ name, series: [{ weight: '50', weight2: '8' }] }] });
  const r = fromV1Sessions([v1(1, 'Remo con barra'), v1(2, 'Curl de bíceps')]);
  assert.equal(r.sessions.length, 2);
  const ids = r.sessions.map(s => s.exercises[0].id);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(ids[0], 'x-remo-con-barra');
  assert.equal(ids[1], 'x-curl-de-biceps');
  const again = fromV1Sessions([v1(3, 'Remo con barra')]);
  assert.equal(again.sessions[0].exercises[0].id, ids[0], 'el mismo nombre da el mismo id');
});

// ---------- Bug 17: duración vacía ----------
test('bug 17: vaciar la duración o el descanso de una rutina lo deja en 0', async () => {
  const { updateRoutine, setRoutineSeries } = await import('../js/routines.js');
  const { defaultPlan } = await import('../js/plan.js');
  const plan = defaultPlan();
  const id = plan.routines[0].id;
  for (const empty of ['', '   ']) {
    const r = updateRoutine(plan, id, { duration: empty });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.plan.routines[0].duration, 0);
  }
  assert.equal(updateRoutine(plan, id, { duration: 'abc' }).ok, false, 'el texto no numérico sigue rechazándose');
  const rest = setRoutineSeries(plan, id, 0, 0, 'rest', '');
  assert.equal(rest.ok, true, rest.error);
  assert.equal(rest.plan.routines[0].exercises[0].series[0].rest, 0);
});

// ---------- Bug 7: cuota de localStorage y cachés por versión del plan ----------
test('bug 7: storageUsage cuenta solo claves de la app y avisa a partir del 70 %', async () => {
  const { storageUsage, QUOTA_CHARS, QUOTA_WARN } = await import('../js/storage.js');
  const fake = entries => {
    const keys = Object.keys(entries);
    return { length: keys.length, key: i => keys[i] ?? null, getItem: k => entries[k] ?? null };
  };
  assert.equal(QUOTA_WARN, 0.7);
  const small = storageUsage(fake({ 'gymtracker.data': 'x'.repeat(1000), 'otra': 'y'.repeat(4_000_000) }));
  assert.equal(small.chars, 'gymtracker.data'.length + 1000);
  assert.ok(small.ratio < QUOTA_WARN);
  const big = storageUsage(fake({ 'gymtracker.data': 'x'.repeat(QUOTA_CHARS * 0.7) }));
  assert.ok(big.ratio >= QUOTA_WARN);
  assert.equal(storageUsage({ get length() { throw new Error('no'); } }), null, 'sin acceso devuelve null');
});

test('bug 7: fieldsForExerciseId y findPlanExercise se memorizan y se invalidan al cambiar el plan', async () => {
  const { defaultPlan, setActivePlan, findPlanExercise, planRevision } = await import('../js/plan.js');
  const { fieldsForExerciseId } = await import('../js/data.js');
  setActivePlan(defaultPlan());
  const rev = planRevision();
  const a = findPlanExercise('peso-muerto');
  assert.equal(findPlanExercise('peso-muerto'), a, 'misma referencia mientras el plan no cambia');
  const f = fieldsForExerciseId('peso-muerto');
  assert.equal(fieldsForExerciseId('peso-muerto'), f);
  assert.equal(findPlanExercise('no-existe'), null);
  assert.equal(fieldsForExerciseId('no-existe').length, 3, 'ejercicio libre: campos genéricos');

  const next = defaultPlan();
  next.exercises.find(e => e.id === 'peso-muerto').fields = [{ key: 'repsDone', unit: 'reps', label: 'Reps' }];
  setActivePlan(next);
  assert.ok(planRevision() > rev);
  assert.deepEqual(fieldsForExerciseId('peso-muerto').map(x => x.key), ['repsDone'], 'tras cambiar el plan no se sirve la caché vieja');
  setActivePlan(defaultPlan());
  assert.equal(fieldsForExerciseId('peso-muerto')[0].key, 'weight');
});
