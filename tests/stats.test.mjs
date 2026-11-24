import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  epley1RM, seriesVolume, exerciseVolume, sessionVolume, countedSeries, pairsWeightReps, weekStart, addWeeks, dayKey,
  detectRecords, exerciseProgress, exerciseBests, listExercises, weeklyStats, weekStreaks, calendarMonth, shiftMonth,
  buildWeeklySummary, bodySeries, keyToTs, formatRecord,
} from '../js/stats.js';
import { niceTicks, lineGeometry, barGeometry } from '../js/charts.js';
import {
  validateBodyEntry, parseBodyInput, upsertBody, validateData, tryValidateData, emptyData, buildExport, parseImport, mergeBody, isDateKey,
} from '../js/data.js';

// Fechas locales: los tests no dependen de la zona horaria de la máquina.
const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h, 0).getTime();
const NOW = at(2026, 11, 25, 12); // miércoles

function s(weight, reps, over = {}) {
  return { type: 'normal', target: '', weight, weight2: null, repsDone: reps, rpe: null, done: true, ...over };
}
function ex(id, series, name = id) {
  return { id, name, notes: '', series };
}
let n = 0;
function sess(ts, exercises, over = {}) {
  n += 1;
  return { id: `s${n}`, planSessionId: 'pierna', name: 'Sesión 2: Pierna', startedAt: ts, endedAt: ts + 3_600_000, notes: '', exercises, ...over };
}

test('1RM Epley: fórmula, 1 rep, límites y entradas inválidas', () => {
  assert.equal(epley1RM(100, 1), 100);
  assert.equal(epley1RM(100, 10), 100 * (1 + 10 / 30));
  assert.equal(epley1RM(60, 5), 70);
  assert.equal(epley1RM(100, 30) > 0, true);
  assert.equal(epley1RM(100, 31), null, 'más de 30 reps no es fiable');
  for (const [w, r] of [[0, 5], [-5, 5], [100, 0], [null, 5], [100, null], [NaN, 5], [100, Infinity], ['100', 5]]) {
    assert.equal(epley1RM(w, r), null, `${w}x${r}`);
  }
});

test('volumen: solo series hechas, sin calentamiento, con kg y reps', () => {
  const e = ex('press-banca-mancuernas', [
    s(20, 10),
    s(20, 8),
    s(10, 12, { type: 'warmup' }),
    s(20, 8, { done: false }),
    s(null, 10),
    s(20, null),
    s(0, 10),
    s(25, 6, { type: 'drop' }),
  ]);
  assert.equal(countedSeries(e).length, 3);
  assert.equal(exerciseVolume(e), 200 + 160 + 150);
  assert.equal(seriesVolume(s(22.5, 8)), 180);
  assert.equal(sessionVolume(sess(NOW, [e, ex('prensa', [s(100, 10)])])), 510 + 1000);
  assert.equal(sessionVolume(sess(NOW, [])), 0);
});

test('superseries con campos propios no entran en volumen ni 1RM', () => {
  assert.equal(pairsWeightReps('press-banca-mancuernas'), true);
  assert.equal(pairsWeightReps('ss-dominadas-press-cerrado'), false);
  assert.equal(pairsWeightReps('ss-extension-curl-femoral'), false);
  assert.equal(pairsWeightReps('ejercicio-importado'), true);
  assert.equal(exerciseVolume(ex('ss-dominadas-press-cerrado', [s(30, 8)])), 0);
});

test('récords: peso, reps, 1RM y volumen frente al historial; primera vez no cuenta', () => {
  const id = 'peso-muerto';
  const first = sess(at(2026, 11, 2), [ex(id, [s(100, 6), s(100, 6)], 'Peso muerto')]);
  assert.deepEqual(detectRecords([], first), [], 'primera vez: solo fija la base');

  const better = sess(at(2026, 11, 9), [ex(id, [s(105, 6), s(100, 7)], 'Peso muerto')]);
  const kinds = detectRecords([first], better).map(r => r.kind).sort();
  assert.deepEqual(kinds, ['oneRM', 'reps', 'volume', 'weight']);
  const w = detectRecords([first], better).find(r => r.kind === 'weight');
  assert.equal(w.value, 105);
  assert.equal(w.previous, 100);

  const same = sess(at(2026, 11, 16), [ex(id, [s(100, 6), s(100, 6)], 'Peso muerto')]);
  assert.deepEqual(detectRecords([first], same), [], 'igualar no es batir');

  const lighter = sess(at(2026, 11, 16), [ex(id, [s(60, 12)], 'Peso muerto')]);
  assert.deepEqual(detectRecords([first], lighter).map(r => r.kind), ['reps'], 'más reps que cualquier serie previa con peso igual o mayor');
});

test('récord de reps solo con el mismo peso o más; calentamiento y no hechas no cuentan', () => {
  const id = 'prensa';
  const old = sess(at(2026, 11, 2), [ex(id, [s(100, 10)])]);
  const lowerWeightFewerReps = sess(at(2026, 11, 9), [ex(id, [s(80, 9)])]);
  assert.ok(!detectRecords([old], lowerWeightFewerReps).some(r => r.kind === 'reps'), '80×9 no supera a 100×10');
  const sameWeightMoreReps = sess(at(2026, 11, 9), [ex(id, [s(100, 11)])]);
  assert.ok(detectRecords([old], sameWeightMoreReps).some(r => r.kind === 'reps' && r.value === 11 && r.previous === 10));
  const fake = sess(at(2026, 11, 9), [ex(id, [s(200, 5, { type: 'warmup' }), s(200, 5, { done: false })])]);
  assert.deepEqual(detectRecords([old], fake), []);
});

test('récords ignoran sesiones posteriores y la propia sesión', () => {
  const id = 'prensa';
  const a = sess(at(2026, 11, 2), [ex(id, [s(100, 10)])]);
  const future = sess(at(2026, 11, 20), [ex(id, [s(300, 10)])]);
  assert.deepEqual(detectRecords([a, future], a), []);
  const b = sess(at(2026, 11, 9), [ex(id, [s(110, 10)])]);
  assert.ok(detectRecords([a, future, b], b).some(r => r.kind === 'weight' && r.previous === 100));
  assert.match(formatRecord(detectRecords([a], b).find(r => r.kind === 'weight')), /peso 110 kg \(antes 100\)/);
});

test('progresión por ejercicio y mejores marcas', () => {
  const id = 'remo-barra';
  const list = [
    sess(at(2026, 11, 9), [ex(id, [s(60, 8), s(65, 5)], 'Remo barra')]),
    sess(at(2026, 11, 2), [ex(id, [s(55, 10)], 'Remo barra')]),
    sess(at(2026, 11, 16), [ex(id, [s(50, 10, { done: false })], 'Remo barra')]),
  ];
  const p = exerciseProgress(list, id);
  assert.equal(p.length, 2, 'la sesión sin series válidas no genera punto');
  assert.deepEqual(p.map(x => x.topWeight), [55, 65]);
  assert.ok(p[0].ts < p[1].ts);
  const b = exerciseBests(list, id);
  assert.equal(b.weight, 65);
  assert.equal(b.maxReps, 10);
  assert.equal(exerciseBests(list, 'otro'), null);
  const l = listExercises(list);
  assert.equal(l.length, 1);
  assert.equal(l[0].sessions, 3);
});

test('semanas empiezan en lunes y addWeeks cruza el cambio de hora', () => {
  assert.equal(dayKey(weekStart(at(2026, 11, 25))), '2026-11-23');
  assert.equal(dayKey(weekStart(at(2026, 11, 23, 0))), '2026-11-23');
  assert.equal(dayKey(weekStart(at(2026, 11, 29, 23))), '2026-11-23', 'domingo pertenece a la semana anterior');
  assert.equal(dayKey(addWeeks(weekStart(at(2026, 3, 25)), 1)), '2026-03-30');
  assert.equal(dayKey(addWeeks(weekStart(at(2026, 10, 28)), 1)), '2026-11-02');
});

test('volumen y frecuencia semanal: 8 semanas, la actual la última, fuera de rango ignorado', () => {
  const list = [
    sess(at(2026, 11, 24), [ex('prensa', [s(100, 10)])]),
    sess(at(2026, 11, 18), [ex('prensa', [s(100, 5)])]),
    sess(at(2026, 11, 19), [ex('prensa', [s(50, 10)])]),
    sess(at(2025, 1, 1), [ex('prensa', [s(999, 10)])]),
  ];
  const w = weeklyStats(list, 8, NOW);
  assert.equal(w.length, 8);
  assert.equal(dayKey(w[7].start), '2026-11-23');
  assert.equal(w[7].volume, 1000);
  assert.equal(w[6].sessions, 2);
  assert.equal(w[6].volume, 1000);
  assert.equal(w.reduce((a, x) => a + x.sessions, 0), 3);
});

test('rachas semanales: actual no se rompe en la semana en curso y mejor histórica', () => {
  const week = (y, m, d) => sess(at(y, m, d), [ex('prensa', [s(10, 10)])]);
  const list = [week(2026, 11, 24), week(2026, 11, 17), week(2026, 11, 10), week(2026, 10, 20), week(2026, 10, 13)];
  assert.deepEqual(weekStreaks(list, NOW), { current: 3, best: 3 });
  assert.deepEqual(weekStreaks(list.slice(1), NOW), { current: 2, best: 2 }, 'semana actual vacía: cuenta desde la anterior');
  assert.deepEqual(weekStreaks([week(2026, 10, 13)], NOW), { current: 0, best: 1 });
  assert.deepEqual(weekStreaks([], NOW), { current: 0, best: 0 });
  assert.deepEqual(weekStreaks(list, NOW, 2), { current: 0, best: 0 }, 'mínimo de 2 sesiones por semana');
});

test('calendario: lunes primero, relleno y conteo por día', () => {
  const list = [sess(at(2026, 11, 3), []), sess(at(2026, 11, 3, 20), []), sess(at(2026, 11, 30), [])];
  const weeks = calendarMonth(list, 2026, 10); // noviembre 2026 empieza en domingo
  assert.ok(weeks.every(w => w.length === 7));
  assert.equal(weeks[0].filter(Boolean).length, 1, '1 de nov es domingo: solo la última celda');
  assert.equal(weeks[0][6].day, 1);
  const cells = weeks.flat().filter(Boolean);
  assert.equal(cells.length, 30);
  assert.equal(cells.find(c => c.day === 3).count, 2);
  assert.equal(cells.find(c => c.day === 30).count, 1);
  assert.equal(cells.find(c => c.day === 4).count, 0);
  assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.equal(calendarMonth([], 2028, 1).flat().filter(Boolean).length, 29, 'febrero bisiesto');
});

test('resumen semanal: sesiones, volumen vs semana anterior, récords, peso y racha', () => {
  const prev = sess(at(2026, 11, 10), [ex('prensa', [s(100, 10)], 'Prensa')]);
  const cur = sess(at(2026, 11, 24), [ex('prensa', [s(110, 10)], 'Prensa')]);
  const body = [{ date: '2026-11-25', weight: 78.4, waist: null, chest: null, arm: null, thigh: null }];
  const text = buildWeeklySummary([prev, cur], body, weekStart(NOW));
  assert.match(text, /^\[RESUMEN SEMANAL\] 23 nov a 29 nov 2026/);
  assert.match(text, /Sesiones: 1/);
  assert.match(text, /Volumen: 1100 kg/);
  assert.match(text, /Récords:/);
  assert.match(text, /Prensa: peso 110 kg \(antes 100\)/);
  assert.match(text, /Peso corporal: 78,4 kg/);
  assert.match(text, /Racha semanal:/);
  const emptyWeek = buildWeeklySummary([prev], [], weekStart(NOW));
  assert.match(emptyWeek, /Sin sesiones esta semana/);
  const withPrev = buildWeeklySummary([sess(at(2026, 11, 17), [ex('prensa', [s(100, 10)])]), cur], [], weekStart(NOW));
  assert.match(withPrev, /\(\+10% vs semana anterior\)/);
});

test('peso corporal: validación, parseo con coma, una entrada por fecha', () => {
  assert.equal(isDateKey('2026-02-30'), false);
  assert.equal(isDateKey('2026-11-25'), true);
  assert.equal(isDateKey('1999-12-31'), false);
  assert.equal(isDateKey('2026-1-5'), false);
  assert.equal(validateBodyEntry({ date: '2026-11-25', weight: 78.4 }).ok, true);
  for (const bad of [
    null, [], { date: '2026-11-25' }, { date: '2026-11-25', weight: 5 }, { date: '2026-11-25', weight: 501 },
    { date: '2026-11-25', weight: '78' }, { date: '2026-11-25', waist: 9 }, { date: 'x', weight: 70 }, { date: '2026-11-25', weight: NaN },
  ]) assert.equal(validateBodyEntry(bad).ok, false, JSON.stringify(bad));
  const r = parseBodyInput('2026-11-25', { weight: '78,4', waist: ' 82 ', chest: '' });
  assert.deepEqual(r.entry, { date: '2026-11-25', weight: 78.4, waist: 82, chest: null, arm: null, thigh: null });
  assert.equal(parseBodyInput('2026-11-25', { weight: '7e1' }).ok, false);
  assert.equal(parseBodyInput('2026-11-25', { weight: '<img>' }).ok, false);
  assert.equal(parseBodyInput('2026-11-25', {}).ok, false, 'sin valores');
  const a = r.entry;
  const list = upsertBody([a], { ...a, weight: 77 });
  assert.equal(list.length, 1);
  assert.equal(list[0].weight, 77);
  assert.deepEqual(upsertBody([{ ...a, date: '2026-11-26' }], a).map(b => b.date), ['2026-11-25', '2026-11-26']);
});

test('esquema v2 con body: opcional en v2 antiguo, inválidos aparte, export e import', () => {
  assert.deepEqual(emptyData().body, []);
  const old = validateData({ schemaVersion: 2, sessions: [] });
  assert.deepEqual(old.data.body, []);
  assert.throws(() => validateData({ schemaVersion: 2, sessions: [], body: {} }));
  const v = validateData({
    schemaVersion: 2, sessions: [],
    body: [{ date: '2026-11-25', weight: 78 }, { date: '2026-11-25', weight: 79 }, { date: '2026-11-24', weight: 1 }, { date: '2026-11-23', weight: 80 }],
  });
  assert.deepEqual(v.data.body.map(b => b.date), ['2026-11-23', '2026-11-25'], 'ordenadas, duplicada y fuera de rango apartadas');
  assert.equal(v.rejected.length, 2);
  assert.ok(v.rejected.every(r => r.kind === 'body'));

  const data = { ...emptyData(), body: v.data.body };
  const exp = buildExport(data);
  assert.equal(exp.body.length, 2);
  const preview = parseImport(JSON.stringify(exp), [], [{ date: '2026-11-25', weight: 70, waist: null, chest: null, arm: null, thigh: null }]);
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.freshBody.map(b => b.date), ['2026-11-23'], 'lo local no se sobrescribe');
  const m = mergeBody([v.data.body[1]], preview.freshBody);
  assert.equal(m.added, 1);
  assert.deepEqual(m.body.map(b => b.date), ['2026-11-23', '2026-11-25']);
  assert.equal(tryValidateData(exp).ok, true, 'el export se vuelve a leer');
});

test('bodySeries filtra medidas ausentes y ordena', () => {
  const mk = (date, weight) => ({ date, weight, waist: null, chest: null, arm: null, thigh: null });
  const p = bodySeries([mk('2026-11-25', 78), mk('2026-11-20', null), mk('2026-11-10', 80)], 'weight');
  assert.deepEqual(p.map(x => x.value), [80, 78]);
  assert.equal(keyToTs('2026-13-01'), null);
});

test('gráficas: ticks, geometría de líneas y barras, casos límite', () => {
  assert.deepEqual(niceTicks(0, 100), [0, 50, 100]);
  assert.deepEqual(niceTicks(0, 10), [0, 5, 10]);
  const t = niceTicks(78, 82);
  assert.ok(t[0] <= 78 && t[t.length - 1] >= 82);
  assert.ok(niceTicks(5, 5).length >= 2, 'rango nulo: se ensancha');
  assert.deepEqual(niceTicks(NaN, 1), [0, 1]);

  assert.equal(lineGeometry([{ name: 'a', cls: 'x', points: [] }]), null);
  const one = lineGeometry([{ name: 'a', cls: 'x', points: [{ x: 10, y: 50 }] }]);
  assert.equal(one.series[0].coords.length, 1, 'un solo punto');
  assert.ok(Number.isFinite(one.series[0].coords[0].x) && Number.isFinite(one.series[0].coords[0].y));
  const two = lineGeometry([{ name: 'a', cls: 'x', points: [{ x: 0, y: 10 }, { x: 100, y: 20 }] }]);
  const [c0, c1] = two.series[0].coords;
  assert.ok(c1.x > c0.x && c1.y < c0.y, 'y crece hacia arriba');

  assert.equal(barGeometry([]), null);
  const z = barGeometry([{ label: 'a', value: 0 }, { label: 'b', value: 0 }]);
  assert.ok(z.bars.every(b => b.h === 0 && Number.isFinite(b.y)), 'todo ceros no da NaN');
  const b = barGeometry([{ label: 'a', value: 10 }, { label: 'b', value: 20 }]);
  assert.ok(b.bars[1].h > b.bars[0].h);
});
