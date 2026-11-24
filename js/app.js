// Punto de entrada: estado, navegación, temporizadores y delegación de eventos.
import { getPlanSession, restFor } from './plan.js';
import * as storage from './storage.js';
import {
  createDraft, setDraftValue, draftStats, finalizeDraft, previousFor, buildSummaryText,
  buildExport, parseImport, mergeSessions, toCSV,
} from './data.js';
import { isTimerKey, createTimer, toggleTimer as toggleTimerState, remainingAt, beep, sanitizeTimers } from './timers.js';
import {
  renderHome, renderSession, renderHistory, renderImportPreview, formatDate,
  buildTimer, buildTimerButton, findTimerEl, updateTimerEl, setTimerPausedIcon,
} from './views.js';

// ==================== STATE ====================
// data: datos persistentes (gymtracker.data). draft: sesión en curso (gymtracker.draft).
// ui: estado de interfaz (gymtracker.ui). Cada uno se guarda por separado.
const DEFAULT_UI = { timers: {}, expandedSessions: [] };

let data = null;
let draft = null;
let ui = { ...DEFAULT_UI };
let pendingImport = null;

const $ = id => document.getElementById(id);

// ==================== AVISOS ====================
let toastTimeout = null;

function toast(message, kind = 'info') {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 8000 : 3500);
}

function reportSave(result, what) {
  if (result.ok) return true;
  toast(result.quota
    ? `No se pudo guardar ${what}: el almacenamiento del navegador está lleno. Exporta tus datos y libera espacio.`
    : `No se pudo guardar ${what}. Exporta tus datos por si acaso.`, 'error');
  return false;
}

const saveData = () => reportSave(storage.saveData(data), 'el historial');
const saveDraft = () => (draft ? reportSave(storage.saveDraft(draft), 'la sesión en curso') : true);
const saveUi = () => storage.saveUi(ui);

// ==================== NAVIGATION ====================
function goScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = $(`screen-${name}`);
  if (!target) return;
  target.classList.add('active');
  if (name === 'home') renderHome($('sessions-list'), draft);
  else if (name === 'history') renderHistory($('history-container'), data.sessions, ui.expandedSessions);
}

// ==================== SESSION ====================
function startSession(planId) {
  const plan = getPlanSession(planId);
  if (!plan) return;
  if (draft) {
    if (draft.planSessionId === planId) {
      resumeSession();
      return;
    }
    const current = getPlanSession(draft.planSessionId);
    if (!confirm(`Tienes una sesión en curso (${current ? current.name : 'sin nombre'}). ¿Descartarla y empezar ${plan.name}?`)) return;
  }
  draft = createDraft(planId);
  ui.timers = {};
  saveUi();
  saveDraft();
  resumeSession();
}

function resumeSession() {
  if (!draft) return;
  showSession();
  goScreen('session');
}

function showSession() {
  const plan = getPlanSession(draft.planSessionId);
  $('session-header-title').textContent = plan.name;
  $('session-header-count').textContent = `${plan.exercises.length} ejercicios`;
  renderSession($('exercises-container'), plan, draft, ui.timers, previousFor(data.sessions, plan.id));
  if (Object.keys(ui.timers).length > 0) ensureTimerInterval();
}

function endDraft() {
  draft = null;
  storage.clearDraft();
  ui.timers = {};
  saveUi();
}

function discardSession() {
  if (!draft) return;
  const { filled } = draftStats(draft);
  const msg = filled > 0
    ? `¿Descartar la sesión en curso? Se perderán ${filled} series apuntadas.`
    : '¿Descartar la sesión en curso?';
  if (!confirm(msg)) return;
  endDraft();
  goScreen('home');
}

function completeSession() {
  if (!draft) return;
  const { total, filled, missing } = draftStats(draft);
  if (filled === 0) {
    if (!confirm('No has apuntado ninguna serie. ¿Guardar la sesión vacía igualmente?')) return;
  } else if (missing > 0) {
    if (!confirm(`Hay ${missing} de ${total} series sin completar. ¿Guardar igualmente?`)) return;
  }

  const r = finalizeDraft(draft);
  if (!r.ok) {
    toast(`No se pudo guardar la sesión: ${r.error}`, 'error');
    return;
  }
  data.sessions.push(r.session);
  if (!saveData()) {
    // El borrador se conserva: nada se pierde si falla la escritura.
    data.sessions.pop();
    return;
  }
  endDraft();
  storage.requestPersistence();

  $('summary-session-name').textContent = r.session.name;
  $('summary-text').textContent = buildSummaryText(r.session, formatDate(r.session.startedAt));
  goScreen('summary');
}

// ==================== TIMERS ====================
let timerInterval = null;

function container() {
  return $('exercises-container');
}

function startTimer(key) {
  const duration = draft && restFor(draft.planSessionId, key);
  if (!duration) return;
  ui.timers[key] = createTimer(duration, Date.now());
  saveUi();
  const el = findTimerEl(container(), key);
  if (el) el.replaceWith(buildTimer(key, duration, ui.timers[key].remaining, false));
  ensureTimerInterval();
}

function resetTimerEl(key, duration) {
  const el = findTimerEl(container(), key);
  if (el) el.replaceWith(buildTimerButton(key, duration));
}

function clearTimerState(key) {
  delete ui.timers[key];
  saveUi();
}

function clearTimer(key) {
  const t = ui.timers[key];
  const duration = t ? t.duration : ((draft && restFor(draft.planSessionId, key)) || 60);
  clearTimerState(key);
  resetTimerEl(key, duration);
}

function toggleTimer(key) {
  const t = ui.timers[key];
  if (!t) return;
  toggleTimerState(t, Date.now());
  if (!t.paused) ensureTimerInterval();
  saveUi();
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

  Object.keys(ui.timers).forEach(key => {
    const t = ui.timers[key];
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

  saveUi();

  if (!hasActive && Object.keys(ui.timers).length === 0) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  Object.keys(ui.timers).forEach(key => {
    const t = ui.timers[key];
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
function deleteSession(id) {
  if (!data.sessions.some(s => s.id === id)) return;
  if (!confirm('¿Borrar esta sesión del historial?')) return;
  const before = data.sessions;
  data.sessions = data.sessions.filter(s => s.id !== id);
  if (!saveData()) {
    data.sessions = before;
    return;
  }
  ui.expandedSessions = ui.expandedSessions.filter(x => x !== id);
  saveUi();
  renderHistory($('history-container'), data.sessions, ui.expandedSessions);
}

function toggleExpandSession(id) {
  if (!data.sessions.some(s => s.id === id)) return;
  const idx = ui.expandedSessions.indexOf(id);
  if (idx >= 0) ui.expandedSessions.splice(idx, 1);
  else ui.expandedSessions.push(id);
  saveUi();
  renderHistory($('history-container'), data.sessions, ui.expandedSessions);
}

// ==================== EXPORT / IMPORT ====================
function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function exportFile(kind) {
  if (kind === 'csv') {
    // BOM para que las hojas de cálculo detecten UTF-8.
    return new File(['﻿' + toCSV(data.sessions)], `gym-tracker-${stamp()}.csv`, { type: 'text/csv' });
  }
  return new File([JSON.stringify(buildExport(data), null, 2)], `gym-tracker-${stamp()}.json`, { type: 'application/json' });
}

function download(kind) {
  const file = exportFile(kind);
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exportadas ${data.sessions.length} sesiones (${kind.toUpperCase()})`);
}

function canShareFiles() {
  try {
    const probe = new File(['{}'], 'gym-tracker.json', { type: 'application/json' });
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}

async function shareJSON() {
  const file = exportFile('json');
  try {
    await navigator.share({ files: [file], title: 'Gym Tracker: copia de seguridad' });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('No se pudo compartir; se descarga el fichero.', 'error');
    download('json');
  }
}

async function readImportFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  let text;
  try {
    text = file.size > 5_000_000 ? null : await file.text();
  } catch {
    text = null;
  }
  pendingImport = text === null
    ? { ok: false, error: 'Fichero ilegible o demasiado grande' }
    : parseImport(text, data.sessions);
  renderImportPreview($('import-preview'), pendingImport);
}

function confirmImport() {
  if (!pendingImport || !pendingImport.ok) return;
  const before = data.sessions;
  const { sessions, added } = mergeSessions(data.sessions, pendingImport.fresh);
  data.sessions = sessions;
  if (!saveData()) {
    data.sessions = before;
    return;
  }
  cancelImport();
  renderHistory($('history-container'), data.sessions, ui.expandedSessions);
  toast(`Importadas ${added} sesiones`);
}

function cancelImport() {
  pendingImport = null;
  renderImportPreview($('import-preview'), null);
}

// ==================== EVENTS ====================
const ACTIONS = {
  'go-screen': el => goScreen(el.dataset.screen),
  'start-session': el => startSession(el.dataset.planId),
  'resume-session': () => resumeSession(),
  'discard-session': () => discardSession(),
  'complete-session': () => completeSession(),
  'copy-summary': el => copySummary(el),
  'start-timer': el => isTimerKey(el.dataset.timerKey) && startTimer(el.dataset.timerKey),
  'toggle-timer': el => isTimerKey(el.dataset.timerKey) && toggleTimer(el.dataset.timerKey),
  'clear-timer': el => isTimerKey(el.dataset.timerKey) && clearTimer(el.dataset.timerKey),
  'toggle-expand': el => toggleExpandSession(el.dataset.id),
  'delete-session': el => deleteSession(el.dataset.id),
  'export-json': () => download('json'),
  'export-csv': () => download('csv'),
  'share-json': () => shareJSON(),
  'import-open': () => $('import-file').click(),
  'import-confirm': () => confirmImport(),
  'import-cancel': () => cancelImport(),
};

function initEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !Object.hasOwn(ACTIONS, el.dataset.action)) return;
    ACTIONS[el.dataset.action](el);
  });

  $('import-file').addEventListener('change', e => readImportFile(e.target));

  const exercises = container();

  // Change: guardar el valor validado en el borrador.
  exercises.addEventListener('change', e => {
    const input = e.target;
    if (!input.classList.contains('kg-input') || !draft) return;
    const exIdx = parseInt(input.dataset.ex, 10);
    const seriesIdx = parseInt(input.dataset.series, 10);
    const r = setDraftValue(draft, exIdx, seriesIdx, input.dataset.field, input.value);
    if (!r.ok) {
      input.setAttribute('aria-invalid', 'true');
      toast('Valor no válido', 'error');
      return;
    }
    input.removeAttribute('aria-invalid');
    const row = input.closest('.series-block');
    const s = draft.exercises[exIdx].series[seriesIdx];
    if (row) row.classList.toggle('done', s.done);
    saveDraft();
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
  const loaded = storage.loadData();
  data = loaded.data;
  if (loaded.source === 'corrupt') {
    toast('Los datos guardados estaban dañados. Se ha guardado una copia en gymtracker.data.backup.', 'error');
  } else if (loaded.rejected.length) {
    toast(`${loaded.rejected.length} sesiones guardadas no eran válidas y se han apartado.`, 'error');
  }
  if (loaded.source === 'v1') saveData();

  draft = storage.loadDraft();
  ui = storage.loadUi(DEFAULT_UI);
  ui.timers = draft ? sanitizeTimers(ui.timers) : {};

  $('share-json-btn').hidden = !canShareFiles();
  initEvents();
  registerServiceWorker();

  if (draft) resumeSession();
  else renderHome($('sessions-list'), draft);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
