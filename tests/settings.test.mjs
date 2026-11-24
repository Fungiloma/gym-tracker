import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSettings, getSettings, applySetting, validateData, buildExport, parseImport, SETTINGS_DEFAULTS, restForSeries,
  formatSeriesLine, formatPreviousShort, createDraft, buildSummaryText,
} from '../js/data.js';
import { loadUi } from '../js/storage.js';
import {
  setUnit, getUnit, lbToKg, kgToLb, kgToDisplay, inputToKg, fmtWeight, fmtWeightNum, progressionStepKg,
} from '../js/units.js';
import { fmtKg, formatRecord } from '../js/stats.js';

afterEach(() => setUnit('kg'));

test('validateSettings: conserva lo válido y descarta lo desconocido o fuera de rango', () => {
  assert.deepEqual(validateSettings(undefined), {});
  assert.deepEqual(validateSettings([]), {});
  assert.deepEqual(validateSettings({
    units: 'lb', theme: 'light', sound: false, vibration: true, progression: false, defaultRest: 90, bar: 15, plates: [5, 25, 10, 5],
    hack: 1, __proto__: { x: 1 },
  }), { units: 'lb', theme: 'light', sound: false, vibration: true, progression: false, defaultRest: 90, bar: 15, plates: [25, 10, 5] });
  const bad = {
    units: 'stone', theme: 'x', sound: 'yes', vibration: 1, progression: null, defaultRest: 90.5, bar: 0, plates: [],
  };
  assert.deepEqual(validateSettings(bad), {});
  assert.deepEqual(validateSettings({ defaultRest: -1 }), {});
  assert.deepEqual(validateSettings({ defaultRest: 3601 }), {});
  assert.deepEqual(validateSettings({ bar: 101 }), {});
  assert.deepEqual(validateSettings({ plates: [0.1] }), {});
  assert.deepEqual(validateSettings({ plates: [1, 'a'] }), {});
  assert.deepEqual(validateSettings({ plates: Array.from({ length: 13 }, (_, i) => i + 1) }), {});
});

test('getSettings: valores por defecto con lo guardado encima', () => {
  assert.deepEqual(getSettings({ settings: {} }), SETTINGS_DEFAULTS);
  assert.deepEqual(getSettings(null), SETTINGS_DEFAULTS);
  assert.equal(getSettings({ settings: { units: 'lb', theme: 'bogus' } }).units, 'lb');
  assert.equal(getSettings({ settings: { units: 'lb', theme: 'bogus' } }).theme, 'auto');
});

test('applySetting: valida cada cambio, no muta y null borra la clave', () => {
  const base = { theme: 'dark' };
  const r = applySetting(base, 'units', 'lb');
  assert.deepEqual(r, { ok: true, settings: { theme: 'dark', units: 'lb' } });
  assert.deepEqual(base, { theme: 'dark' });
  assert.deepEqual(applySetting(base, 'units', 'stone'), { ok: false });
  assert.deepEqual(applySetting(base, 'nope', true), { ok: false });
  assert.deepEqual(applySetting({ theme: 'dark', bar: 15 }, 'bar', null), { ok: true, settings: { theme: 'dark' } });
  assert.deepEqual(applySetting({}, 'defaultRest', 75), { ok: true, settings: { defaultRest: 75 } });
});

test('validateData y import/export: los ajustes viajan validados', () => {
  const raw = { schemaVersion: 2, sessions: [], settings: { theme: 'dark', units: 'lb', junk: 1, sound: 'no' } };
  assert.deepEqual(validateData(raw).data.settings, { theme: 'dark', units: 'lb' });
  const exp = buildExport({ sessions: [], body: [], settings: { theme: 'dark' } });
  assert.deepEqual(exp.settings, { theme: 'dark' });
  const p = parseImport(JSON.stringify(exp));
  assert.equal(p.ok, true);
});

test('restForSeries: el descanso por defecto solo se aplica a ejercicios sin descanso propio', () => {
  const draft = createDraft('pecho-hombro');
  // Ejercicio del plan: conserva el suyo, incluso en la serie con descanso 0.
  const myo = draft.exercises.findIndex(e => e.id === 'aperturas-polea-alta');
  assert.equal(restForSeries(draft, myo, 3, {}, 120), null);
  assert.equal(restForSeries(draft, myo, 0, {}, 120), 15);
  // Ejercicio sin descanso en ninguna serie (sustituido): usa el de los ajustes.
  const sub = { id: 'otro', name: 'Otro', notes: '', substituteFor: null, series: [{ rest: 0, done: false }, { rest: 0, done: false }] };
  const d2 = { exercises: [sub] };
  assert.equal(restForSeries(d2, 0, 0, {}, 75), 75);
  assert.equal(restForSeries(d2, 0, 0, {}, 0), null);
  assert.equal(restForSeries(d2, 0, 0, { otro: 30 }, 75), 30, 'el ajuste por ejercicio manda');
  assert.equal(restForSeries(d2, 0, 0, { otro: 0 }, 75), null, '0 por ejercicio = sin descanso');
});

test('loadUi: guided e índice se sanean', () => {
  const st = v => ({ getItem: () => JSON.stringify(v), setItem() {} });
  const defaults = { timer: null, restByExercise: {}, expandedSessions: [], notifAsked: false, guided: false, guidedIndex: 0 };
  assert.deepEqual([loadUi(defaults, st({ guided: true, guidedIndex: 3 })).guided, loadUi(defaults, st({ guided: true, guidedIndex: 3 })).guidedIndex], [true, 3]);
  const bad = loadUi(defaults, st({ guided: 'sí', guidedIndex: -2 }));
  assert.equal(bad.guided, false);
  assert.equal(bad.guidedIndex, 0);
});

// ---------- unidades ----------
test('conversión kg/lb: se guarda en kg y 100 lb vuelve a verse como 100 lb', () => {
  assert.equal(lbToKg(100), 45.3592);
  assert.equal(lbToKg(0), 0);
  setUnit('lb');
  assert.equal(kgToDisplay(lbToKg(100)), 100);
  assert.equal(kgToDisplay(lbToKg(135.5)), 135.5);
  assert.equal(kgToDisplay(22.5), 49.6);
  assert.equal(Math.round(kgToLb(1) * 1000) / 1000, 2.205);
  setUnit('kg');
  assert.equal(kgToDisplay(22.5), 22.5);
  assert.equal(getUnit(), 'kg');
});

test('inputToKg: en lb convierte, acepta coma decimal y deja pasar lo inválido', () => {
  assert.equal(inputToKg('22,5'), '22,5', 'en kg no toca nada');
  setUnit('lb');
  assert.equal(inputToKg('100'), 45.3592);
  assert.equal(inputToKg('100,5'), lbToKg(100.5));
  assert.equal(inputToKg(''), '');
  assert.equal(inputToKg('abc'), 'abc');
  assert.equal(inputToKg('-5'), '-5');
  assert.equal(inputToKg(null), null);
});

test('unidades: setUnit ignora valores raros y el formato sigue la unidad', () => {
  setUnit('stone');
  assert.equal(getUnit(), 'kg');
  setUnit('lb');
  assert.equal(fmtWeight(45.3592), '100 lb');
  assert.equal(fmtWeightNum(45.3592), '100');
  assert.equal(progressionStepKg(), lbToKg(5));
  assert.equal(progressionStepKg('kg'), 2.5);
});

test('formatos de serie, resumen, récords y volumen siguen la unidad; las reps no se convierten', () => {
  const fields = [{ key: 'weight', unit: 'kg', label: 'kg' }, { key: 'repsDone', unit: 'reps', label: 'reps' }];
  const s = { type: 'normal', target: '', weight: 45.3592, weight2: null, repsDone: 8, rpe: null, done: true };
  assert.equal(formatSeriesLine(s, 0, fields), 'Serie 1: 45.3592kg × 8');
  assert.equal(formatPreviousShort(s, fields), '45.3592 × 8');
  setUnit('lb');
  assert.equal(formatSeriesLine(s, 0, fields), 'Serie 1: 100lb × 8');
  assert.equal(formatPreviousShort(s, fields), '100 × 8');
  assert.equal(fmtKg(4535.92), '10000');
  assert.equal(formatRecord({ name: 'Press', kind: 'weight', value: 45.4, previous: 0 }), 'Press: peso 100,1 lb');
  assert.equal(formatRecord({ name: 'Press', kind: 'reps', value: 12, previous: 10 }), 'Press: repeticiones 12 reps (antes 10)');
  const summary = buildSummaryText({
    id: 'a', name: 'S', startedAt: Date.UTC(2026, 0, 5), endedAt: null, notes: '',
    exercises: [{ id: 'press-banca-mancuernas', name: 'Press', notes: '', series: [s] }],
  }, '5/1/2026');
  assert.match(summary, /100lb × 8/);
});
