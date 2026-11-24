// Análisis del historial (funciones puras, sin DOM). Fechas en hora local; las semanas empiezan en lunes.
//
// Una serie cuenta para el análisis si está hecha, no es calentamiento y tiene kg > 0 y reps >= 1.
// Los ejercicios cuyos campos no son el par kg + reps (superseries con campos propios) no se analizan:
// sus kg y reps pertenecen a movimientos distintos y un 1RM o un volumen no tendrían sentido.
import { fieldsForExerciseId, isDateKey } from './data.js';

export const MAX_REPS_1RM = 30;
const DAY = 86_400_000;

// ==================== SERIES ====================
export function pairsWeightReps(exerciseId) {
  const f = fieldsForExerciseId(exerciseId);
  return f.length === 3 || (f.length === 2 && f[0].key === 'weight' && f[1].key === 'repsDone');
}

export function countedSeries(ex) {
  if (!pairsWeightReps(ex.id)) return [];
  return ex.series.filter(s => s.done && s.type !== 'warmup'
    && typeof s.weight === 'number' && s.weight > 0
    && typeof s.repsDone === 'number' && s.repsDone >= 1);
}

// Epley: kg × (1 + reps/30). Con 1 rep el 1RM es el propio peso. Sin datos fiables → null.
export function epley1RM(weight, reps) {
  if (typeof weight !== 'number' || typeof reps !== 'number') return null;
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps < 1 || reps > MAX_REPS_1RM) return null;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export function seriesVolume(s) {
  return s.weight * s.repsDone;
}

export function exerciseVolume(ex) {
  return countedSeries(ex).reduce((sum, s) => sum + seriesVolume(s), 0);
}

export function sessionVolume(session) {
  return session.exercises.reduce((sum, ex) => sum + exerciseVolume(ex), 0);
}

export function sessionSetCount(session) {
  return session.exercises.reduce((n, ex) => n + countedSeries(ex).length, 0);
}

export function round1(n) {
  return Math.round(n * 10) / 10;
}

// ==================== FECHAS ====================
const pad = n => String(n).padStart(2, '0');

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now = Date.now()) {
  return dayKey(now);
}

// Lunes 00:00 local de la semana de ts.
export function weekStart(ts) {
  const d = new Date(ts);
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

export function addWeeks(weekTs, n) {
  const d = new Date(weekTs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n).getTime();
}

// 'YYYY-MM-DD' → ts local a las 00:00 (null si no es una fecha válida).
export function keyToTs(key) {
  if (!isDateKey(key)) return null;
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

// ==================== POR EJERCICIO ====================
// Ejercicios con historial: [{ id, name, sessions, last }] por último uso descendente.
export function listExercises(sessions) {
  const map = new Map();
  for (const s of sessions) {
    for (const ex of s.exercises) {
      const cur = map.get(ex.id) || { id: ex.id, name: ex.name, sessions: 0, last: 0 };
      cur.sessions += 1;
      if (s.startedAt >= cur.last) {
        cur.last = s.startedAt;
        cur.name = ex.name;
      }
      map.set(ex.id, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.last - a.last);
}

// Puntos cronológicos de un ejercicio: [{ ts, sessionId, topWeight, best1RM, volume, sets }]. Sin series válidas, no hay punto.
export function exerciseProgress(sessions, exerciseId) {
  const points = [];
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const ex of s.exercises) {
      if (ex.id !== exerciseId) continue;
      const sets = countedSeries(ex);
      if (!sets.length) continue;
      points.push({
        ts: s.startedAt,
        sessionId: s.id,
        topWeight: Math.max(...sets.map(x => x.weight)),
        best1RM: Math.max(...sets.map(x => epley1RM(x.weight, x.repsDone) ?? 0)),
        volume: sets.reduce((sum, x) => sum + seriesVolume(x), 0),
        sets: sets.length,
      });
    }
  }
  return points;
}

// ==================== RÉCORDS ====================
export const RECORD_LABEL = { weight: 'peso', reps: 'repeticiones', oneRM: '1RM estimado', volume: 'volumen' };

function priorBest(previous, exerciseId) {
  const best = { weight: 0, oneRM: 0, volume: 0, sets: [], any: false };
  for (const s of previous) {
    for (const ex of s.exercises) {
      if (ex.id !== exerciseId) continue;
      const sets = countedSeries(ex);
      if (!sets.length) continue;
      best.any = true;
      for (const x of sets) {
        best.weight = Math.max(best.weight, x.weight);
        best.oneRM = Math.max(best.oneRM, epley1RM(x.weight, x.repsDone) ?? 0);
        best.sets.push(x);
      }
      best.volume = Math.max(best.volume, sets.reduce((sum, x) => sum + seriesVolume(x), 0));
    }
  }
  return best;
}

// Récords personales de `session` frente a `previous` (sesiones anteriores). Un ejercicio sin historial
// previo no genera récords: su primera vez solo fija la base. Un récord por tipo y ejercicio.
// Repeticiones: más reps que cualquier serie previa con el mismo peso o más.
// → [{ exerciseId, name, kind, value, previous }]
export function detectRecords(previous, session) {
  const before = previous.filter(p => p.id !== session.id && p.startedAt < session.startedAt);
  const out = [];
  for (const ex of session.exercises) {
    const sets = countedSeries(ex);
    if (!sets.length) continue;
    const best = priorBest(before, ex.id);
    if (!best.any) continue;
    const add = (kind, value, prev) => out.push({ exerciseId: ex.id, name: ex.name, kind, value: round1(value), previous: round1(prev) });

    const top = Math.max(...sets.map(x => x.weight));
    if (top > best.weight) add('weight', top, best.weight);

    const oneRM = Math.max(...sets.map(x => epley1RM(x.weight, x.repsDone) ?? 0));
    if (oneRM > best.oneRM) add('oneRM', oneRM, best.oneRM);

    let repsPr = null;
    for (const x of sets) {
      const beaten = !best.sets.some(p => p.weight >= x.weight && p.repsDone >= x.repsDone);
      if (beaten && (!repsPr || x.repsDone > repsPr.repsDone)) repsPr = x;
    }
    if (repsPr) {
      const prevReps = Math.max(0, ...best.sets.filter(p => p.weight >= repsPr.weight).map(p => p.repsDone));
      add('reps', repsPr.repsDone, prevReps);
    }

    const vol = sets.reduce((sum, x) => sum + seriesVolume(x), 0);
    if (vol > best.volume) add('volume', vol, best.volume);
  }
  return out;
}

export function formatRecord(r) {
  const unit = r.kind === 'reps' ? ' reps' : ' kg';
  const prev = r.previous > 0 ? ` (antes ${fmt(r.previous)})` : '';
  return `${r.name}: ${RECORD_LABEL[r.kind]} ${fmt(r.value)}${unit}${prev}`;
}

// Mejores marcas históricas de un ejercicio (para la ficha del ejercicio).
export function exerciseBests(sessions, exerciseId) {
  const best = priorBest(sessions, exerciseId);
  if (!best.any) return null;
  const maxReps = Math.max(...best.sets.map(x => x.repsDone));
  return { weight: best.weight, oneRM: round1(best.oneRM), volume: best.volume, maxReps };
}

// ==================== SEMANAS Y RACHAS ====================
// Últimas `weeks` semanas, la actual la última: [{ start, volume, sessions, sets }].
export function weeklyStats(sessions, weeks = 8, now = Date.now()) {
  const current = weekStart(now);
  const rows = [];
  for (let i = weeks - 1; i >= 0; i--) rows.push({ start: addWeeks(current, -i), volume: 0, sessions: 0, sets: 0 });
  const index = new Map(rows.map((r, i) => [r.start, i]));
  for (const s of sessions) {
    const i = index.get(weekStart(s.startedAt));
    if (i === undefined) continue;
    rows[i].volume += sessionVolume(s);
    rows[i].sets += sessionSetCount(s);
    rows[i].sessions += 1;
  }
  return rows;
}

// Racha de semanas consecutivas con al menos `min` sesiones. La semana en curso no rompe la racha
// mientras no termine: si aún no llega a `min`, la racha cuenta desde la semana anterior.
// → { current, best }
export function weekStreaks(sessions, now = Date.now(), min = 1) {
  const counts = new Map();
  for (const s of sessions) {
    const w = weekStart(s.startedAt);
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const ok = w => (counts.get(w) || 0) >= min;
  const currentWeek = weekStart(now);

  let cur = 0;
  let w = ok(currentWeek) ? currentWeek : addWeeks(currentWeek, -1);
  while (ok(w)) {
    cur += 1;
    w = addWeeks(w, -1);
  }

  const weeks = [...counts.keys()].filter(ok).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const wk of weeks) {
    run = prev !== null && addWeeks(prev, 1) === wk ? run + 1 : 1;
    best = Math.max(best, run);
    prev = wk;
  }
  return { current: cur, best };
}

// ==================== CALENDARIO ====================
// Mes en rejilla de semanas (lunes primero): celdas null fuera del mes, { day, key, count } dentro.
export function calendarMonth(sessions, year, month) {
  const counts = new Map();
  for (const s of sessions) counts.set(dayKey(s.startedAt), (counts.get(dayKey(s.startedAt)) || 0) + 1);
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) {
    const key = `${year}-${pad(month + 1)}-${pad(d)}`;
    cells.push({ day: d, key, count: counts.get(key) || 0 });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// ==================== RESUMEN SEMANAL ====================
function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(round1(n)).replace('.', ',');
}

export function fmtKg(n) {
  return fmt(Math.round(n));
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function shortDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// Texto copiable para el chat entrenador de la semana que empieza en `weekTs`.
export function buildWeeklySummary(sessions, body, weekTs) {
  const end = addWeeks(weekTs, 1);
  const inWeek = sessions.filter(s => s.startedAt >= weekTs && s.startedAt < end).sort((a, b) => a.startedAt - b.startedAt);
  const prevWeek = sessions.filter(s => s.startedAt >= addWeeks(weekTs, -1) && s.startedAt < weekTs);
  const lastDay = end - DAY;
  const lines = [`[RESUMEN SEMANAL] ${shortDate(weekTs)} a ${shortDate(lastDay)} ${new Date(lastDay).getFullYear()}`];

  if (!inWeek.length) {
    lines.push('Sin sesiones esta semana.');
  } else {
    const vol = inWeek.reduce((n, s) => n + sessionVolume(s), 0);
    const prevVol = prevWeek.reduce((n, s) => n + sessionVolume(s), 0);
    lines.push(`Sesiones: ${inWeek.length}`);
    lines.push(`Series válidas: ${inWeek.reduce((n, s) => n + sessionSetCount(s), 0)}`);
    let volLine = `Volumen: ${fmtKg(vol)} kg`;
    if (prevVol > 0) {
      const pct = Math.round(((vol - prevVol) / prevVol) * 100);
      volLine += ` (${pct >= 0 ? '+' : ''}${pct}% vs semana anterior)`;
    } else if (prevWeek.length === 0) {
      volLine += ' (sin semana anterior)';
    }
    lines.push(volLine);
    lines.push('');
    for (const s of inWeek) {
      lines.push(`▸ ${shortDate(s.startedAt)} ${s.name}: ${fmtKg(sessionVolume(s))} kg, ${sessionSetCount(s)} series`);
    }
    const records = [];
    for (const s of inWeek) records.push(...detectRecords(sessions, s));
    if (records.length) {
      lines.push('');
      lines.push('Récords:');
      records.forEach(r => lines.push(`  🏅 ${formatRecord(r)}`));
    }
  }

  const weekBody = body.filter(b => b.weight !== null && keyToTs(b.date) !== null && keyToTs(b.date) >= weekTs && keyToTs(b.date) < end);
  if (weekBody.length) {
    const last = weekBody[weekBody.length - 1];
    lines.push('');
    lines.push(`Peso corporal: ${fmt(last.weight)} kg (${last.date})`);
  }
  const streak = weekStreaks(sessions, end - 1);
  lines.push('');
  lines.push(`Racha semanal: ${streak.current} (mejor ${streak.best})`);
  return lines.join('\n');
}

// ==================== PESO CORPORAL ====================
// Puntos [{ ts, value }] de una medida, cronológicos, para la gráfica.
export function bodySeries(body, key) {
  return body
    .filter(b => typeof b[key] === 'number')
    .map(b => ({ ts: keyToTs(b.date), value: b[key] }))
    .filter(p => p.ts !== null)
    .sort((a, b) => a.ts - b.ts);
}
