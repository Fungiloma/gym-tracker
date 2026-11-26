// Lógica del descanso y avisos. Un solo descanso activo, basado en timestamps:
// timer = { duration, endTs, paused, remaining, label }
// Funciones puras salvo los avisos (sonido, vibración), que tocan APIs del navegador.

import { MAX_REST } from './data.js';

export const RING_CIRCUMFERENCE = 43.98; // 2 * PI * 7

export function formatRest(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + 'm' + (s > 0 ? s + 's' : '');
  }
  return seconds + 's';
}

export function formatRemaining(remaining) {
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return mins > 0 ? (mins + ':' + (secs < 10 ? '0' : '') + secs) : (remaining + 's');
}

// Duración del entreno: m:ss por debajo de una hora, h:mm:ss a partir de ella.
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

export function ringOffset(remaining, duration) {
  return RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, remaining / duration)));
}

export function remainingAt(timer, now) {
  return Math.max(0, Math.round((timer.endTs - now) / 1000));
}

export function createTimer(duration, now, label = '') {
  return { duration, endTs: now + duration * 1000, paused: false, remaining: duration, label: String(label).slice(0, 80) };
}

// Alterna pausa/reanudación sobre el objeto timer (lo modifica y lo devuelve).
export function toggleTimer(timer, now) {
  if (timer.paused) {
    timer.endTs = now + timer.remaining * 1000;
    timer.paused = false;
  } else {
    timer.remaining = remainingAt(timer, now);
    timer.paused = true;
  }
  return timer;
}

// Suma o resta segundos al tiempo restante (modifica el timer). Devuelve lo que queda;
// si es 0, el descanso se da por terminado. La duración crece si lo restante la supera.
export function adjustTimer(timer, deltaSec, now) {
  const current = timer.paused ? timer.remaining : remainingAt(timer, now);
  const next = Math.min(MAX_REST, Math.max(0, current + deltaSec));
  timer.remaining = next;
  if (!timer.paused) timer.endTs = now + next * 1000;
  timer.duration = Math.min(MAX_REST, Math.max(timer.duration, next));
  return next;
}

// Devuelve un timer válido o null si lo guardado no tiene la forma esperada.
export function sanitizeTimer(t) {
  if (!t || typeof t !== 'object') return null;
  const { duration, endTs, remaining } = t;
  if (![duration, endTs, remaining].every(Number.isFinite) || duration <= 0 || duration > MAX_REST) return null;
  if (remaining < 0 || remaining > MAX_REST) return null;
  return { duration, endTs, paused: t.paused === true, remaining, label: typeof t.label === 'string' ? t.label.slice(0, 80) : '' };
}

// ==================== AVISOS ====================
// Un único AudioContext para toda la app. Android exige un gesto del usuario para
// reproducir sonido: unlockAudio() se llama desde los toques que arrancan el descanso.
let audioCtx = null;

function getAudioCtx() {
  if (audioCtx) return audioCtx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

export function unlockAudio() {
  try {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  } catch {}
}

export function beep() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    [0, 0.18, 0.36].forEach(t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.4, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.25);
    });
  } catch {}
}

export function vibrate(pattern = [200, 100, 200]) {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {}
}
