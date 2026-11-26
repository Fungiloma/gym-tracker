// Fase 6: plan editable. Validación, import/export, archivado y compatibilidad con el historial por ids.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPlan, setActivePlan, planSessions, getPlanSession, findPlanExercise, findPlanSessionByName,
  libraryExercises, routineExercise, musclesOf,
} from '../js/plan.js';
import {
  validatePlan, parsePlanImport, buildPlanExport, mergeImportedPlan, usedIds, resetToDefault, PLAN_LIMITS,
  createRoutine, duplicateRoutine, moveRoutine, updateRoutine, removeRoutine, restoreRoutine,
  addRoutineExercise, removeRoutineExercise, moveRoutineExercise, setRoutineNote, addRoutineSeries,
  removeRoutineSeries, setRoutineSeries, createExercise, updateExercise, removeExercise, restoreExercise,
} from '../js/routines.js';
import { createDraft, restoreDraft, finalizeDraft, substituteExercise, fieldsForExerciseId, GENERIC_FIELDS, draftName } from '../js/data.js';
import { loadPlan, savePlan, KEYS } from '../js/storage.js';

afterEach(() => setActivePlan(defaultPlan()));

const NONE = { exercises: new Set(), routines: new Set() };
const mini = () => ({
  planVersion: 1,
  exercises: [
    { id: 'sentadilla', name: 'Sentadilla', type: 'traditional', muscles: ['cuadriceps'] },
    { id: 'remo', name: 'Remo', type: 'traditional', muscles: ['espalda'] },
  ],
  routines: [
    { id: 'a', name: 'A', emoji: '⚡', duration: 50, exercises: [{ exerciseId: 'sentadilla', note: '', series: [{ reps: '5', rest: 180 }] }] },
  ],
});
const ok = r => {
  assert.ok(r.ok, r.error);
  return r.plan;
};
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
};
const file = obj => JSON.stringify({ app: 'gym-tracker', kind: 'plan', ...obj });

// ==================== PLAN POR DEFECTO ====================
test('el plan actual es el plan por defecto, válido y con los ids de siempre', () => {
  const p = defaultPlan();
  assert.deepEqual(ok(validatePlan(p)), p);
  assert.deepEqual(p.routines.map(r => r.id), ['pecho-hombro', 'pierna', 'espalda-biceps', 'pecho-triceps-core']);
  assert.equal(p.exercises.length, 20);
  assert.equal(new Set(p.exercises.map(e => e.id)).size, 20);
  assert.equal(planSessions().length, 4);
  assert.equal(getPlanSession('pierna').exercises[0].id, 'peso-muerto');
  assert.equal(findPlanExercise('prensa').series.at(-1).drop, true);
  assert.equal(findPlanExercise('ss-extension-curl-femoral').fields[1].label, 'Curl femoral');
});

test('defaultPlan devuelve copias independientes', () => {
  const a = defaultPlan();
  a.routines[0].name = 'cambiado';
  assert.equal(defaultPlan().routines[0].name, 'Sesión 1: Pecho + Hombro');
});

// ==================== VALIDACIÓN ====================
test('validatePlan rechaza ids duplicados, referencias rotas y ejercicios repetidos en una rutina', () => {
  const dupEx = mini();
  dupEx.exercises.push({ ...dupEx.exercises[0], name: 'Otra' });
  assert.match(validatePlan(dupEx).error, /id duplicado/);
  const dupR = mini();
  dupR.routines.push({ ...dupR.routines[0] });
  assert.match(validatePlan(dupR).error, /rutina 2: id duplicado/);
  const broken = mini();
  broken.routines[0].exercises[0].exerciseId = 'no-existe';
  assert.match(validatePlan(broken).error, /no está en la biblioteca/);
  const twice = mini();
  twice.routines[0].exercises.push({ ...twice.routines[0].exercises[0] });
  assert.match(validatePlan(twice).error, /repetido/);
});

test('validatePlan rechaza ids, tipos, músculos, campos y rangos inválidos', () => {
  const cases = [
    [p => { p.exercises[0].id = 'con espacio'; }, /id inválido/],
    [p => { p.exercises[0].id = '__proto__x'.repeat(10); }, /id inválido/],
    [p => { p.exercises[0].type = 'crossfit'; }, /tipo desconocido/],
    [p => { p.exercises[0].muscles = ['oreja']; }, /músculo desconocido/],
    [p => { p.exercises[0].name = '   '; }, /vacío/],
    [p => { p.exercises[0].name = 'x'.repeat(121); }, /demasiado largo/],
    [p => { p.exercises[0].name = 'a\u0000b'; }, /caracteres no permitidos/],
    [p => { p.exercises[0].name = 'a‮b'; }, /caracteres no permitidos/],
    [p => { p.exercises[0].fields = [{ key: 'weight', unit: 'reps', label: 'x' }]; }, /unidad incorrecta/],
    [p => { p.exercises[0].fields = [{ key: 'rpe', unit: 'kg', label: 'x' }]; }, /clave desconocida/],
    [p => { p.exercises[0].fields = [{ key: 'weight', unit: 'kg', label: 'a' }, { key: 'weight', unit: 'kg', label: 'b' }]; }, /repetida/],
    [p => { p.exercises[0].archived = 'sí'; }, /archived/],
    [p => { p.routines[0].duration = 601; }, /duración/],
    [p => { p.routines[0].exercises[0].series[0].rest = 3601; }, /descanso/],
    [p => { p.routines[0].exercises[0].series[0].rest = 1.5; }, /descanso/],
    [p => { p.routines[0].exercises[0].series[0].reps = 'x'.repeat(61); }, /repeticiones/],
    [p => { p.routines[0].exercises[0].series = []; }, /series inválidas/],
    [p => { p.routines[0].exercises[0].series = Array(51).fill({ reps: '5', rest: 0 }); }, /series inválidas/],
    [p => { p.routines[0].exercises[0].note = 'x'.repeat(301); }, /nota/],
    [p => { p.routines[0].emoji = '🔥'.repeat(9); }, /emoji/],
    [p => { p.exercises[0].archived = true; }, /archivado/],
    [p => { p.planVersion = 2; }, /versión/],
    [p => { p.exercises = Array.from({ length: 301 }, (_, i) => ({ id: `e${i}`, name: `E${i}`, type: 'traditional' })); }, /biblioteca/],
  ];
  for (const [mutate, re] of cases) {
    const p = mini();
    mutate(p);
    const r = validatePlan(p);
    assert.equal(r.ok, false, `debía fallar: ${re}`);
    assert.match(r.error, re);
  }
  assert.equal(validatePlan(null).ok, false);
  assert.equal(validatePlan([]).ok, false);
});

test('validatePlan guarda HTML como texto literal y descarta claves desconocidas', () => {
  const p = mini();
  p.exercises[0].name = '<img src=x onerror=alert(1)>';
  p.exercises[0].onclick = 'alert(1)';
  p.routines[0].__proto__polluted = true;
  p.extra = { x: 1 };
  const out = ok(validatePlan(p));
  assert.equal(out.exercises[0].name, '<img src=x onerror=alert(1)>');
  assert.equal(out.exercises[0].onclick, undefined);
  assert.equal(out.extra, undefined);
  assert.equal(Object.hasOwn(out.routines[0], '__proto__polluted'), false);
  // __proto__ en JSON no contamina prototipos.
  const r = validatePlan(JSON.parse('{"planVersion":1,"exercises":[],"routines":[],"__proto__":{"evil":1}}'));
  assert.ok(r.ok);
  assert.equal({}.evil, undefined);
});

test('una rutina archivada puede usar ejercicios archivados; una activa no', () => {
  const p = mini();
  p.exercises[0].archived = true;
  p.routines[0].archived = true;
  assert.ok(validatePlan(p).ok);
});

// ==================== IMPORT / EXPORT ====================
test('export → import devuelve el mismo plan', () => {
  const p = defaultPlan();
  const exported = buildPlanExport(p, Date.UTC(2026, 0, 1));
  assert.equal(exported.kind, 'plan');
  assert.equal(exported.exportedAt, '2026-01-01T00:00:00.000Z');
  const r = parsePlanImport(JSON.stringify(exported), p, NONE);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.plan, p);
  assert.deepEqual(r.kept, { routines: 0, exercises: 0 });
});

test('parsePlanImport rechaza tamaño, JSON roto, otro formato, versión nueva y planes inválidos', () => {
  const cur = defaultPlan();
  assert.match(parsePlanImport('x'.repeat(PLAN_LIMITS.importBytes + 1), cur, NONE).error, /demasiado grande/);
  assert.match(parsePlanImport('{roto', cur, NONE).error, /JSON/);
  assert.match(parsePlanImport('[]', cur, NONE).error, /desconocido/);
  assert.match(parsePlanImport(JSON.stringify({ schemaVersion: 2, sessions: [] }), cur, NONE).error, /copia del historial/);
  assert.match(parsePlanImport(file({ planVersion: 9, exercises: [], routines: [] }), cur, NONE).error, /más nueva/);
  const broken = mini();
  broken.routines[0].exercises[0].exerciseId = 'fantasma';
  assert.match(parsePlanImport(file(broken), cur, NONE).error, /^Plan inválido: .*no está en la biblioteca/);
  assert.equal(parsePlanImport(null, cur, NONE).ok, false);
});

test('importar conserva archivado lo que usa el historial y lo que no, desaparece', () => {
  const cur = defaultPlan();
  const used = { exercises: new Set(['peso-muerto', 'x-libre']), routines: new Set(['pierna']) };
  const r = parsePlanImport(file(mini()), cur, used);
  assert.ok(r.ok, r.error);
  const ids = r.plan.routines.map(x => [x.id, !!x.archived]);
  assert.deepEqual(ids, [['a', false], ['pierna', true]]);
  // Ejercicios de la rutina archivada (aunque no tengan historial) y los usados: archivados.
  const pierna = defaultPlan().routines[1].exercises.map(e => e.exerciseId);
  for (const id of pierna) assert.equal(r.plan.exercises.find(e => e.id === id).archived, true, id);
  assert.equal(r.plan.exercises.find(e => e.id === 'press-banca-mancuernas'), undefined);
  assert.equal(r.plan.exercises.find(e => e.id === 'x-libre'), undefined, 'un id que no estaba en el plan no se inventa');
  assert.deepEqual(r.kept, { routines: 1, exercises: pierna.length });
  assert.deepEqual(r.incoming, { routines: 1, exercises: 2, names: ['A'] });
});

test('si el fichero trae un id usado, manda el fichero (no se duplica)', () => {
  const inc = mini();
  inc.exercises[0] = { id: 'peso-muerto', name: 'Peso muerto rumano', type: 'traditional', muscles: ['femoral'] };
  inc.routines[0].exercises[0].exerciseId = 'peso-muerto';
  const m = mergeImportedPlan(defaultPlan(), inc, { exercises: new Set(['peso-muerto']), routines: new Set() });
  assert.ok(m.ok);
  const pm = m.plan.exercises.filter(e => e.id === 'peso-muerto');
  assert.equal(pm.length, 1);
  assert.equal(pm[0].name, 'Peso muerto rumano');
  assert.equal(pm[0].archived, undefined);
});

test('resetToDefault vuelve al plan original conservando lo usado', () => {
  const custom = ok(parsePlanImport(file(mini()), defaultPlan(), NONE));
  const back = ok(resetToDefault(custom, { exercises: new Set(['sentadilla']), routines: new Set(['a']) }));
  assert.deepEqual(back.routines.filter(r => !r.archived).map(r => r.id), defaultPlan().routines.map(r => r.id));
  assert.ok(back.routines.some(r => r.id === 'a' && r.archived));
  assert.ok(back.exercises.some(e => e.id === 'sentadilla' && e.archived));
});

test('usedIds reúne ejercicios y rutinas del historial y del borrador', () => {
  const draft = createDraft('pierna', Date.UTC(2026, 0, 1));
  const u = usedIds([{ planSessionId: 'a', exercises: [{ id: 'x' }] }, { planSessionId: null, exercises: [] }], draft);
  assert.deepEqual([...u.routines].sort(), ['a', 'pierna']);
  assert.ok(u.exercises.has('x') && u.exercises.has('peso-muerto'));
});

// ==================== ARCHIVADO ====================
test('un ejercicio con historial se archiva; sin historial se borra; en una rutina activa no se toca', () => {
  const p = mini();
  const inRoutine = removeExercise(p, 'sentadilla', NONE);
  assert.equal(inRoutine.ok, false);
  assert.match(inRoutine.error, /Está en A/);
  const del = removeExercise(p, 'remo', NONE);
  assert.equal(del.action, 'deleted');
  assert.equal(del.plan.exercises.some(e => e.id === 'remo'), false);
  const arch = removeExercise(p, 'remo', { exercises: new Set(['remo']), routines: new Set() });
  assert.equal(arch.action, 'archived');
  assert.equal(arch.plan.exercises.find(e => e.id === 'remo').archived, true);
  assert.equal(ok(restoreExercise(arch.plan, 'remo')).exercises.find(e => e.id === 'remo').archived, undefined);
  assert.equal(p.exercises.length, 2, 'la entrada no se modifica');
});

test('un ejercicio de una rutina archivada se archiva aunque no tenga historial (la referencia sigue válida)', () => {
  const p = mini();
  p.routines[0].archived = true;
  const r = removeExercise(p, 'sentadilla', NONE);
  assert.equal(r.action, 'archived');
});

test('una rutina con historial se archiva; sin historial se borra; con sesión en curso no se toca', () => {
  const p = mini();
  assert.match(removeRoutine(p, 'a', NONE, 'a').error, /sesión en curso/);
  const del = removeRoutine(p, 'a', NONE);
  assert.equal(del.action, 'deleted');
  assert.equal(del.plan.routines.length, 0);
  const arch = removeRoutine(p, 'a', { exercises: new Set(), routines: new Set(['a']) });
  assert.equal(arch.action, 'archived');
  assert.equal(arch.plan.routines[0].archived, true);
});

test('restaurar una rutina restaura sus ejercicios archivados', () => {
  const p = mini();
  p.routines[0].archived = true;
  p.exercises[0].archived = true;
  const r = ok(restoreRoutine(p, 'a'));
  assert.equal(r.routines[0].archived, undefined);
  assert.equal(r.exercises[0].archived, undefined);
});

test('el historial de una rutina y un ejercicio archivados se sigue resolviendo por id', () => {
  const used = { exercises: new Set(['peso-muerto']), routines: new Set(['pierna']) };
  const p = ok(parsePlanImport(file(mini()), defaultPlan(), used));
  setActivePlan(p);
  assert.deepEqual(planSessions().map(r => r.id), ['a']);
  assert.equal(getPlanSession('pierna').archived, true);
  assert.equal(findPlanExercise('peso-muerto').name, 'Peso muerto');
  assert.deepEqual(musclesOf('peso-muerto'), ['femoral']);
  assert.equal(fieldsForExerciseId('ss-extension-curl-femoral')[0].label, 'Extensión');
  assert.equal(libraryExercises().some(e => e.id === 'peso-muerto'), false);
  assert.equal(libraryExercises({ archived: true }).some(e => e.id === 'peso-muerto'), true);
  // El lector v1 sigue encontrando las sesiones por su nombre original.
  assert.equal(findPlanSessionByName('Sesión 2: Pierna').id, 'pierna');
});

// ==================== EDITOR ====================
test('crear, renombrar, duplicar y reordenar rutinas', () => {
  let p = mini();
  const c = createRoutine(p, '  Pierna B  ', { routines: new Set(['r-pierna-b']) });
  assert.equal(c.id, 'r-pierna-b-2', 'no reutiliza un id que aparece en el historial');
  p = c.plan;
  assert.equal(p.routines[1].name, 'Pierna B');
  assert.equal(createRoutine(p, '   ').ok, false);
  p = ok(updateRoutine(p, 'a', { name: 'A1', emoji: '🔥', duration: '40' }));
  assert.deepEqual([p.routines[0].name, p.routines[0].emoji, p.routines[0].duration], ['A1', '🔥', 40]);
  assert.equal(updateRoutine(p, 'a', { duration: 'abc' }).ok, false);
  assert.equal(updateRoutine(p, 'a', { name: '' }).ok, false);
  const d = duplicateRoutine(p, 'a');
  assert.equal(d.id, 'r-a1-copia');
  assert.deepEqual(d.plan.routines.map(r => r.id), ['a', 'r-a1-copia', 'r-pierna-b-2']);
  assert.deepEqual(d.plan.routines[1].exercises, p.routines[0].exercises);
  p = ok(moveRoutine(d.plan, 'r-pierna-b-2', -1));
  assert.deepEqual(p.routines.map(r => r.id), ['a', 'r-pierna-b-2', 'r-a1-copia']);
  assert.equal(moveRoutine(p, 'a', -1).ok, false);
});

test('reordenar salta las rutinas archivadas y las deja al final', () => {
  let p = mini();
  p = createRoutine(p, 'B').plan;
  p.routines.splice(1, 0, { id: 'old', name: 'Old', emoji: '', duration: 0, archived: true, exercises: [] });
  p = ok(validatePlan(p));
  p = ok(moveRoutine(p, 'r-b', -1));
  assert.deepEqual(p.routines.map(r => r.id), ['r-b', 'a', 'old']);
});

test('editar ejercicios, series, rangos, descansos y drop de una rutina', () => {
  let p = mini();
  assert.equal(addRoutineExercise(p, 'a', 'sentadilla').ok, false, 'repetido');
  assert.equal(addRoutineExercise(p, 'a', 'fantasma').ok, false);
  p = ok(addRoutineExercise(p, 'a', 'remo'));
  assert.deepEqual(p.routines[0].exercises[1].series, [{ reps: '8-12', rest: 90 }, { reps: '8-12', rest: 90 }, { reps: '8-12', rest: 90 }]);
  p = ok(moveRoutineExercise(p, 'a', 1, -1));
  assert.equal(p.routines[0].exercises[0].exerciseId, 'remo');
  p = ok(setRoutineSeries(p, 'a', 0, 0, 'reps', ' 6-8 '));
  p = ok(setRoutineSeries(p, 'a', 0, 0, 'rest', '120'));
  p = ok(setRoutineSeries(p, 'a', 0, 2, 'drop', true));
  assert.deepEqual(p.routines[0].exercises[0].series[0], { reps: '6-8', rest: 120 });
  assert.equal(p.routines[0].exercises[0].series[2].drop, true);
  p = ok(setRoutineSeries(p, 'a', 0, 2, 'drop', false));
  assert.equal(p.routines[0].exercises[0].series[2].drop, undefined);
  for (const bad of ['-5', '1.5', '3601', 'abc']) assert.equal(setRoutineSeries(p, 'a', 0, 0, 'rest', bad).ok, false, bad);
  assert.equal(setRoutineSeries(p, 'a', 0, 9, 'reps', '5').ok, false);
  p = ok(addRoutineSeries(p, 'a', 0));
  assert.deepEqual(p.routines[0].exercises[0].series.at(-1), { reps: '8-12', rest: 90 });
  p = ok(removeRoutineSeries(p, 'a', 0, 0));
  assert.equal(p.routines[0].exercises[0].series.length, 3);
  assert.equal(removeRoutineSeries(ok(removeRoutineSeries(ok(removeRoutineSeries(p, 'a', 0, 0)), 'a', 0, 0)), 'a', 0, 0).ok, false, 'mínimo una serie');
  p = ok(setRoutineNote(p, 'a', 0, '  Pausa  '));
  assert.equal(p.routines[0].exercises[0].note, 'Pausa');
  p = ok(removeRoutineExercise(p, 'a', 0));
  assert.deepEqual(p.routines[0].exercises.map(e => e.exerciseId), ['sentadilla']);
});

test('crear y editar ejercicios de la biblioteca: id estable desde el nombre, sin nombres repetidos', () => {
  let p = mini();
  const c = createExercise(p, { name: 'Hip Thrust', type: 'traditional', muscles: ['femoral'] });
  assert.equal(c.id, 'x-hip-thrust', 'mismo id que un ejercicio libre sustituido con ese nombre');
  p = c.plan;
  assert.equal(createExercise(p, { name: 'hip thrust' }).ok, false);
  assert.equal(createExercise(p, { name: '' }).ok, false);
  assert.equal(createExercise(p, { name: 'X', type: 'raro' }).ok, false);
  assert.equal(createExercise(p, { name: 'X', muscles: ['oreja'] }).ok, false);
  p = ok(updateExercise(p, 'x-hip-thrust', { name: 'Hip thrust barra', type: 'dropset', muscles: ['femoral', 'core'] }));
  const e = p.exercises.find(x => x.id === 'x-hip-thrust');
  assert.deepEqual([e.name, e.type, e.muscles], ['Hip thrust barra', 'dropset', ['femoral', 'core']]);
  assert.equal(updateExercise(p, 'x-hip-thrust', { name: 'Remo' }).ok, false);
  // Mismo slug que uno existente con otro nombre: id con sufijo.
  assert.equal(createExercise(p, { name: 'Hip-thrust' }).id, 'x-hip-thrust-2');
});

// ==================== BORRADOR E HISTORIAL ====================
test('una rutina creada en el editor se entrena y se guarda con sus ids', () => {
  let p = defaultPlan();
  const c = createRoutine(p, 'Full body');
  p = ok(addRoutineExercise(c.plan, c.id, 'peso-muerto'));
  p = ok(setRoutineSeries(p, c.id, 0, 0, 'reps', '5'));
  setActivePlan(p);
  const draft = createDraft(c.id, Date.UTC(2026, 0, 1));
  assert.deepEqual(draft.exercises.map(e => e.id), ['peso-muerto']);
  assert.equal(draft.exercises[0].series[0].target, '5');
  assert.equal(draft.exercises[0].series[0].rest, 90);
  const s = finalizeDraft(draft, Date.UTC(2026, 0, 1, 1));
  assert.ok(s.ok);
  assert.equal(s.session.planSessionId, 'r-full-body');
  assert.equal(s.session.name, 'Full body');
});

test('una rutina sin ejercicios no se puede empezar', () => {
  const c = createRoutine(defaultPlan(), 'Vacía');
  setActivePlan(c.plan);
  assert.equal(createDraft(c.id), null);
});

test('el borrador guardado sobrevive a editar o vaciar su rutina', () => {
  const draft = createDraft('pierna', Date.UTC(2026, 0, 1));
  draft.exercises[0].series[0].weight = 100;
  const saved = JSON.parse(JSON.stringify(draft));
  let p = defaultPlan();
  for (let i = 0; i < 5; i++) p = ok(removeRoutineExercise(p, 'pierna', 0));
  setActivePlan(p);
  const back = restoreDraft(saved);
  assert.equal(back.exercises.length, 5);
  assert.equal(back.exercises[0].series[0].weight, 100);
});

test('borrador de una rutina que ya no está en el plan (plan dañado): se conserva y se puede terminar', () => {
  const c = createRoutine(defaultPlan(), 'Mi rutina');
  ok(c);
  const withEx = ok(addRoutineExercise(c.plan, c.id, 'press-banca-mancuernas'));
  setActivePlan(withEx);
  const draft = createDraft(c.id, Date.UTC(2026, 0, 1, 18));
  assert.equal(draft.name, 'Mi rutina');
  draft.exercises[0].series[0].weight = 70;
  draft.exercises[0].series[0].repsDone = 8;
  const saved = JSON.parse(JSON.stringify(draft));

  // El plan guardado se pierde y vuelve el original: la rutina ya no existe.
  setActivePlan(defaultPlan());
  const back = restoreDraft(saved);
  assert.ok(back, 'antes devolvía null y el borrador se perdía');
  assert.equal(back.id, draft.id);
  assert.equal(back.planSessionId, c.id);
  assert.equal(back.name, 'Mi rutina');
  assert.equal(back.startedAt, draft.startedAt);
  assert.equal(back.exercises[0].series[0].weight, 70);
  assert.equal(back.exercises[0].series.length, 3);
  assert.equal(draftName(back), 'Mi rutina');

  const fin = finalizeDraft(back, Date.UTC(2026, 0, 1, 19));
  assert.equal(fin.ok, true);
  assert.equal(fin.session.name, 'Mi rutina');
  assert.equal(fin.session.planSessionId, c.id, 'el historial queda enlazado si la rutina vuelve');
  assert.equal(fin.session.exercises[0].series[0].weight, 70);

  // Borradores anteriores a este cambio no guardaban el nombre.
  delete saved.name;
  assert.equal(draftName(restoreDraft(saved)), 'Sesión recuperada');
  // Sin ejercicios reconstruibles no hay nada que conservar.
  assert.equal(restoreDraft({ ...saved, exercises: [] }), null);
  assert.equal(restoreDraft({ planSessionId: 'nope' }), null);
  assert.equal(finalizeDraft({ planSessionId: '<x>', exercises: [] }).ok, false);
});

test('sustituir usa la biblioteca activa e incluye archivados (enlaza historial)', () => {
  const p = ok(createExercise(defaultPlan(), { name: 'Hack squat', muscles: ['cuadriceps'] }));
  const arch = ok(removeExercise(p, 'x-hack-squat', { exercises: new Set(['x-hack-squat']), routines: new Set() }));
  setActivePlan(arch);
  const draft = createDraft('pierna');
  const r = substituteExercise(draft, 1, 'hack SQUAT');
  assert.deepEqual(r, { ok: true, id: 'x-hack-squat' });
  assert.equal(draft.exercises[1].name, 'Hack squat');
  assert.equal(musclesOf('x-hack-squat')[0], 'cuadriceps');
});

test('routineExercise prefiere las series y la nota de la rutina indicada', () => {
  let p = defaultPlan();
  const c = createRoutine(p, 'Otra');
  p = ok(addRoutineExercise(c.plan, c.id, 'prensa'));
  p = ok(setRoutineNote(p, c.id, 0, 'Nota propia'));
  setActivePlan(p);
  assert.equal(routineExercise(c.id, 'prensa').note, 'Nota propia');
  assert.equal(routineExercise('pierna', 'prensa').note, defaultPlan().routines[1].exercises[1].note);
  assert.equal(findPlanExercise('prensa').series.length, 4, 'la general sale de la primera rutina activa');
});

test('un ejercicio que ya no está en la biblioteca usa campos genéricos', () => {
  setActivePlan(ok(validatePlan(mini())));
  assert.deepEqual(fieldsForExerciseId('peso-muerto'), GENERIC_FIELDS);
});

// ==================== ALMACENAMIENTO ====================
test('loadPlan: sin clave usa el plan por defecto; guardado y leído es igual', () => {
  const st = memStorage();
  assert.equal(loadPlan(st).source, 'default');
  assert.equal(st.m.has(KEYS.plan), false);
  const p = ok(validatePlan(mini()));
  assert.ok(savePlan(p, st).ok);
  const back = loadPlan(st);
  assert.equal(back.source, 'stored');
  assert.deepEqual(back.plan, p);
});

test('loadPlan: un plan dañado se copia a gymtracker.plan.backup y se usa el de por defecto', () => {
  for (const raw of ['{roto', '{"planVersion":1,"exercises":[],"routines":[{"id":"a"}]}', '"x"']) {
    const st = memStorage({ [KEYS.plan]: raw });
    const r = loadPlan(st);
    assert.equal(r.source, 'corrupt');
    assert.equal(st.m.get(KEYS.planBackup), raw);
    assert.deepEqual(r.plan, defaultPlan());
  }
});
