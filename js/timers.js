// Lógica de los temporizadores de descanso, basada en timestamps.
// state.timers[key] = { duration, endTs, paused, remaining }
// Funciones puras salvo beep(); el DOM lo gestiona views.js.

export const RING_CIRCUMFERENCE = 43.98; // 2 * PI * 7

export function isTimerKey(key) {
  return /^\d+-\d+$/.test(String(key));
}

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

export function ringOffset(remaining, duration) {
  return RING_CIRCUMFERENCE * (1 - remaining / duration);
}

export function remainingAt(timer, now) {
  return Math.max(0, Math.round((timer.endTs - now) / 1000));
}

export function createTimer(duration, now) {
  return { duration, endTs: now + duration * 1000, paused: false, remaining: duration };
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

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
