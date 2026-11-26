// Bug 12: la cabecera del resumen semanal en la semana del cambio de hora de primavera (Europa/Madrid).
process.env.TZ = 'Europe/Madrid';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklySummary, weekStart } from '../js/stats.js';

test('bug 12: la semana del cambio de hora acaba el domingo 30 mar y no el sábado 29', () => {
  assert.equal(new Date(2025, 2, 30, 12).getTimezoneOffset(), -120, 'TZ=Europe/Madrid activa');
  const weekTs = weekStart(new Date(2025, 2, 26, 12).getTime());
  assert.equal(new Date(weekTs).getDate(), 24);
  const head = buildWeeklySummary([], [], weekTs).split('\n')[0];
  assert.equal(head, '[RESUMEN SEMANAL] 24 mar a 30 mar 2025');
});

test('bug 12: una semana normal y la del cambio a horario de invierno también acaban en domingo', () => {
  const normal = buildWeeklySummary([], [], new Date(2025, 5, 2).getTime()).split('\n')[0];
  assert.equal(normal, '[RESUMEN SEMANAL] 2 jun a 8 jun 2025');
  const autumn = buildWeeklySummary([], [], new Date(2025, 9, 20).getTime()).split('\n')[0];
  assert.equal(autumn, '[RESUMEN SEMANAL] 20 oct a 26 oct 2025');
});
