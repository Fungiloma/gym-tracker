// Punto de entrada: estado, navegación, temporizadores y delegación de eventos.
import { PLAN, SESSION_KEYS, buildSessionData, restFor } from './plan.js';
import * as storage from './storage.js';
import { isTimerKey, createTimer, toggleTimer as toggleTimerState, remainingAt, beep } from './timers.js';
import {
  renderHome, renderSession, renderHistory, buildSummaryText,
  buildTimer, buildTimerButton, findTimerEl, updateTimerEl, setTimerPausedIcon,
} from './views.js';

// ==================== STATE ====================
const DEFAULT_STATE = {
  activeSession: null,
  sessionData: {},
  timers: {},
  expandedSessions: [],
};

let state = { ...DEFAULT_STATE };
let sessions = [];

const $ = id => document.getElementById(id);
const saveState = () => storage.saveState(state);
const saveSessions = () => storage.saveSessions(sessions);

// ==================== NAVIGATION ====================
function goScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = $(`screen-${name}`);
  if (!target) return;
  target.classList.add('active');
  if (name === 'home') renderHome($('sessions-list'));
  else if (name === 'history') renderHistory($('history-container'), sessions, state.expandedSessions);
}

// ==================== SESSION ====================
function startSession(idx) {
  const sessionName = SESSION_KEYS[idx];
  if (!sessionName) return;
  state.activeSession = sessionName;
  state.sessionData = buildSessionData(sessionName, sessions);
  state.timers = {};
  saveState();
  showSession();
  goScreen('session');
}

function showSession() {
  const sessionName = state.activeSession;
  const exercises = PLAN[sessionName] || [];
  $('session-header-title').textContent = sessionName;
  $('session-header-count').textContent = `${exercises.length} ejercicios`;
  renderSession($('exercises-container'), sessionName, state.sessionData, state.timers);
  if (Object.keys(state.timers).length > 0) ensureTimerInterval();
}

function completeSession() {
  const sessionName = state.activeSession;
  const exercises = PLAN[sessionName] || [];
  const exercisesData = exercises.map(ex => ({
    name: ex.name,
    series: state.sessionData[ex.name] || [],
  }));

  const now = Date.now();
  sessions.push({
    id: now,
    timestamp: now,
    date: new Date().toLocaleDateString('es-ES'),
    session: sessionName,
    exercises: exercisesData,
  });
  saveSessions();

  state.activeSession = null;
  state.sessionData = {};
  state.timers = {};
  saveState();

  $('summary-session-name').textContent = sessionName;
  $('summary-text').textContent = buildSummaryText(sessionName, exercisesData, new Date().toLocaleDateString('es-ES'));
  goScreen('summary');
}

// ==================== TIMERS ====================
let timerInterval = null;

function container() {
  return $('exercises-container');
}

function startTimer(key) {
  const duration = restFor(state.activeSession, key);
  if (!duration) return;
  state.timers[key] = createTimer(duration, Date.now());
  saveState();
  const el = findTimerEl(container(), key);
  if (el) el.replaceWith(buildTimer(key, duration, state.timers[key].remaining, false));
  ensureTimerInterval();
}

function resetTimerEl(key, duration) {
  const el = findTimerEl(container(), key);
  if (el) el.replaceWith(buildTimerButton(key, duration));
}

function clearTimerState(key) {
  delete state.timers[key];
  saveState();
}

function clearTimer(key) {
  const t = state.timers[key];
  const duration = t ? t.duration : (restFor(state.activeSession, key) || 60);
  clearTimerState(key);
  resetTimerEl(key, duration);
}

function toggleTimer(key) {
  const t = state.timers[key];
  if (!t) return;
  toggleTimerState(t, Date.now());
  if (!t.paused) ensureTimerInterval();
  saveState();
  const el = findTimerEl(container(), key);
  if (el) setTimerPausedIcon(el, t.paused);
}

function ensureTimerInterval() {
  if (timerInterval) return;
  timerInterval = setInterval(tickTimers, 250);
}

function tickTimers() {
  const now = Date.now();
  let hasActive = false;

  Object.keys(state.timers).forEach(key => {
    const t = state.timers[key];
    if (!t || t.paused) return;
    const remaining = remainingAt(t, now);
    t.remaining = remaining;

    const el = findTimerEl(container(), key);
    if (el) {
      updateTimerEl(el, remaining, t.duration);
      hasActive = true;
    }
    if (remaining <= 0) {
      beep();
      clearTimerState(key);
      resetTimerEl(key, t.duration);
    }
  });

  saveState();

  if (!hasActive && Object.keys(state.timers).length === 0) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  Object.keys(state.timers).forEach(key => {
    const t = state.timers[key];
    if (t && !t.paused) {
      t.remaining = remainingAt(t, now);
      if (t.remaining <= 0) {
        beep();
        clearTimerState(key);
      }
    }
  });
  ensureTimerInterval();
});

// ==================== SUMMARY ====================
function flashCopied(btn) {
  const original = btn.textContent;
  btn.textContent = '✅ ¡Copiado!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 2000);
}

function copySummary(btn) {
  const text = $('summary-text').textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => flashCopied(btn));
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.className = 'clipboard-fallback';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  flashCopied(btn);
}

// ==================== HISTORY ====================
function findSession(id) {
  return sessions.find(s => String(s.id) === id);
}

function deleteSession(id) {
  if (!confirm('¿Borrar esta sesión del historial?')) return;
  sessions = sessions.filter(s => String(s.id) !== id);
  saveSessions();
  state.expandedSessions = state.expandedSessions.filter(x => String(x) !== id);
  saveState();
  renderHistory($('history-container'), sessions, state.expandedSessions);
}

function toggleExpandSession(id) {
  const session = findSession(id);
  if (!session) return;
  const idx = state.expandedSessions.findIndex(x => String(x) === id);
  if (idx >= 0) state.expandedSessions.splice(idx, 1);
  else state.expandedSessions.push(session.id);
  saveState();
  renderHistory($('history-container'), sessions, state.expandedSessions);
}

// ==================== EVENTS ====================
const ACTIONS = {
  'go-screen': el => goScreen(el.dataset.screen),
  'start-session': el => startSession(Number(el.dataset.index)),
  'complete-session': () => completeSession(),
  'copy-summary': el => copySummary(el),
  'start-timer': el => isTimerKey(el.dataset.timerKey) && startTimer(el.dataset.timerKey),
  'toggle-timer': el => isTimerKey(el.dataset.timerKey) && toggleTimer(el.dataset.timerKey),
  'clear-timer': el => isTimerKey(el.dataset.timerKey) && clearTimer(el.dataset.timerKey),
  'toggle-expand': el => toggleExpandSession(el.dataset.id),
  'delete-session': el => deleteSession(el.dataset.id),
};

function initEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !Object.hasOwn(ACTIONS, el.dataset.action)) return;
    ACTIONS[el.dataset.action](el);
  });

  const exercises = container();

  // Change: guardar peso
  exercises.addEventListener('change', e => {
    if (!e.target.classList.contains('kg-input')) return;
    const list = PLAN[state.activeSession] || [];
    const exIdx = parseInt(e.target.dataset.ex, 10);
    const seriesIdx = parseInt(e.target.dataset.series, 10);
    const field = e.target.dataset.field;
    if (field !== 'weight' && field !== 'weight2') return;
    const exName = list[exIdx] && list[exIdx].name;
    const rows = exName && state.sessionData[exName];
    if (!rows || !rows[seriesIdx]) return;
    rows[seriesIdx][field] = e.target.value;
    saveState();
  });

  // Enter pasa al siguiente input
  exercises.addEventListener('keydown', e => {
    if (!e.target.classList.contains('kg-input') || e.key !== 'Enter') return;
    e.preventDefault();
    const all = Array.from(exercises.querySelectorAll('.kg-input'));
    const idx = all.indexOf(e.target);
    if (idx < all.length - 1) all[idx + 1].focus();
    else e.target.blur();
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  }
}

// ==================== INIT ====================
function init() {
  state = storage.loadState(DEFAULT_STATE);
  if (!Array.isArray(state.expandedSessions)) state.expandedSessions = [];
  if (!state.timers || typeof state.timers !== 'object') state.timers = {};
  if (!state.sessionData || typeof state.sessionData !== 'object') state.sessionData = {};
  sessions = storage.loadSessions();
  initEvents();
  registerServiceWorker();
  renderHome($('sessions-list'));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
