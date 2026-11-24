// Imagen resumen de la sesión para compartir. El modelo (qué se escribe) es puro y se prueba en Node;
// el dibujo usa <canvas> y el reparto navigator.share. No sale nada del dispositivo salvo lo que el usuario
// comparte desde el menú del sistema.
import { countedSeries, sessionVolume, fmtKg, formatRecord } from './stats.js';
import { fmtWeightNum, unitLabel } from './units.js';
import { fieldsForExerciseId } from './data.js';

export const CARD_W = 1080;
export const CARD_H = 1350;
const MAX_EXERCISES = 5;
const MAX_RECORDS = 3;

function bestSetLine(ex) {
  const sets = countedSeries(ex);
  if (!sets.length) return `${ex.series.filter(s => s.done).length} series`;
  const top = sets.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && b.repsDone > a.repsDone) ? b : a));
  return `${fmtWeightNum(top.weight)} ${unitLabel()} × ${top.repsDone}`;
}

// → { title, date, stats: [{ label, value }], exercises: [{ name, line }], records: [string], moreExercises }
export function buildShareCard(session, records = [], dateLabel = '') {
  const minutes = session.endedAt ? Math.round((session.endedAt - session.startedAt) / 60000) : null;
  const done = session.exercises.filter(ex => ex.series.some(s => s.done));
  const stats = [];
  if (minutes !== null) stats.push({ label: 'Duración', value: `${minutes} min` });
  const volume = sessionVolume(session);
  if (volume > 0) stats.push({ label: 'Volumen', value: `${fmtKg(volume)} ${unitLabel()}` });
  stats.push({ label: 'Series', value: String(session.exercises.reduce((n, ex) => n + ex.series.filter(s => s.done).length, 0)) });
  const shown = done.slice(0, MAX_EXERCISES);
  return {
    title: session.name,
    date: dateLabel,
    stats,
    exercises: shown.map(ex => {
      const fields = fieldsForExerciseId(ex.id);
      const paired = fields.length === 3 || (fields.length === 2 && fields[0].key === 'weight' && fields[1].key === 'repsDone');
      return { name: ex.name, line: paired ? bestSetLine(ex) : `${ex.series.filter(s => s.done).length} series` };
    }),
    moreExercises: Math.max(0, done.length - shown.length),
    records: records.slice(0, MAX_RECORDS).map(formatRecord),
  };
}

// ==================== DIBUJO ====================
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

export function drawShareCard(ctx, model) {
  const pad = 72;
  const inner = CARD_W - pad * 2;
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const grad = ctx.createLinearGradient(0, 0, CARD_W, 0);
  grad.addColorStop(0, '#6366f1');
  grad.addColorStop(1, '#a855f7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, 16);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#a5b4fc';
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText('GYM TRACKER', pad, 120);

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 64px ${FONT}`;
  ctx.fillText(fit(ctx, model.title, inner), pad, 220);
  ctx.fillStyle = '#9ca3af';
  ctx.font = `400 38px ${FONT}`;
  ctx.fillText(model.date, pad, 280);

  // Cifras
  const boxW = (inner - 24 * (model.stats.length - 1)) / Math.max(1, model.stats.length);
  model.stats.forEach((st, i) => {
    const x = pad + i * (boxW + 24);
    ctx.fillStyle = '#111827';
    ctx.fillRect(x, 330, boxW, 170);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 52px ${FONT}`;
    ctx.fillText(fit(ctx, st.value, boxW - 32), x + 24, 422);
    ctx.fillStyle = '#9ca3af';
    ctx.font = `400 30px ${FONT}`;
    ctx.fillText(st.label, x + 24, 474);
  });

  // Ejercicios
  let y = 590;
  ctx.fillStyle = '#a5b4fc';
  ctx.font = `600 32px ${FONT}`;
  ctx.fillText('EJERCICIOS', pad, y);
  y += 30;
  model.exercises.forEach(ex => {
    y += 76;
    ctx.fillStyle = '#ffffff';
    ctx.font = `500 40px ${FONT}`;
    ctx.textAlign = 'right';
    const lineW = ctx.measureText(ex.line).width;
    ctx.fillText(ex.line, CARD_W - pad, y);
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, ex.name, inner - lineW - 32), pad, y);
  });
  if (model.moreExercises > 0) {
    y += 70;
    ctx.fillStyle = '#9ca3af';
    ctx.font = `400 34px ${FONT}`;
    ctx.fillText(`y ${model.moreExercises} más`, pad, y);
  }

  // Récords
  if (model.records.length) {
    y = Math.max(y + 100, 960);
    ctx.fillStyle = '#fbbf24';
    ctx.font = `600 32px ${FONT}`;
    ctx.fillText(model.records.length === 1 ? 'RÉCORD PERSONAL' : 'RÉCORDS PERSONALES', pad, y);
    ctx.fillStyle = '#ffffff';
    ctx.font = `400 34px ${FONT}`;
    model.records.forEach(r => {
      y += 56;
      ctx.fillText(fit(ctx, r, inner), pad, y);
    });
  }

  ctx.fillStyle = '#4b5563';
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText('Registrado en Gym Tracker', pad, CARD_H - 64);
}

export function renderShareCard(model, doc = document) {
  const canvas = doc.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  drawShareCard(canvas.getContext('2d'), model);
  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob sin resultado'))), 'image/png');
  });
}
