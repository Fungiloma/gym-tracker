// Progresión y volumen por músculo (funciones puras, sin DOM). Las reglas son fijas, simples y se
// explican en pantalla; son una referencia orientativa para organizar el entreno, no asesoramiento.
import { findPlanExercise, musclesOf, MUSCLES } from './plan.js';
import { countedSeries, epley1RM, weekStart, addWeeks, weekStreaks, seriesVolume, round1 } from './stats.js';

// ==================== SOBRECARGA PROGRESIVA ====================
// Regla: si en la última sesión del ejercicio se hicieron todas las series del plan y en todas se llegó
// al tope del rango de repeticiones, se sugiere subir la carga un escalón (2,5 kg o 5 lb) sobre la carga más
// alta de esa sesión. Si no, se muestra qué falta para llegar. Solo para ejercicios "tradicionales" con un
// mismo rango de reps en todas las series (no drop sets, myo-reps, superseries ni circuitos).
export function parseRepRange(target) {
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(String(target).trim());
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  return min >= 1 && max > min ? { min, max } : null;
}

// Rango común de reps del ejercicio del plan, o null si la regla no aplica.
export function overloadRange(planEx) {
  if (!planEx || planEx.type !== 'traditional' || !Array.isArray(planEx.series) || !planEx.series.length) return null;
  const ranges = planEx.series.map(s => parseRepRange(s.reps));
  if (ranges.some(r => !r)) return null;
  const { min, max } = ranges[0];
  return ranges.every(r => r.min === min && r.max === max) ? { min, max } : null;
}

// → null (no aplica o sin historial) | { status: 'increase' | 'hold', range, planned, done, weight, next, reps, date, sessionId }
//   weight/next en kg; reps = repeticiones de las series contadas de la última sesión.
export function suggestOverload(sessions, exerciseId, stepKg = 2.5) {
  const planEx = findPlanExercise(exerciseId);
  const range = overloadRange(planEx);
  if (!range) return null;
  const ordered = [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  for (const s of ordered) {
    const ex = s.exercises.find(e => e.id === exerciseId);
    const sets = ex ? countedSeries(ex) : [];
    if (!sets.length) continue;
    const weight = Math.max(...sets.map(x => x.weight));
    const planned = planEx.series.length;
    const reps = sets.map(x => x.repsDone);
    const reached = sets.length >= planned && sets.every(x => x.repsDone >= range.max);
    return {
      status: reached ? 'increase' : 'hold',
      range, planned, done: sets.length, weight,
      next: reached ? Math.round((weight + stepKg) * 10000) / 10000 : weight,
      reps, date: s.startedAt, sessionId: s.id,
    };
  }
  return null;
}

// ==================== AVISOS DE DESCARGA ====================
// Dos avisos, solo informativos:
//  - N semanas seguidas con al menos una sesión (por defecto 6).
//  - Caída de rendimiento: en un ejercicio con al menos 4 registros, el 1RM estimado de los dos últimos queda
//    por debajo del 95 % del mejor de los registros anteriores (hasta 4 anteriores).
export const DELOAD_WEEKS = 6;
export const DROP_RATIO = 0.95;

export function performanceDrops(sessions) {
  const byEx = new Map();
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const ex of s.exercises) {
      const sets = countedSeries(ex);
      if (!sets.length) continue;
      const best = Math.max(...sets.map(x => epley1RM(x.weight, x.repsDone) ?? 0));
      if (best <= 0) continue;
      const cur = byEx.get(ex.id) || { name: ex.name, values: [] };
      cur.name = ex.name;
      cur.values.push(best);
      byEx.set(ex.id, cur);
    }
  }
  const out = [];
  for (const [id, { name, values }] of byEx) {
    if (values.length < 4) continue;
    const last2 = values.slice(-2);
    const before = Math.max(...values.slice(-6, -2));
    if (last2.every(v => v < before * DROP_RATIO)) out.push({ id, name, before: round1(before), last: round1(last2[1]) });
  }
  return out;
}

// → [{ kind: 'weeks' | 'drop', text }]
export function deloadNotices(sessions, now = Date.now(), weeks = DELOAD_WEEKS) {
  const out = [];
  const streak = weekStreaks(sessions, now, 1).current;
  if (streak >= weeks) {
    out.push({ kind: 'weeks', text: `Llevas ${streak} semanas seguidas entrenando. Algunos programas intercalan una semana más ligera; decide tú si te encaja.` });
  }
  const drops = performanceDrops(sessions);
  if (drops.length) {
    out.push({
      kind: 'drop',
      text: `Tu 1RM estimado ha bajado más de un 5 % en las dos últimas sesiones de: ${drops.map(d => d.name).join(', ')}. Puede ser cansancio, sueño o una mala racha.`,
    });
  }
  return out;
}

// ==================== VOLUMEN POR MÚSCULO ====================
// Series por semana y músculo: una serie hecha (no calentamiento, con algún valor) cuenta una vez para cada
// músculo del ejercicio según el mapa del plan. Los ejercicios sin mapa (sustituidos) se cuentan aparte.
export const MIN_WEEKLY_SETS = 6;

function countsAsSet(s) {
  return s.done && s.type !== 'warmup';
}

// weekTs: lunes de la semana (weekStart). → { rows: [{ id, label, sets, volume }], unassigned, sessions }
export function muscleVolume(sessions, weekTs) {
  const end = addWeeks(weekTs, 1);
  const rows = new Map(MUSCLES.map(m => [m.id, { id: m.id, label: m.label, sets: 0, volume: 0 }]));
  let unassigned = 0;
  let count = 0;
  for (const s of sessions) {
    if (s.startedAt < weekTs || s.startedAt >= end) continue;
    count += 1;
    for (const ex of s.exercises) {
      const sets = ex.series.filter(countsAsSet).length;
      if (!sets) continue;
      const muscles = musclesOf(ex.id);
      if (!muscles.length) {
        unassigned += sets;
        continue;
      }
      const counted = countedSeries(ex);
      const volume = muscles.length === 1 ? counted.reduce((n, x) => n + seriesVolume(x), 0) : 0;
      muscles.forEach((id, i) => {
        const row = rows.get(id);
        if (!row) return;
        row.sets += sets;
        if (i === 0) row.volume += volume;
      });
    }
  }
  return { rows: [...rows.values()], unassigned, sessions: count };
}

// Músculos con menos de `min` series en una semana ya terminada con sesiones. En la semana en curso o sin
// sesiones no se avisa (todo saldría "infraentrenado" por no haber acabado la semana o por no haber entrenado).
export function undertrained(volume, weekTs, now = Date.now(), min = MIN_WEEKLY_SETS) {
  if (volume.sessions === 0 || weekTs >= weekStart(now)) return [];
  return volume.rows.filter(r => r.sets < min);
}

// ==================== CALCULADORA DE DISCOS ====================
export const DEFAULT_PLATES = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };
export const DEFAULT_BAR = { kg: 20, lb: 45 };
const MICRO = 10000; // trabajo en diezmilésimas de kg para no acumular error de coma flotante
const TOLERANCE = 20; // 2 g: el redondeo a 4 decimales de lb→kg no debe quitar un disco que sí cabe

// total, bar y plates en kg (plates = discos disponibles por lado, con repetición ilimitada).
// → { ok: false, error } | { ok: true, perSide: [{ plate, count }], achieved, remainder }
//   remainder = kg por lado que no se pueden cubrir con los discos dados (0 si el total sale exacto).
export function plateBreakdown(total, bar, plates) {
  if (![total, bar].every(n => typeof n === 'number' && Number.isFinite(n))) return { ok: false, error: 'invalid' };
  if (!Array.isArray(plates) || !plates.length) return { ok: false, error: 'no-plates' };
  const clean = [...new Set(plates.filter(p => typeof p === 'number' && Number.isFinite(p) && p > 0))].sort((a, b) => b - a);
  if (!clean.length) return { ok: false, error: 'no-plates' };
  if (total < bar) return { ok: false, error: 'below-bar' };
  let left = Math.round(((total - bar) / 2) * MICRO);
  const perSide = [];
  for (const plate of clean) {
    const unit = Math.round(plate * MICRO);
    const count = Math.floor((left + TOLERANCE) / unit);
    if (count > 0) {
      perSide.push({ plate, count });
      left -= count * unit;
    }
  }
  const remainder = Math.max(0, left) / MICRO;
  const side = perSide.reduce((n, p) => n + Math.round(p.plate * MICRO) * p.count, 0) / MICRO;
  return { ok: true, perSide, achieved: Math.round((bar + side * 2) * MICRO) / MICRO, remainder };
}
