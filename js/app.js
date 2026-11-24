// Punto de entrada: estado, navegación, descanso y delegación de eventos.
import { getPlanSession } from './plan.js';
import * as storage from './storage.js';
import {
  createDraft, setDraftValue, draftStats, finalizeDraft, previousFor, buildSummaryText,
  buildExport, parseImport, mergeSessions, mergeBody, toCSV, hasValues, parseBodyInput, upsertBody, isDateKey,
  toggleSeriesDone, fillSeries, addSeries, removeLastSeries, insertSeries, moveExercise,
  substituteExercise, setNote, defaultRest, restForSeries, MAX_REST,
  getSettings, applySetting, fieldsForExerciseId,
} from './data.js';
import { setUnit, getUnit, unitLabel, inputToKg, kgToDisplay, progressionStepKg } from './units.js';
import { suggestOverload, deloadNotices } from './progress.js';
import { renderSettings, renderPlates, renderPlateResult, readPlatesForm, defaultBarKg, defaultPlatesKg } from './tools.js';
import { buildShareCard, renderShareCard, canvasToBlob } from './share.js';
import {
  createTimer, toggleTimer as toggleTimerState, adjustTimer, remainingAt, formatElapsed,
  beep, vibrate, unlockAudio,
} from './timers.js';
import {
  h, renderHome, renderSession, renderSeriesRow, renderImportPreview, formatDate,
  renderRestBar, updateRestBar, renderNotices,
} from './views.js';
import { renderHistoryView, TABS } from './history.js';
import { detectRecords, formatRecord, buildWeeklySummary, weekStart, addWeeks, dayKey } from './stats.js';
import { PLAN } from './plan.js';

// ==================== STATE ====================
// data: datos persistentes (gymtracker.data). draft: sesión en curso (gymtracker.draft).
// ui: estado de interfaz (gymtracker.ui). Cada uno se guarda por separado.
// ui.timer: el único descanso activo (se guarda solo en eventos, no en cada tick).
const DEFAULT_UI = { timer: null, restByExercise: {}, expandedSessions: [], notifAsked: false, guided: false, guidedIndex: 0 };
const REST_STEP = 15;
const REST_STEP_MAX = 600;

let data = null;
let draft = null;
let ui = { ...DEFAULT_UI };
let pendingImport = null;
let substituting = null;
let summaryShown = false;
let lastSummary = null;
let platesPrefill = null;
let sharePreviewUrl = null;
let currentScreen = 'home';
// Estado de la pantalla de historial (no se guarda): pestaña, filtros y navegación de calendario/semana.
const view = { tab: 'sessions', search: '', plan: '', exerciseId: null, calYear: 0, calMonth: 0, weekOffset: 0 };

const $ = id => document.getElementById(id);
const container = () => $('exercises-container');

// ==================== AJUSTES ====================
const settings = () => getSettings(data);

// Tema y unidad activos según los ajustes. 'auto' sigue al sistema (ver css).
function applyAppearance() {
  const s = settings();
  setUnit(s.units);
  document.documentElement.dataset.theme = s.theme;
  const label = $('body-weight-label');
  if (label) label.textContent = `Peso (${unitLabel()})`;
}

function changeSetting(key, value) {
  const r = applySetting(data.settings, key, value);
  if (!r.ok) return false;
  const before = data.settings;
  data.settings = r.settings;
  if (key === 'units') {
    // La barra y los discos se guardan en kg pero se piensan en la unidad elegida: vuelven a los de esa unidad.
    delete data.settings.bar;
    delete data.settings.plates;
  }
  if (!saveData()) {
    data.settings = before;
    return false;
  }
  applyAppearance();
  repaintAll();
  return true;
}

// Repinta lo que depende de unidades y ajustes.
function repaintAll() {
  if (currentScreen === 'settings') renderSettings($('settings-container'), settings());
  if (currentScreen === 'plates') showPlates();
  if (draft) renderSessionView();
  if (currentScreen === 'home') renderHome($('sessions-list'), draft);
  if (currentScreen === 'history') renderHistoryScreen();
  renderHomeNotices();
}

function renderHomeNotices() {
  renderNotices($('home-notices'), settings().progression ? deloadNotices(data.sessions) : []);
}

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
  if (name === 'home') {
    renderHome($('sessions-list'), draft);
    renderHomeNotices();
  }
  else if (name === 'history') openHistory();
  else if (name === 'settings') renderSettings($('settings-container'), settings());
  else if (name === 'plates') showPlates();
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
  ui.guidedIndex = 0;
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
  if (Object.hasOwn(ui.restByExercise, ex.id)) return ui.restByExercise[ex.id];
  return defaultRest(ex) || settings().defaultRest;
}

function suggestFor(ex) {
  return settings().progression ? suggestOverload(data.sessions, ex.id, progressionStepKg()) : null;
}

function guidedIndex() {
  return draft ? Math.min(Math.max(ui.guidedIndex, 0), draft.exercises.length - 1) : 0;
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
    suggest: suggestFor,
    guided: ui.guided ? guidedIndex() : null,
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
  const records = detectRecords(data.sessions, r.session);
  data.sessions.push(r.session);
  if (!saveData()) {
    // El borrador se conserva: nada se pierde si falla la escritura.
    data.sessions.pop();
    return;
  }
  endDraft();
  storage.requestPersistence();

  lastSummary = { session: r.session, records };
  clearSharePreview();
  $('summary-session-name').textContent = r.session.name;
  $('summary-text').textContent = buildSummaryText(r.session, formatDate(r.session.startedAt));
  renderRecords(records);
  summaryShown = true;
  goScreen('summary', 'replace');
  if (records.length) toast(`🏅 ${records.length} ${records.length === 1 ? 'récord nuevo' : 'récords nuevos'}`);
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
    const sec = restForSeries(draft, exIdx, seriesIdx, ui.restByExercise, settings().defaultRest);
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
  if (!draft || exIdx === null) return;
  const to = moveExercise(draft, exIdx, dir);
  if (to < 0) return;
  if (ui.guided) {
    ui.guidedIndex = to;
    saveUi();
  }
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
  const s = settings();
  if (s.vibration) vibrate();
  if (s.sound) beep();
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
        body: label || 'Vuelve a la barra', tag: 'rest-end', icon: 'icons/icon-192.png', ...(settings().vibration ? { vibrate: [200, 100, 200] } : {}), ...(!settings().sound && !settings().vibration ? { silent: true } : {}),
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
  copyText($('summary-text').textContent, btn);
}

function copyText(text, btn) {
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
function renderRecords(records) {
  const box = $('summary-records');
  if (!records.length) {
    box.replaceChildren();
    box.hidden = true;
    return;
  }
  box.replaceChildren(
    h('div', { class: 'records-title' }, `🏅 ${records.length === 1 ? 'Récord personal' : 'Récords personales'}`),
    ...records.map(r => h('div', { class: 'record-line' }, formatRecord(r))),
  );
  box.hidden = false;
}

function renderTabs() {
  $('history-tabs').replaceChildren(...TABS.map(([id, label]) => h('button', {
    class: 'tab-btn', role: 'tab', 'aria-selected': String(view.tab === id), dataset: { action: 'history-tab', tab: id },
  }, label)));
}

function syncHistoryChrome() {
  renderTabs();
  $('history-filters').hidden = !(view.tab === 'sessions' || (view.tab === 'exercises' && !view.exerciseId));
  $('history-plan').hidden = view.tab !== 'sessions';
  $('body-form').hidden = view.tab !== 'body';
}

function renderHistoryScreen() {
  syncHistoryChrome();
  renderHistoryView($('history-container'), view, data, ui.expandedSessions);
}

function openHistory() {
  const now = new Date();
  view.calYear = now.getFullYear();
  view.calMonth = now.getMonth();
  view.weekOffset = 0;
  view.exerciseId = null;
  const sel = $('history-plan');
  if (!sel.options.length) {
    sel.replaceChildren(h('option', { value: '' }, 'Todas las sesiones'), ...PLAN.map(p => h('option', { value: p.id }, p.name)));
  }
  const date = $('body-date');
  if (!date.value) date.value = dayKey(Date.now());
  renderHistoryScreen();
}

function setHistoryTab(tab) {
  if (!TABS.some(([id]) => id === tab)) return;
  view.tab = tab;
  view.exerciseId = null;
  renderHistoryScreen();
}

function shiftCalendar(delta) {
  const d = new Date(view.calYear, view.calMonth + delta, 1);
  view.calYear = d.getFullYear();
  view.calMonth = d.getMonth();
  renderHistoryScreen();
}

function shiftSummaryWeek(delta) {
  view.weekOffset = Math.max(0, view.weekOffset + delta);
  renderHistoryScreen();
}

function copyWeekly(btn) {
  const text = buildWeeklySummary(data.sessions, data.body, addWeeks(weekStart(Date.now()), -view.weekOffset));
  copyText(text, btn);
}

function saveBody() {
  const date = $('body-date').value;
  const err = $('body-error');
  const raws = {};
  document.querySelectorAll('#body-form [data-key]').forEach(i => { raws[i.dataset.key] = i.value; });
  if (raws.weight !== undefined) raws.weight = inputToKg(raws.weight);
  const fail = msg => {
    err.textContent = msg;
    err.hidden = false;
  };
  if (!isDateKey(date)) return fail('Fecha no válida');
  const r = parseBodyInput(date, raws);
  if (!r.ok) return fail(r.error);
  const before = data.body;
  data.body = upsertBody(data.body, r.entry);
  if (!saveData()) {
    data.body = before;
    return;
  }
  err.hidden = true;
  document.querySelectorAll('#body-form [data-key]').forEach(i => { i.value = ''; });
  renderHistoryScreen();
  toast('Medida guardada');
}

function deleteBody(date) {
  const index = data.body.findIndex(b => b.date === date);
  if (index < 0) return;
  const before = data.body;
  const removed = before[index];
  data.body = before.filter(b => b.date !== date);
  if (!saveData()) {
    data.body = before;
    return;
  }
  renderHistoryScreen();
  toast('Medida borrada', 'info', {
    label: 'Deshacer',
    run: () => {
      if (data.body.some(b => b.date === date)) return;
      const previous = data.body;
      data.body = upsertBody(data.body, removed);
      if (!saveData()) {
        data.body = previous;
        return;
      }
      renderHistoryScreen();
      toast('Medida recuperada');
    },
  });
}

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
  renderHistoryScreen();
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
      renderHistoryScreen();
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
  renderHistoryScreen();
}

// ==================== PROGRESIÓN Y MODO GUIADO ====================
function toggleGuided() {
  if (!draft) return;
  ui.guided = !ui.guided;
  saveUi();
  renderSessionView();
  container().scrollTop = 0;
}

function guidedStep(delta) {
  if (!draft || !ui.guided || !Number.isInteger(delta)) return;
  const next = Math.min(Math.max(guidedIndex() + delta, 0), draft.exercises.length - 1);
  if (next === guidedIndex()) return;
  ui.guidedIndex = next;
  substituting = null;
  saveUi();
  renderSessionView();
  container().scrollTop = 0;
}

// Pone la carga sugerida en las series del ejercicio que aún no tienen peso.
function applySuggestion(exIdx) {
  const ex = draft && exIdx !== null && draft.exercises[exIdx];
  const sug = ex && suggestFor(ex);
  if (!sug || sug.status !== 'increase') return;
  let n = 0;
  ex.series.forEach((x, i) => {
    if (x.weight === null && setDraftValue(draft, exIdx, i, 'weight', sug.next).ok) n += 1;
  });
  if (!n) {
    toast('Todas las series ya tienen peso.');
    return;
  }
  saveDraft();
  renderSessionView();
}

// ==================== AJUSTES Y DISCOS (acciones) ====================
function setSettingAction(el) {
  changeSetting(el.dataset.key, el.dataset.value);
}

function toggleSettingAction(el) {
  const key = el.dataset.key;
  changeSetting(key, !settings()[key]);
}

function stepSettingAction(el) {
  const key = el.dataset.key;
  const delta = Number(el.dataset.delta);
  if (key !== 'defaultRest' || !Number.isInteger(delta)) return;
  changeSetting(key, Math.min(REST_STEP_MAX, Math.max(0, settings().defaultRest + delta)));
}

function showPlates() {
  const s = data.settings;
  renderPlates($('plates-container'), {
    totalKg: platesPrefill,
    barKg: s.bar ?? defaultBarKg(),
    platesKg: s.plates ?? defaultPlatesKg(),
  });
  updatePlates();
}

function updatePlates() {
  return renderPlateResult($('plates-result'), readPlatesForm());
}

function openPlates(exIdx) {
  const ex = draft && exIdx !== null ? draft.exercises[exIdx] : null;
  platesPrefill = null;
  if (ex) {
    const sug = suggestFor(ex);
    const weights = ex.series.map(x => x.weight).filter(w => typeof w === 'number' && w > 0);
    platesPrefill = weights.length ? Math.max(...weights) : (sug ? sug.next : null);
  }
  goScreen('plates');
}

function savePlates() {
  const form = readPlatesForm();
  renderPlateResult($('plates-result'), form);
  if (form.error) return;
  const before = data.settings;
  const a = applySetting(before, 'bar', form.barKg);
  const b = a.ok && applySetting(a.settings, 'plates', form.platesKg);
  if (!a.ok || !b.ok) return;
  data.settings = b.settings;
  if (!saveData()) {
    data.settings = before;
    return;
  }
  toast('Barra y discos guardados');
}

function resetPlates() {
  const a = applySetting(data.settings, 'bar', null);
  const b = applySetting(a.settings, 'plates', null);
  const before = data.settings;
  data.settings = b.settings;
  if (!saveData()) {
    data.settings = before;
    return;
  }
  showPlates();
}

// ==================== IMAGEN PARA COMPARTIR ====================
function clearSharePreview() {
  if (sharePreviewUrl) URL.revokeObjectURL(sharePreviewUrl);
  sharePreviewUrl = null;
  const box = $('share-preview');
  box.replaceChildren();
  box.hidden = true;
}

async function shareCard() {
  if (!lastSummary) return;
  const { session, records } = lastSummary;
  const btn = $('share-card-btn');
  btn.disabled = true;
  try {
    const model = buildShareCard(session, records, formatDate(session.startedAt));
    const blob = await canvasToBlob(renderShareCard(model));
    const file = new File([blob], `gym-tracker-${dayKey(session.startedAt)}.png`, { type: 'image/png' });
    clearSharePreview();
    sharePreviewUrl = URL.createObjectURL(blob);
    const box = $('share-preview');
    box.replaceChildren(h('img', { src: sharePreviewUrl, alt: `Resumen de ${session.name}`, class: 'share-img' }));
    box.hidden = false;
    const canShare = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    if (canShare) {
      try {
        await navigator.share({ files: [file], title: session.name });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        toast('No se pudo compartir; se descarga la imagen.', 'error');
      }
    }
    const a = h('a', { href: sharePreviewUrl, download: file.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    console.warn('Error generating share card', e);
    toast('No se pudo generar la imagen.', 'error');
  } finally {
    btn.disabled = false;
  }
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
    : parseImport(text, data.sessions, data.body);
  renderImportPreview($('import-preview'), pendingImport);
}

function confirmImport() {
  if (!pendingImport || !pendingImport.ok) return;
  const before = data.sessions;
  const beforeBody = data.body;
  const { sessions, added } = mergeSessions(data.sessions, pendingImport.fresh);
  const merged = mergeBody(data.body, pendingImport.freshBody || []);
  data.sessions = sessions;
  data.body = merged.body;
  if (!saveData()) {
    data.sessions = before;
    data.body = beforeBody;
    return;
  }
  cancelImport();
  renderHistoryScreen();
  toast(merged.added ? `Importadas ${added} sesiones y ${merged.added} medidas` : `Importadas ${added} sesiones`);
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
  'toggle-guided': () => toggleGuided(),
  'guided-step': el => guidedStep(Number(el.dataset.delta)),
  'apply-suggestion': el => applySuggestion(idx(el.dataset.ex)),
  'set-setting': el => setSettingAction(el),
  'toggle-setting': el => toggleSettingAction(el),
  'step-setting': el => stepSettingAction(el),
  'open-plates': el => openPlates(idx(el.dataset.ex)),
  'save-plates': () => savePlates(),
  'reset-plates': () => resetPlates(),
  'share-card': () => shareCard(),
  'toggle-expand': el => toggleExpandSession(el.dataset.id),
  'delete-session': el => deleteSession(el.dataset.id),
  'history-tab': el => setHistoryTab(el.dataset.tab),
  'select-exercise': el => { view.exerciseId = el.dataset.id; renderHistoryScreen(); },
  'clear-exercise': () => { view.exerciseId = null; renderHistoryScreen(); },
  'cal-month': el => shiftCalendar(Number(el.dataset.delta)),
  'summary-week': el => shiftSummaryWeek(Number(el.dataset.delta)),
  'copy-weekly': el => copyWeekly(el),
  'save-body': () => saveBody(),
  'delete-body': el => deleteBody(el.dataset.date),
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
  $('plates-container').addEventListener('input', e => {
    if (e.target.classList.contains('plates-input')) updatePlates();
  });
  $('history-search').addEventListener('input', e => {
    view.search = e.target.value;
    renderHistoryScreen();
  });
  $('history-plan').addEventListener('change', e => {
    view.plan = e.target.value;
    renderHistoryScreen();
  });

  const exercises = container();

  // Change: guardar el valor validado en el borrador.
  exercises.addEventListener('change', e => {
    const input = e.target;
    if (!input.classList.contains('kg-input') || !draft) return;
    const exIdx = parseInt(input.dataset.ex, 10);
    const seriesIdx = parseInt(input.dataset.series, 10);
    const field = fieldsForExerciseId(draft.exercises[exIdx] ? draft.exercises[exIdx].id : '').find(f => f.key === input.dataset.field);
    const raw = field && field.unit === 'kg' ? inputToKg(input.value) : input.value;
    const r = setDraftValue(draft, exIdx, seriesIdx, input.dataset.field, raw);
    if (!r.ok) {
      input.setAttribute('aria-invalid', 'true');
      toast('Valor no válido', 'error');
      return;
    }
    input.removeAttribute('aria-invalid');
    const s = draft.exercises[exIdx].series[seriesIdx];
    input.value = r.value === null ? '' : String(field && field.unit === 'kg' ? kgToDisplay(r.value) : r.value);
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
    toast(`${loaded.rejected.length} registros guardados no eran válidos y se han apartado.`, 'error');
  }
  if (loaded.source === 'v1') saveData();

  applyAppearance();
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
