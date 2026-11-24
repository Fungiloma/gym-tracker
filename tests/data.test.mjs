import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN, findPlanExercise, fieldsFor } from '../js/plan.js';
import {
  SCHEMA_VERSION, parseValue, validateSession, validateData, fromV1Sessions, createDraft, restoreDraft,
  setDraftValue, draftStats, finalizeDraft, toggleSeriesDone, fillSeries, addSeries, removeLastSeries, insertSeries,
  moveExercise, substituteExercise, setNote, restForSeries, defaultRest, slugId, formatPreviousShort, previousFor, formatSeriesLine, formatPrevious, buildSummaryText,
  buildExport, parseImport, mergeSessions, toCSV, csvCell, CSV_HEADER, GENERIC_FIELDS,
} from '../js/data.js';

const T0 = Date.UTC(2026, 10, 20, 18, 0);
const XSS = '<img src=x onerror="globalThis.__pwned=1">';
const P1 = PLAN[0];
const P3 = PLAN[2];

function series(over = {}) {
  return { type: 'normal', target: '8-10', weight: 20, weight2: null, repsDone: 8, rpe: null, done: true, ...over };
}

function session(over = {}) {
  return {
    id: 'a1', planSessionId: P1.id, name: P1.name, startedAt: T0, endedAt: T0 + 3_600_000, notes: '',
    exercises: [{ id: P1.exercises[0].id, name: P1.exercises[0].name, notes: '', series: [series()] }],
    ...over,
  };
}

test('parseValue: coma decimal, vacío, rangos y basura', () => {
  assert.deepEqual(parseValue('weight', '22,5'), { ok: true, value: 22.5 });
  assert.deepEqual(parseValue('weight', ' 40 '), { ok: true, value: 40 });
  assert.deepEqual(parseValue('weight', ''), { ok: true, value: null });
  assert.deepEqual(parseValue('weight', null), { ok: true, value: null });
  for (const bad of ['-5', '1e3', 'abc', '1001', 'Infinity', '22.5.1', XSS, {}, []]) {
    assert.equal(parseValue('weight', bad).ok, false, String(bad));
  }
  assert.equal(parseValue('repsDone', '8.5').ok, false, 'reps enteras');
  assert.equal(parseValue('repsDone', '12').value, 12);
  assert.equal(parseValue('rpe', '0').ok, false);
  assert.equal(parseValue('rpe', 8.5).value, 8.5);
  assert.equal(parseValue('weight', NaN).ok, false);
});

test('validateSession acepta una sesión v2 correcta y descarta claves desconocidas', () => {
  const r = validateSession({ ...session(), extra: 'x', __proto__: { polluted: true } });
  assert.equal(r.ok, true);
  assert.equal(Object.hasOwn(r.session, 'extra'), false);
  assert.deepEqual(r.session, session());
});

test('validateSession rechaza entradas corruptas', () => {
  const cases = {
    'no objeto': null,
    'array': [],
    'id con caracteres raros': session({ id: '1);alert(1)//' }),
    'id vacío': session({ id: '' }),
    'startedAt texto': session({ startedAt: '2026-01-01' }),
    'startedAt fuera de rango': session({ startedAt: 1 }),
    'endedAt anterior': session({ endedAt: T0 - 1 }),
    'name vacío': session({ name: '  ' }),
    'name enorme': session({ name: 'x'.repeat(500) }),
    'exercises no lista': session({ exercises: {} }),
    'serie tipo desconocido': session({ exercises: [{ id: 'e', name: 'E', series: [series({ type: 'super' })] }] }),
    'peso negativo': session({ exercises: [{ id: 'e', name: 'E', series: [series({ weight: -1 })] }] }),
    'peso texto': session({ exercises: [{ id: 'e', name: 'E', series: [series({ weight: '20' })] }] }),
    'reps decimales': session({ exercises: [{ id: 'e', name: 'E', series: [series({ repsDone: 8.5 })] }] }),
    'rpe fuera de rango': session({ exercises: [{ id: 'e', name: 'E', series: [series({ rpe: 11 })] }] }),
    'done no booleano': session({ exercises: [{ id: 'e', name: 'E', series: [series({ done: 'yes' })] }] }),
    'nombre ejercicio HTML como objeto': session({ exercises: [{ id: 'e', name: { html: XSS }, series: [] }] }),
  };
  for (const [label, raw] of Object.entries(cases)) {
    assert.equal(validateSession(raw).ok, false, label);
  }
});

test('validateData: raíz estricta, sesiones inválidas y duplicadas aparte', () => {
  assert.throws(() => validateData(null));
  assert.throws(() => validateData({ schemaVersion: 1, sessions: [] }));
  assert.throws(() => validateData({ schemaVersion: 2, sessions: {} }));
  assert.throws(() => validateData({ schemaVersion: 2, sessions: [], settings: [] }));
  const { data, rejected } = validateData({
    schemaVersion: 2, settings: { theme: 'x' },
    sessions: [session(), session(), { id: 'bad' }, session({ id: 'b2' })],
  });
  assert.equal(data.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(data.sessions.map(s => s.id), ['a1', 'b2']);
  assert.deepEqual(data.settings, {});
  assert.equal(rejected.length, 2);
});

test('lector v1: convierte, reubica reps de superseries y tolera basura', () => {
  const dom = P3.exercises[0];
  const v1 = [
    {
      id: 1763661600000, timestamp: 1763661600000, date: '20/11/2025', session: P3.name,
      exercises: [
        { name: dom.name, series: [{ reps: '8-10 / 10-12', weight: '10', weight2: '35' }] },
        { name: 'Remo barra', series: [{ reps: '8-10', weight: '60,5', weight2: '' }, {}, 7, { reps: '8-10 DROP', weight: 'x' }] },
        { name: 'Ejercicio que ya no existe', series: [{ reps: '5', weight: '1' }] },
        null,
      ],
    },
    { id: '1);window.__pwned=2;//', timestamp: 1763661700000, date: '20/11/2025', session: XSS, exercises: 'nope' },
    { id: 5, date: '3/2/2026', session: 'Sesión 2: Pierna' },
    { id: 'sin-fecha', session: 'x' },
    'basura',
    null,
  ];
  const { sessions, rejected } = fromV1Sessions(v1);
  assert.equal(sessions.length, 3);
  assert.equal(rejected.length, 3);

  const [a, b, c] = sessions;
  assert.equal(a.id, '1763661600000');
  assert.equal(a.planSessionId, P3.id);
  assert.equal(a.startedAt, 1763661600000);
  const s0 = a.exercises[0].series[0];
  assert.equal(a.exercises[0].id, dom.id);
  assert.equal(s0.repsDone, 10, 'dominadas: la v1 las guardaba como kg');
  assert.equal(s0.weight, 35);
  assert.equal(s0.weight2, null);
  assert.equal(a.exercises[1].series[0].weight, 60.5);
  assert.equal(a.exercises[1].series.length, 4);
  assert.equal(a.exercises[1].series[1].type, 'normal');
  assert.equal(a.exercises[1].series[3].type, 'drop');
  assert.equal(a.exercises[1].series[3].weight, null);
  assert.equal(a.exercises[1].series[3].done, false);
  assert.match(a.exercises[2].id, /^v1-ex-/);

  assert.match(b.id, /^v1-\d+-1$/, 'id hostil sustituido');
  assert.equal(b.name, XSS, 'el texto se conserva tal cual, se pinta como texto');
  assert.equal(b.planSessionId, null);
  assert.deepEqual(b.exercises, []);

  assert.equal(c.planSessionId, 'pierna');
  assert.equal(new Date(c.startedAt).getMonth(), 1);
  assert.deepEqual(fromV1Sessions({}), { sessions: [], rejected: [] });
});

test('borrador: crear desde el plan, solo campos declarados y valores validados', () => {
  const d = createDraft(P1.id, T0);
  assert.equal(d.exercises.length, P1.exercises.length);
  assert.equal(d.exercises[1].series[3].type, 'drop');
  assert.equal(d.exercises[0].series[0].target, '8-10');
  assert.equal(createDraft('nope'), null);

  assert.equal(setDraftValue(d, 0, 0, 'weight', '22.5').ok, true);
  assert.equal(setDraftValue(d, 0, 0, 'repsDone', '9').ok, true);
  assert.equal(setDraftValue(d, 0, 0, 'weight2', '5').ok, false, 'campo no declarado');
  assert.equal(setDraftValue(d, 0, 0, '__proto__', '5').ok, false);
  assert.equal(setDraftValue(d, 0, 0, 'weight', '-3').ok, false);
  assert.equal(setDraftValue(d, 99, 0, 'weight', '1').ok, false);
  assert.equal(d.exercises[0].series[0].weight, 22.5);
  assert.equal(d.exercises[0].series[0].done, false, 'escribir no marca como hecha');

  const total = P1.exercises.reduce((n, e) => n + e.series.length, 0);
  assert.deepEqual(draftStats(d), { total, filled: 1, missing: total - 1 });
  assert.equal(setDraftValue(d, 0, 0, 'weight', '').ok, true);
  d.exercises[0].series[0].done = true;
  assert.equal(setDraftValue(d, 0, 0, 'repsDone', '').ok, true);
  assert.equal(d.exercises[0].series[0].done, false, 'sin valores no puede estar hecha');
});

test('borrador: restoreDraft se ajusta al plan y descarta valores inválidos', () => {
  const d = createDraft(P1.id, T0);
  setDraftValue(d, 0, 1, 'weight', '30');
  const raw = JSON.parse(JSON.stringify(d));
  raw.exercises[0].series[0].weight = 'hack';
  raw.exercises[0].series[2].repsDone = -4;
  raw.exercises.push({ id: 'intruso', series: [] });
  raw.exercises[1].series.push(series());
  const back = restoreDraft(raw);
  assert.equal(back.exercises.length, P1.exercises.length, 'ejercicio sin nombre ni plan descartado');
  assert.equal(back.exercises[0].series[0].weight, null);
  assert.equal(back.exercises[0].series[1].weight, 30);
  assert.equal(back.exercises[0].series[2].repsDone, null);
  assert.equal(back.exercises[1].series.length, P1.exercises[1].series.length + 1, 'las series añadidas se conservan');
  assert.equal(back.startedAt, T0);
  assert.equal(restoreDraft(null), null);
  assert.equal(restoreDraft({ planSessionId: '<x>' }), null);
});

test('finalizeDraft produce una sesión v2 válida con endedAt', () => {
  const d = createDraft(P1.id, T0);
  setDraftValue(d, 0, 0, 'weight', '20');
  const r = finalizeDraft(d, T0 + 60_000);
  assert.equal(r.ok, true);
  assert.equal(r.session.id, d.id);
  assert.equal(r.session.name, P1.name);
  assert.equal(r.session.endedAt, T0 + 60_000);
  assert.equal(r.session.exercises[0].name, P1.exercises[0].name);
  assert.equal(validateSession(r.session).ok, true);
  assert.equal(finalizeDraft(null).ok, false);
});

test('previousFor toma la última sesión del mismo tipo; el anterior es texto, no valor', () => {
  const older = session({ id: 'o', startedAt: T0 - 1000 });
  const newer = session({ id: 'n', exercises: [{ id: P1.exercises[0].id, name: 'x', notes: '', series: [series({ weight: 22.5, repsDone: 8 })] }] });
  const other = session({ id: 'z', planSessionId: 'pierna', startedAt: T0 + 5000 });
  const prev = previousFor([older, newer, other], P1.id);
  const s = prev.get(P1.exercises[0].id)[0];
  assert.equal(formatPrevious(s, fieldsFor(P1.exercises[0])), '22.5kg × 8');
  assert.equal(previousFor([], P1.id).size, 0);
  // El borrador nuevo empieza vacío aunque haya historial.
  assert.equal(createDraft(P1.id).exercises[0].series[0].weight, null);
});

test('formatSeriesLine: kg × reps, superseries con etiquetas y genéricos', () => {
  const kgReps = fieldsFor(P1.exercises[0]);
  assert.equal(formatSeriesLine(series({ weight: 22.5, repsDone: 8 }), 0, kgReps), 'Serie 1: 22.5kg × 8 (obj. 8-10)');
  assert.equal(formatSeriesLine(series({ repsDone: null, target: '' }), 1, kgReps), 'Serie 2: 20kg');
  assert.equal(formatSeriesLine(series({ weight: null }), 0, kgReps), 'Serie 1: 8 reps (obj. 8-10)');
  assert.equal(formatSeriesLine(series({ weight: null, repsDone: null, type: 'drop', target: '' }), 3, kgReps), 'Serie 4 [drop]: sin datos');
  assert.equal(formatSeriesLine(series({ rpe: 8, target: '' }), 0, kgReps), 'Serie 1: 20kg × 8 @RPE 8');
  const dom = fieldsFor(findPlanExercise('ss-dominadas-press-cerrado'));
  assert.equal(
    formatSeriesLine(series({ repsDone: 10, weight: 35, target: '' }), 0, dom),
    'Serie 1: Dominadas 10 reps + Press/Fondos 35kg',
  );
  assert.equal(formatSeriesLine(series({ weight2: 5, target: '' }), 0, GENERIC_FIELDS), 'Serie 1: 20kg + 5kg × 8');
});

test('buildSummaryText mantiene la cabecera y usa el nuevo formato', () => {
  const txt = buildSummaryText(session(), '20/11/2026');
  assert.equal(txt, `[GUARDAR SESIÓN]\n📅 20/11/2026 — ${P1.name}\n⏱ 60 min\n\n▸ ${P1.exercises[0].name}\n  Serie 1: 20kg × 8 (obj. 8-10)\n`);
});

test('export JSON: ida y vuelta sin pérdidas', () => {
  const data = { schemaVersion: 2, sessions: [session(), session({ id: 'b', notes: 'ok' })], settings: {} };
  const exported = buildExport(data, T0);
  assert.equal(exported.exportedAt, new Date(T0).toISOString());
  const r = parseImport(JSON.stringify(exported), []);
  assert.equal(r.ok, true);
  assert.equal(r.format, 'v2');
  assert.deepEqual(r.sessions, data.sessions);
  assert.equal(r.fresh.length, 2);
});

test('import: fusión por id sin sobrescribir lo local', () => {
  const local = [session({ id: 'a1', notes: 'local' })];
  const file = JSON.stringify({ schemaVersion: 2, sessions: [session({ id: 'a1', notes: 'remoto' }), session({ id: 'nuevo' })] });
  const r = parseImport(file, local);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.fresh.map(s => s.id), ['nuevo']);
  const merged = mergeSessions(local, r.fresh);
  assert.equal(merged.added, 1);
  assert.equal(merged.sessions.find(s => s.id === 'a1').notes, 'local');
});

test('import con HTML malicioso: se valida, se conserva como texto y no ejecuta nada', () => {
  const evil = session({
    id: 'evil', name: XSS, notes: '<script>globalThis.__pwned=3</script>',
    exercises: [{ id: 'x', name: XSS, notes: XSS, series: [series({ target: '<b onmouseover=alert(1)>' })] }],
  });
  const r = parseImport(JSON.stringify({ schemaVersion: 2, sessions: [evil, session({ id: '"><svg onload=alert(1)>' })] }), []);
  assert.equal(r.ok, true);
  assert.equal(r.sessions.length, 1, 'id con HTML rechazado');
  assert.equal(r.rejected.length, 1);
  assert.equal(r.sessions[0].name, XSS);
  assert.equal(globalThis.__pwned, undefined);
});

test('import: errores de formato', () => {
  assert.equal(parseImport('{no json', []).ok, false);
  assert.equal(parseImport('"texto"', []).ok, false);
  assert.equal(parseImport('{"foo":1}', []).error, 'Formato desconocido');
  assert.match(parseImport('{"schemaVersion":9,"sessions":[]}', []).error, /más nueva/);
  assert.match(parseImport('{"schemaVersion":2,"sessions":{}}', []).error, /Formato inválido/);
  assert.equal(parseImport('x'.repeat(5_000_001), []).ok, false);
  assert.equal(parseImport(null, []).ok, false);
  const v1 = parseImport(JSON.stringify([{ id: 9, timestamp: T0, session: P1.name, exercises: [] }]), []);
  assert.equal(v1.ok, true);
  assert.equal(v1.format, 'v1');
});

test('CSV: cabecera, una fila por serie, escapado y fórmulas neutralizadas', () => {
  const evil = session({
    id: 'e', name: '=HYPERLINK("http://x","clic")', startedAt: T0 + 1,
    exercises: [{ id: 'x', name: 'Press, "banca"\nnuevo', notes: '@SUM(A1)', series: [series(), series({ weight: null })] }],
  });
  const csv = toCSV([evil, session()]);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], CSV_HEADER.join(','));
  assert.ok(lines[1].startsWith('a1,'), 'orden cronológico');
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"",""clic"")"`));
  assert.ok(csv.includes('"Press, ""banca""\nnuevo"'));
  assert.ok(csv.includes("'@SUM(A1)"));
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(22.5), '22.5');
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell(false), 'false');
});

test('toggleSeriesDone: marca, desmarca y copia de la serie de encima o de la sesión anterior', () => {
  const d = createDraft(P1.id, T0);
  const prev = { weight: 20, repsDone: 10 };
  // vacía y sin nada que copiar
  assert.deepEqual(toggleSeriesDone(d, 0, 0, null), { ok: false, error: 'empty' });
  assert.equal(d.exercises[0].series[0].done, false);
  // vacía: copia la sesión anterior
  assert.deepEqual(toggleSeriesDone(d, 0, 0, prev), { ok: true, done: true, copied: true });
  assert.equal(d.exercises[0].series[0].weight, 20);
  // la siguiente vacía copia la de encima, no la anterior
  setDraftValue(d, 0, 0, 'weight', '25');
  assert.deepEqual(toggleSeriesDone(d, 0, 1, prev), { ok: true, done: true, copied: true });
  assert.equal(d.exercises[0].series[1].weight, 25);
  assert.equal(d.exercises[0].series[1].repsDone, 10);
  // con valores propios no copia
  setDraftValue(d, 0, 2, 'weight', '30');
  assert.deepEqual(toggleSeriesDone(d, 0, 2, prev), { ok: true, done: true, copied: false });
  assert.equal(d.exercises[0].series[2].repsDone, null);
  // desmarcar conserva los valores
  assert.deepEqual(toggleSeriesDone(d, 0, 2), { ok: true, done: false, copied: false });
  assert.equal(d.exercises[0].series[2].weight, 30);
  assert.equal(toggleSeriesDone(d, 9, 0).ok, false);
});

test('fillSeries solo rellena campos vacíos y declarados', () => {
  const d = createDraft(P3.id, T0);
  // superserie: campos repsDone + weight; weight2 no se copia
  assert.equal(fillSeries(d, 0, 0, { repsDone: 8, weight: 20, weight2: 5 }), true);
  const s = d.exercises[0].series[0];
  assert.deepEqual([s.repsDone, s.weight, s.weight2], [8, 20, null]);
  assert.equal(fillSeries(d, 0, 0, { repsDone: 9, weight: 99 }), false, 'no sobrescribe');
  assert.equal(fillSeries(d, 0, 0, null), false);
  assert.equal(fillSeries(d, 0, 1, { weight: -4, repsDone: 'x' }), false, 'valores fuera de rango no se copian');
});

test('añadir y quitar series con deshacer, y mínimo una serie', () => {
  const d = createDraft(P1.id, T0);
  const n = d.exercises[0].series.length;
  assert.equal(addSeries(d, 0), true);
  const added = d.exercises[0].series.at(-1);
  assert.equal(d.exercises[0].series.length, n + 1);
  assert.equal(added.weight, null);
  assert.equal(added.done, false);
  assert.equal(added.rest, 90);
  assert.equal(added.target, '8-10');
  const removed = removeLastSeries(d, 0);
  assert.equal(removed.index, n);
  assert.equal(d.exercises[0].series.length, n);
  assert.equal(insertSeries(d, 0, removed.index, removed.series), true);
  assert.equal(d.exercises[0].series.length, n + 1);
  const one = createDraft(P1.id, T0);
  one.exercises[0].series.length = 1;
  assert.equal(removeLastSeries(one, 0), null);
  assert.equal(addSeries(d, 99), false);
  for (let i = 0; i < 60; i++) addSeries(d, 0);
  assert.equal(d.exercises[0].series.length, 50);
});

test('moveExercise reordena y respeta los extremos', () => {
  const d = createDraft(P1.id, T0);
  const [a, b] = d.exercises.map(e => e.id);
  assert.equal(moveExercise(d, 0, 1), 1);
  assert.deepEqual(d.exercises.slice(0, 2).map(e => e.id), [b, a]);
  assert.equal(moveExercise(d, 0, -1), -1);
  assert.equal(moveExercise(d, d.exercises.length - 1, 1), -1);
  assert.equal(moveExercise(d, 0, 2), -1);
  // los valores viajan con el ejercicio
  setDraftValue(d, 1, 0, 'weight', '40');
  moveExercise(d, 1, -1);
  assert.equal(d.exercises[0].series[0].weight, 40);
  assert.equal(setDraftValue(d, 0, 0, 'weight', '41').ok, true, 'la escritura sigue al ejercicio, no al plan');
});

test('substituteExercise: ejercicio del plan, libre, duplicado y nombres inválidos', () => {
  const d = createDraft(P1.id, T0);
  const original = d.exercises[0].name;
  setDraftValue(d, 0, 0, 'weight', '30');
  const r = substituteExercise(d, 0, '  Press Militar mancuernas ');
  assert.equal(r.ok, false, 'ya está en la sesión');
  assert.equal(r.error, 'duplicate');
  const free = substituteExercise(d, 0, 'Press banca máquina');
  assert.deepEqual(free, { ok: true, id: 'x-press-banca-maquina' });
  assert.equal(d.exercises[0].name, 'Press banca máquina');
  assert.equal(d.exercises[0].substituteFor, original);
  assert.equal(d.exercises[0].series.length, P1.exercises[0].series.length);
  assert.equal(d.exercises[0].series[0].weight, null, 'los valores se vacían');
  assert.equal(d.exercises[0].series[0].rest, 90);
  // sustituir de nuevo conserva el origen
  assert.equal(substituteExercise(d, 0, 'Dips').ok, true);
  assert.equal(d.exercises[0].substituteFor, original);
  // por uno del plan en otra sesión
  const withPlan = substituteExercise(d, 0, 'peso muerto');
  assert.deepEqual(withPlan, { ok: true, id: 'peso-muerto' });
  assert.equal(d.exercises[0].name, 'Peso muerto');
  assert.equal(substituteExercise(d, 0, '   ').error, 'name');
  assert.equal(substituteExercise(d, 0, 'x'.repeat(121)).error, 'name');
  assert.equal(substituteExercise(d, 99, 'Dips').error, 'invalid');
  // misma identidad: no hace nada
  assert.equal(substituteExercise(d, 0, 'Peso muerto').same, true);
  // sobrevive a guardar/restaurar y a finalizar
  const back = restoreDraft(JSON.parse(JSON.stringify(d)));
  assert.equal(back.exercises[0].id, 'peso-muerto');
  assert.equal(back.exercises[0].substituteFor, original);
  setDraftValue(back, 0, 0, 'weight', '100');
  const fin = finalizeDraft(back, T0 + 1000);
  assert.equal(fin.ok, true);
  assert.equal(fin.session.exercises[0].name, 'Peso muerto');
});

test('slugId genera ids válidos y estables', () => {
  assert.equal(slugId('Curl en banco Scott'), 'x-curl-en-banco-scott');
  assert.equal(slugId('Sentadilla búlgara'), 'x-sentadilla-bulgara');
  assert.match(slugId('💪💪'), /^x-[A-Za-z0-9-]+$/);
  assert.ok(slugId('a'.repeat(200)).length <= 52);
});

test('notas de sesión y de ejercicio se guardan, recortan y llegan al historial', () => {
  const d = createDraft(P1.id, T0);
  assert.equal(setNote(d, null, 'Dormí mal'), true);
  assert.equal(setNote(d, 0, 'Banco 3'), true);
  assert.equal(setNote(d, 99, 'x'), false);
  setNote(d, 1, 'n'.repeat(3000));
  assert.equal(d.exercises[1].notes.length, 2000);
  setDraftValue(d, 0, 0, 'weight', '20');
  const back = restoreDraft(JSON.parse(JSON.stringify(d)));
  assert.equal(back.notes, 'Dormí mal');
  assert.equal(back.exercises[0].notes, 'Banco 3');
  const fin = finalizeDraft(back, T0 + 1);
  assert.equal(fin.session.notes, 'Dormí mal');
  assert.equal(fin.session.exercises[0].notes, 'Banco 3');
  assert.match(buildSummaryText(fin.session, '20/11/2026'), /📝 Dormí mal[\s\S]*📝 Banco 3/);
});

test('restoreDraft acepta borradores de la fase 2 (sin nombre ni descanso)', () => {
  const old = {
    schemaVersion: 2, id: 'old1', planSessionId: P1.id, startedAt: T0, notes: '',
    exercises: P1.exercises.map(e => ({ id: e.id, notes: '', series: e.series.map(s => ({ type: 'normal', target: s.reps, weight: null, weight2: null, repsDone: null, rpe: null, done: false })) })),
  };
  old.exercises[0].series[0].weight = 22.5;
  const back = restoreDraft(old);
  assert.equal(back.exercises[0].name, P1.exercises[0].name);
  assert.equal(back.exercises[0].series[0].weight, 22.5);
  assert.equal(back.exercises[0].series[0].rest, 90, 'el descanso viene del plan');
  assert.equal(back.exercises[1].series[3].rest, 180);
});

test('restForSeries: descanso de la serie, ajuste por ejercicio y sin descanso', () => {
  const d = createDraft(P1.id, T0);
  assert.equal(restForSeries(d, 0, 0, {}), 90);
  assert.equal(restForSeries(d, 2, 3, {}), null, 'última myo-rep: sin descanso');
  assert.equal(restForSeries(d, 0, 0, { [d.exercises[0].id]: 120 }), 120);
  assert.equal(restForSeries(d, 0, 0, { [d.exercises[0].id]: 0 }), null, '0 desactiva el descanso');
  assert.equal(restForSeries(d, 2, 3, { [d.exercises[2].id]: 45 }), 45, 'el ajuste vale para todas las series');
  assert.equal(restForSeries(d, 0, 0, { ['__proto__']: 5 }), 90);
  assert.equal(restForSeries(d, 99, 0, {}), null);
  assert.equal(defaultRest(d.exercises[1]), 180);
});

test('formatPreviousShort: valores sin unidades para la columna Anterior', () => {
  const f = fieldsFor(P1.exercises[0]);
  assert.equal(formatPreviousShort({ weight: 22.5, repsDone: 8 }, f), '22.5 × 8');
  assert.equal(formatPreviousShort({ weight: 22.5, repsDone: null }, f), '22.5');
  assert.equal(formatPreviousShort({ weight: null, repsDone: null }, f), '');
  assert.equal(formatPreviousShort(undefined, f), '');
});
