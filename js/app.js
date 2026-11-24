// Punto de entrada: estado, navegación, descanso y delegación de eventos.
import { getPlanSession } from './plan.js';
import * as storage from './storage.js';
import {
  createDraft, setDraftValue, draftStats, finalizeDraft, previousFor, buildSummaryText,
  buildExport, parseImport, mergeSessions, toCSV, hasValues,
  toggleSeriesDone, fillSeries, addSeries, removeLastSeries, insertSeries, moveExercise,
  substituteExercise, setNote, defaultRest, restForSeries, MAX_REST,
} from './data.js';
import {
  createTimer, toggleTimer as toggleTimerState, adjustTimer, remainingAt, formatElapsed,
  beep, vibrate, unlockAudio,
} from './timers.js';
import {
  h, renderHome, renderSession, renderSeriesRow, renderHistory, renderImportPreview, formatDate,
  renderRestBar, updateRestBar,
} from './views.js';

// ==================== STATE ====================
// data: datos persistentes (gymtracker.data). draft: sesión en curso (gymtracker.draft).
// ui: estado de interfaz (gymtracker.ui). Cada uno se guarda por separado.
// ui.timer: el único descanso activo (se guarda solo en eventos, no en cada tick).
const DEFAULT_UI = { timer: null, restByExercise: {}, expandedSessions: [], notifAsked: false };
const REST_STEP = 15;
const REST_STEP_MAX = 600;

let data = null;
let draft = null;
let ui = { ...DEFAULT_UI };
let pendingImport = null;
let substituting = null;
let summaryShown = false;
let currentScreen = 'home';

const $ = id => document.getElementById(id);
const container = () => $('exercises-container');

// ==================== AVISOS ====================
let toastTimeout = null;
let toastUndo = null;

// undo: { label, run } muestra un botón que ejecuta run() durante unos segundos.
function toast(message, kind = 'info', undo = null) {
  const el = $('toast');
  if (!el) return;
  toastUndo = undo;
  el.replaceChildren(
    h('span', { class: 'toast-text' }, message),
    undo ? h('button', { class: 'toast-action', dataset: { action: 'toast-undo' } }, undo.label) : null,
  );
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(hideToast, kind === 'error' ? 8000 : (undo ? 8000 : 3500));
}

function hideToast() {
  const el = $('toast');
  if (el) el.hidden = true;
  toastUndo = null;
}

function runToastUndo() {
  const undo = toastUndo;
  hideToast();
  if (undo) undo.run();
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

// ==================== NAVEGACIÓN ====================
// History API: cada pantalla distinta de home es una entrada del historial, así el botón
// atrás de Android vuelve a la pantalla anterior en vez de cerrar la app.
function showScreen(name) {
  const target = $(`screen-${name}`);
  if (!target) return;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  currentScreen = name;
  if (name === 'home') renderHome($('sessions-list'), draft);
  else if (name === 'history') renderHistory($('history-container'), data.sessions, ui.expandedSessions);
  else if (name === 'session') {
    tick();
    ensureLoop();
  }
  syncWakeLock();
}

function depth() {
  return (history.state && Number.isInteger(history.state.depth)) ? history.state.depth : 0;
}

// mode: 'push' (nueva entrada), 'replace' (sustituye la actual) o 'none'.
function goScreen(name, mode = 'push') {
  if (!$(`screen-${name}`)) return;
  if (name === 'home' && mode === 'push') {
    goBack();
    return;
  }
  if (mode === 'push') history.pushState({ screen: name, depth: depth() + 1 }, '');
  else if (mode === 'replace') history.replaceState({ screen: name, depth: depth() }, '');
  showScreen(name);
}

function goBack() {
  if (depth() > 0) history.back();
  else goScreen('home', 'replace');
}

function onPopState(e) {
  let name = (e.state && e.state.screen) || 'home';
  if ((name === 'session' && !draft) || (name === 'summary' && !summaryShown)) {
    name = 'home';
    history.replaceState({ screen: 'home', depth: 0 }, '');
  }
  if (name === 'session') showSession();
  showScreen(name);
}

// ==================== SESIÓN ====================
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
  ui.timer = null;
  substituting = null;
  saveUi();
  saveDraft();
  resumeSession();
}

function resumeSession() {
  if (!draft) return;
  showSession();
  goScreen('session');
}

function restOf(ex) {
  return Object.hasOwn(ui.restByExercise, ex.id) ? ui.restByExercise[ex.id] : defaultRest(ex);
}

function showSession() {
  const plan = getPlanSession(draft.planSessionId);
  $('session-header-title').textContent = plan.name;
  renderSessionView();
  renderRestBar($('rest-bar'), ui.timer);
}

// Repinta la lista de ejercicios conservando el scroll.
function renderSessionView() {
  if (!draft) return;
  const el = container();
  const top = el.scrollTop;
  renderSession(el, draft, {
    previous: previousFor(data.sessions, draft.planSessionId),
    restOf,
    substituting,
  });
  el.scrollTop = top;
  const { filled, total } = draftStats(draft);
  $('session-header-count').textContent = `${draft.exercises.length} ejercicios · ${filled}/${total} series`;
}

function endDraft() {
  draft = null;
  substituting = null;
  storage.clearDraft();
  ui.timer = null;
  saveUi();
  renderRestBar($('rest-bar'), null);
  syncWakeLock();
}

function discardSession() {
  if (!draft) return;
  const { filled } = draftStats(draft);
  const msg = filled > 0
    ? `¿Descartar la sesión en curso? Se perderán ${filled} series apuntadas.`
    : '¿Descartar la sesión en curso?';
  if (!confirm(msg)) return;
  endDraft();
  goBack();
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
  summaryShown = true;
  goScreen('summary', 'replace');
}

// Entero no negativo de un data-* o null.
function idx(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function rowEl(exIdx, seriesIdx) {
  return container().querySelector(`.series-block[data-ex="${exIdx}"][data-series="${seriesIdx}"]`);
}

function previousSeries(exIdx, seriesIdx) {
  const ex = draft.exercises[exIdx];
  const prev = previousFor(data.sessions, draft.planSessionId).get(ex.id);
  return (prev && prev[seriesIdx]) || null;
}

// Repinta solo una fila (sin perder el foco de las demás).
function refreshRow(exIdx, seriesIdx) {
  const row = rowEl(exIdx, seriesIdx);
  if (!row) return;
  row.replaceWith(renderSeriesRow(draft, exIdx, seriesIdx, previousFor(data.sessions, draft.planSessionId)));
  const { filled, total } = draftStats(draft);
  $('session-header-count').textContent = `${draft.exercises.length} ejercicios · ${filled}/${total} series`;
}

function toggleSeries(exIdx, seriesIdx) {
  if (!draft || exIdx === null || seriesIdx === null) return;
  const r = toggleSeriesDone(draft, exIdx, seriesIdx, previousSeries(exIdx, seriesIdx));
  if (!r.ok) {
    toast(r.error === 'empty' ? 'Apunta peso o reps antes de marcar la serie.' : 'Serie no válida', 'error');
    return;
  }
  saveDraft();
  refreshRow(exIdx, seriesIdx);
  if (r.done) {
    const ex = draft.exercises[exIdx];
    const sec = restForSeries(draft, exIdx, seriesIdx, ui.restByExercise);
    if (sec) startRest(sec, `${ex.name} · serie ${seriesIdx + 1}`);
  }
}

function fillPrevious(exIdx, seriesIdx) {
  if (!draft || exIdx === null || seriesIdx === null) return;
  if (!fillSeries(draft, exIdx, seriesIdx, previousSeries(exIdx, seriesIdx))) {
    toast('Esa serie ya tiene valores.');
    return;
  }
  saveDraft();
  refreshRow(exIdx, seriesIdx);
}

function addSeriesTo(exIdx) {
  if (!draft || exIdx === null) return;
  if (!addSeries(draft, exIdx)) {
    toast('Máximo de series alcanzado.', 'error');
    return;
  }
  saveDraft();
  renderSessionView();
}

function removeSeriesFrom(exIdx) {
  if (!draft || exIdx === null) return;
  const exId = draft.exercises[exIdx] && draft.exercises[exIdx].id;
  const removed = removeLastSeries(draft, exIdx);
  if (!removed) {
    toast('Cada ejercicio necesita al menos una serie.', 'error');
    return;
  }
  saveDraft();
  renderSessionView();
  toast(`Serie ${removed.index + 1} quitada`, 'info', {
    label: 'Deshacer',
    run: () => {
      const i = draft ? draft.exercises.findIndex(e => e.id === exId) : -1;
      if (i < 0 || !insertSeries(draft, i, removed.index, removed.series)) return;
      saveDraft();
      renderSessionView();
    },
  });
}

function moveExerciseBy(exIdx, dir) {
  if (!draft || exIdx === null || moveExercise(draft, exIdx, dir) < 0) return;
  substituting = null;
  saveDraft();
  renderSessionView();
}

function openSubstitute(exIdx) {
  if (!draft || exIdx === null) return;
  substituting = exIdx;
  renderSessionView();
  const input = $('substitute-input');
  if (input) input.focus();
}

function cancelSubstitute() {
  substituting = null;
  renderSessionView();
}

function confirmSubstitute(exIdx) {
  const input = $('substitute-input');
  if (!draft || exIdx === null || !input) return;
  const ex = draft.exercises[exIdx];
  if (ex && ex.series.some(hasValues) && !confirm('Este ejercicio ya tiene series apuntadas. ¿Sustituirlo y vaciarlas?')) return;
  const r = substituteExercise(draft, exIdx, input.value);
  if (!r.ok) {
    toast(r.error === 'duplicate' ? 'Ese ejercicio ya está en la sesión.' : 'Escribe el nombre del ejercicio (máx. 120 caracteres).', 'error');
    return;
  }
  substituting = null;
  saveDraft();
  renderSessionView();
}

function stepRest(exIdx, delta) {
  const ex = draft && exIdx !== null && draft.exercises[exIdx];
  if (!ex || !Number.isInteger(delta)) return;
  const next = Math.min(REST_STEP_MAX, Math.max(0, restOf(ex) + delta));
  ui.restByExercise[ex.id] = next;
  saveUi();
  renderSessionView();
}

// ==================== DESCANSO ====================
let loop = null;

function ensureLoop() {
  if (loop) return;
  loop = setInterval(tick, 500);
}

function stopLoopIfIdle() {
  if (!loop || ui.timer || currentScreen === 'session') return;
  clearInterval(loop);
  loop = null;
}

function startRest(seconds, label) {
  ui.timer = createTimer(Math.min(seconds, MAX_REST), Date.now(), label);
  saveUi();
  unlockAudio();
  askNotifications();
  renderRestBar($('rest-bar'), ui.timer);
  ensureLoop();
}

function clearRest() {
  ui.timer = null;
  saveUi();
  renderRestBar($('rest-bar'), null);
  stopLoopIfIdle();
}

function finishRest(late) {
  const label = ui.timer ? ui.timer.label : '';
  clearRest();
  if (late) return;
  vibrate();
  beep();
  if (document.hidden) notifyRestEnd(label);
}

// Se llama cada 500 ms y al volver a primer plano: recalcula desde timestamps, no acumula.
function tick() {
  const now = Date.now();
  if (draft && currentScreen === 'session') {
    $('session-elapsed').textContent = formatElapsed(now - draft.startedAt);
  }
  const t = ui.timer;
  if (t && !t.paused) {
    const remaining = remainingAt(t, now);
    if (remaining <= 0) {
      // Si la pantalla estaba apagada y el descanso acabó hace rato, no se avisa con retraso.
      finishRest(!document.hidden && now - t.endTs > 10_000);
    } else {
      t.remaining = remaining;
      updateRestBar($('rest-bar'), remaining, t.duration);
    }
  }
  stopLoopIfIdle();
}

function adjustRest(delta) {
  const t = ui.timer;
  if (!t || !Number.isInteger(delta)) return;
  const left = adjustTimer(t, delta, Date.now());
  if (left <= 0) {
    clearRest();
    return;
  }
  saveUi();
  renderRestBar($('rest-bar'), t);
}

function toggleRest() {
  const t = ui.timer;
  if (!t) return;
  toggleTimerState(t, Date.now());
  saveUi();
  renderRestBar($('rest-bar'), t);
  if (!t.paused) ensureLoop();
}

// Notificación local desde el Service Worker, solo con la pestaña en segundo plano y con permiso.
function askNotifications() {
  if (ui.notifAsked || !('Notification' in window) || Notification.permission !== 'default') return;
  ui.notifAsked = true;
  saveUi();
  try {
    Promise.resolve(Notification.requestPermission()).catch(() => {});
  } catch {}
}

function notifyRestEnd(label) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification('Descanso terminado', {
        body: label || 'Vuelve a la barra', tag: 'rest-end', icon: 'icons/icon-192.png', vibrate: [200, 100, 200],
      }))
      .catch(() => {});
  } catch {}
}

// ==================== WAKE LOCK ====================
let wakeLock = null;
let wakePending = false;

async function syncWakeLock() {
  if (!('wakeLock' in navigator) || wakePending) return;
  const want = !!draft && currentScreen === 'session' && document.visibilityState === 'visible';
  wakePending = true;
  try {
    if (want && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release();
    }
  } catch {
    wakeLock = null;
  } finally {
    wakePending = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Tras el segundo plano el intervalo pudo quedar parado o atrasado: recalcular ya.
    tick();
    if (ui.timer || currentScreen === 'session') ensureLoop();
  }
  syncWakeLock();
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
  const before = data.sessions;
  const index = before.findIndex(s => s.id === id);
  const removed = before[index];
  data.sessions = before.filter(s => s.id !== id);
  if (!saveData()) {
    data.sessions = before;
    return;
  }
  ui.expandedSessions = ui.expandedSessions.filter(x => x !== id);
  saveUi();
  renderHistory($('history-container'), data.sessions, ui.expandedSessions);
  toast('Sesión borrada', 'info', {
    label: 'Deshacer',
    run: () => {
      if (data.sessions.some(s => s.id === id)) return;
      const next = [...data.sessions];
      next.splice(Math.min(index, next.length), 0, removed);
      const previous = data.sessions;
      data.sessions = next;
      if (!saveData()) {
        data.sessions = previous;
        return;
      }
      renderHistory($('history-container'), data.sessions, ui.expandedSessions);
      toast('Sesión recuperada');
    },
  });
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
  'go-back': () => goBack(),
  'start-session': el => startSession(el.dataset.planId),
  'resume-session': () => resumeSession(),
  'discard-session': () => discardSession(),
  'complete-session': () => completeSession(),
  'copy-summary': el => copySummary(el),
  'toggle-series': el => toggleSeries(idx(el.dataset.ex), idx(el.dataset.series)),
  'fill-previous': el => fillPrevious(idx(el.dataset.ex), idx(el.dataset.series)),
  'add-series': el => addSeriesTo(idx(el.dataset.ex)),
  'remove-series': el => removeSeriesFrom(idx(el.dataset.ex)),
  'move-exercise': el => moveExerciseBy(idx(el.dataset.ex), Number(el.dataset.dir)),
  'open-substitute': el => openSubstitute(idx(el.dataset.ex)),
  'confirm-substitute': el => confirmSubstitute(idx(el.dataset.ex)),
  'cancel-substitute': () => cancelSubstitute(),
  'rest-step': el => stepRest(idx(el.dataset.ex), Number(el.dataset.delta)),
  'rest-adjust': el => adjustRest(Number(el.dataset.delta)),
  'rest-toggle': () => toggleRest(),
  'rest-skip': () => clearRest(),
  'toast-undo': () => runToastUndo(),
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
  window.addEventListener('popstate', onPopState);

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
    const s = draft.exercises[exIdx].series[seriesIdx];
    input.value = r.value === null ? '' : String(r.value);
    const row = input.closest('.series-block');
    if (row) {
      row.classList.toggle('done', s.done);
      const check = row.querySelector('.check-btn');
      if (check) {
        check.classList.toggle('on', s.done);
        check.setAttribute('aria-pressed', String(s.done));
      }
    }
    saveDraft();
  });

  // Notas: se guardan al escribir (el borrador es pequeño).
  exercises.addEventListener('input', e => {
    const el = e.target;
    if (!draft || !el.classList.contains('note-input')) return;
    if (el.dataset.note === 'session') setNote(draft, null, el.value);
    else if (el.dataset.note === 'exercise') setNote(draft, idx(el.dataset.ex), el.value);
    else return;
    saveDraft();
  });

  // Enter pasa al siguiente input
  exercises.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'substitute-input') {
      e.preventDefault();
      confirmSubstitute(substituting);
      return;
    }
    if (!e.target.classList.contains('kg-input')) return;
    e.preventDefault();
    const all = Array.from(exercises.querySelectorAll('.kg-input'));
    const i = all.indexOf(e.target);
    if (i < all.length - 1) all[i + 1].focus();
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
  // Un descanso solo tiene sentido con sesión en curso; si ya terminó mientras la app estaba cerrada, se descarta.
  if (!draft || (ui.timer && !ui.timer.paused && remainingAt(ui.timer, Date.now()) <= 0)) {
    ui.timer = null;
    saveUi();
  }

  $('share-json-btn').hidden = !canShareFiles();
  initEvents();
  registerServiceWorker();

  history.replaceState({ screen: 'home', depth: 0 }, '');
  if (draft) {
    // Home debajo y la sesión encima: atrás desde la sesión lleva a home.
    showSession();
    goScreen('session');
  } else {
    showScreen('home');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
