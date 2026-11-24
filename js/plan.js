// Plan de entrenamiento: biblioteca de ejercicios y rutinas. Sin acceso al DOM ni al almacenamiento.
//
// Plan    = { planVersion: 1, exercises: LibraryExercise[], routines: Routine[] }
// LibraryExercise = { id, name, type, muscles: string[], fields?: Field[], archived?: true }
// Routine = { id, name, emoji, duration, archived?: true, exercises: RoutineEntry[] }
// RoutineEntry = { exerciseId, note, series: [{ reps, rest, drop? }] }
//
// El historial se enlaza por id (sesión → routine.id, ejercicio → LibraryExercise.id), nunca por nombre:
// renombrar no rompe nada y un ejercicio o rutina con historial no se borra, se archiva.
//
// El plan activo vive en este módulo. Por defecto es DEFAULT_ROUTINES (el plan original); app.js lo
// sustituye al arrancar con el guardado en gymtracker.plan. Las consultas devuelven vistas "resueltas"
// (cada ejercicio de una rutina con los datos de la biblioteca), con la misma forma que el plan antiguo.
//
// fields: qué se apunta en cada serie y en qué campo del esquema v2 se guarda.
// Por defecto kg + reps. Las superseries declaran sus dos campos en el mismo orden que
// las etiquetas de la v1 (weight, weight2), lo que permite al lector v1 reubicar las reps
// que la v1 guardaba como kg.
export const PLAN_VERSION = 1;
const KG = { key: 'weight', unit: 'kg', label: 'kg' };
const REPS = { key: 'repsDone', unit: 'reps', label: 'reps' };
export const DEFAULT_FIELDS = [KG, REPS];

const s = (reps, rest, drop) => (drop ? { reps, rest, drop: true } : { reps, rest });
const rep = (n, reps, rest) => Array.from({ length: n }, () => s(reps, rest));

const DEFAULT_ROUTINES = [
  {
    id: 'pecho-hombro', name: 'Sesión 1: Pecho + Hombro', emoji: '🏋️', duration: 75,
    exercises: [
      { id: 'press-banca-mancuernas', muscles: ['pecho'], name: 'Press banca mancuernas', type: 'traditional', series: rep(4, '8-10', 90), note: '4×8-10 · 90s descanso' },
      { id: 'press-inclinado-mancuernas', muscles: ['pecho'], name: 'Press inclinado mancuernas', type: 'dropset', series: [...rep(3, '10-12', 90), s('10-12 DROP', 180, true)], note: 'Drop set última serie · -25% → fallo · 2-3 min post' },
      { id: 'aperturas-polea-alta', muscles: ['pecho'], name: 'Aperturas polea alta', type: 'myoreps', series: [s('15-20 (activ.)', 15), s('5 (mini)', 15), s('5 (mini)', 15), s('3-5 (mini)', 0)], note: 'Myo-reps · Total: 25-30 reps' },
      { id: 'aperturas-polea-baja', muscles: ['pecho'], name: 'Aperturas polea baja sentado', type: 'traditional', series: rep(3, '12-15', 75), note: '3×12-15 · 75s descanso' },
      { id: 'press-militar-mancuernas', muscles: ['hombro'], name: 'Press militar mancuernas', type: 'myoreps', series: [s('12 (activ.)', 15), s('4-5 (mini)', 15), s('3-4 (mini)', 15), s('3 (mini)', 0)], note: 'Myo-reps · Total: 22-24 reps' },
      { id: 'elevaciones-frontales', muscles: ['hombro'], name: 'Elevaciones frontales mancuernas', type: 'traditional', series: rep(3, '10-12', 60), note: '3×10-12 · 60s descanso' },
    ],
  },
  {
    id: 'pierna', name: 'Sesión 2: Pierna', emoji: '🦵', duration: 75,
    exercises: [
      { id: 'peso-muerto', muscles: ['femoral'], name: 'Peso muerto', type: 'traditional', series: rep(4, '6-8', 165), note: '4×6-8 · 2.5-3 min descanso' },
      { id: 'prensa', muscles: ['cuadriceps'], name: 'Prensa', type: 'dropset', series: [...rep(3, '10-12', 120), s('10-12 DROP', 180, true)], note: 'Drop set última serie · -30% · 3 min post' },
      {
        id: 'ss-extension-curl-femoral', muscles: ['cuadriceps', 'femoral'], name: 'Superserie: Extensión cuádriceps + Curl femoral', type: 'superset',
        series: rep(3, '12-15 / 12-15', 90), note: 'Sin descanso entre ejercicios · 90s entre rondas',
        fields: [{ key: 'weight', unit: 'kg', label: 'Extensión' }, { key: 'weight2', unit: 'kg', label: 'Curl femoral' }],
      },
      { id: 'sentadilla-bulgara', muscles: ['cuadriceps'], name: 'Sentadilla búlgara con giro', type: 'traditional', series: rep(3, '10×pierna', 90), note: '3×10 por pierna · 90s entre piernas' },
      { id: 'gemelos', muscles: ['gemelos'], name: 'Gemelos', type: 'myoreps', series: [s('20 (activ.)', 15), s('6-8 (mini)', 15), s('5-6 (mini)', 15), s('4-5 (mini)', 0)], note: 'Myo-reps · Total: 35-40 reps' },
    ],
  },
  {
    id: 'espalda-biceps', name: 'Sesión 3: Espalda + Bíceps', emoji: '💪', duration: 70,
    exercises: [
      {
        id: 'ss-dominadas-press-cerrado', muscles: ['espalda', 'triceps'], name: 'Superserie: Dominadas + Press cerrado/Fondos', type: 'superset',
        series: rep(4, '8-10 / 10-12', 90), note: 'Antagonista · 4 rondas · 90s',
        fields: [{ key: 'repsDone', unit: 'reps', label: 'Dominadas' }, { key: 'weight', unit: 'kg', label: 'Press/Fondos' }],
      },
      { id: 'remo-barra', muscles: ['espalda'], name: 'Remo barra', type: 'dropset', series: [...rep(3, '8-10', 120), s('8-10 DROP', 0, true)], note: 'Drop set última serie · -20% → fallo' },
      { id: 'remo-maquina', muscles: ['espalda'], name: 'Remo máquina', type: 'traditional', series: rep(3, '10-12', 90), note: '3×10-12 · 90s descanso' },
      {
        id: 'ss-curl-biceps-martillo', muscles: ['biceps'], name: 'Superserie: Curl bíceps + Curl martillo', type: 'superset',
        series: rep(3, '10-12 / 10-12', 75), note: 'Sin descanso entre ejercicios · 75s entre rondas',
        fields: [{ key: 'weight', unit: 'kg', label: 'Curl bíceps' }, { key: 'weight2', unit: 'kg', label: 'Curl martillo' }],
      },
    ],
  },
  {
    id: 'pecho-triceps-core', name: 'Sesión 4: Pecho Extra + Tríceps + Core ⭐', emoji: '🔥', duration: 60,
    exercises: [
      { id: 'press-inclinado-barra', muscles: ['pecho'], name: 'Press banca inclinado barra/máquina', type: 'dropset', series: [...rep(2, '10-12', 120), s('10-12 DROP', 0, true)], note: 'Drop set última serie · -25% → fallo' },
      { id: 'cruces-polea-media', muscles: ['pecho'], name: 'Cruces polea media', type: 'myoreps', series: [s('15 (activ.)', 15), s('5 (mini)', 15), s('4-5 (mini)', 15), s('3-4 (mini)', 0)], note: 'Myo-reps · Total: 27-29 reps' },
      {
        id: 'ss-triceps-flexiones', muscles: ['triceps', 'pecho'], name: 'Superserie: Tríceps polea + Flexiones explosivas', type: 'superset',
        series: rep(3, '12/brazo + máx', 90), note: '3 rondas · 90s descanso',
        fields: [{ key: 'weight', unit: 'kg', label: 'Tríceps' }, { key: 'repsDone', unit: 'reps', label: 'Flexiones' }],
      },
      { id: 'press-frances-mancuernas', muscles: ['triceps'], name: 'Press francés mancuernas', type: 'myoreps', series: [s('12-15 (activ.)', 15), s('5 (mini)', 15), s('4-5 (mini)', 15), s('3-4 (mini)', 0)], note: 'Myo-reps' },
      { id: 'core-circuito', muscles: ['core'], name: 'Core: Plancha + Dead bug + Pallof press', type: 'circuit', series: [s('45s/12r/10×lado', 120), s('45s/12r/10×lado', 120), s('45s/12r/10×lado', 0)], note: 'Circuito · 2-3 rondas · 2 min entre rondas' },
    ],
  },
];

// Grupos musculares del mapa ejercicio → músculo (campo `muscles` de cada ejercicio).
// Una serie hecha cuenta como una serie para cada músculo listado; un ejercicio sin mapa no cuenta.
export const MUSCLES = [
  { id: 'pecho', label: 'Pecho' },
  { id: 'espalda', label: 'Espalda' },
  { id: 'hombro', label: 'Hombro' },
  { id: 'biceps', label: 'Bíceps' },
  { id: 'triceps', label: 'Tríceps' },
  { id: 'cuadriceps', label: 'Cuádriceps' },
  { id: 'femoral', label: 'Femoral y glúteo' },
  { id: 'gemelos', label: 'Gemelos' },
  { id: 'core', label: 'Core' },
];

export const BADGE = {
  traditional: { label: 'Tradicional' },
  dropset:     { label: 'Drop Set' },
  myoreps:     { label: 'Myo-reps' },
  superset:    { label: 'Superserie' },
  circuit:     { label: 'Circuito' },
};

const clone = v => JSON.parse(JSON.stringify(v));

// Convierte la forma antigua (ejercicios completos dentro de cada sesión) en biblioteca + rutinas.
function fromLegacy(list) {
  const exercises = [];
  const seen = new Set();
  const routines = list.map(p => ({
    id: p.id, name: p.name, emoji: p.emoji, duration: p.duration,
    exercises: p.exercises.map(ex => {
      if (!seen.has(ex.id)) {
        seen.add(ex.id);
        const lib = { id: ex.id, name: ex.name, type: ex.type, muscles: [...ex.muscles] };
        if (ex.fields) lib.fields = clone(ex.fields);
        exercises.push(lib);
      }
      return { exerciseId: ex.id, note: ex.note, series: clone(ex.series) };
    }),
  }));
  return { planVersion: PLAN_VERSION, exercises, routines };
}

// Plan por defecto (copia nueva en cada llamada).
export function defaultPlan() {
  return fromLegacy(DEFAULT_ROUTINES);
}

// ==================== PLAN ACTIVO ====================
let active = null;
let library = new Map();
let routines = [];

// Vista de una rutina: { id, name, emoji, duration, archived, exercises: [{ ...biblioteca, series, note }] }.
function resolveRoutine(r) {
  return {
    id: r.id, name: r.name, emoji: r.emoji, duration: r.duration, archived: !!r.archived,
    exercises: r.exercises.map(e => {
      const lib = library.get(e.exerciseId);
      return { ...lib, archived: !!lib.archived, series: e.series, note: e.note };
    }),
  };
}

// Fija el plan activo. Debe llegar validado (routines.js → validatePlan); no se copia.
export function setActivePlan(plan) {
  active = plan;
  library = new Map(plan.exercises.map(e => [e.id, e]));
  routines = plan.routines.map(resolveRoutine);
}

export function getActivePlan() {
  return active;
}

setActivePlan(defaultPlan());

// Rutinas resueltas, en orden. Por defecto sin las archivadas.
export function planSessions({ archived = false } = {}) {
  return archived ? routines : routines.filter(r => !r.archived);
}

// Ejercicios de la biblioteca (datos crudos), en orden. Por defecto sin los archivados.
export function libraryExercises({ archived = false } = {}) {
  return archived ? active.exercises : active.exercises.filter(e => !e.archived);
}

export function findLibraryExercise(id) {
  return library.get(id) || null;
}

// Búsqueda por nombre sin distinguir mayúsculas; incluye archivados (así un nombre conocido reusa su id).
export function findLibraryExerciseByName(name) {
  const n = String(name).trim().toLowerCase();
  return active.exercises.find(e => e.name.toLowerCase() === n) || null;
}

// Rutina por id, incluidas las archivadas (el historial y el borrador las siguen necesitando).
export function getPlanSession(id) {
  return routines.find(p => p.id === id) || null;
}

// Lector v1: la v1 guardaba el nombre de la sesión. Se busca en el plan activo y luego en el original.
export function findPlanSessionByName(name) {
  const hit = routines.find(p => p.name === name);
  if (hit) return hit;
  const legacy = DEFAULT_ROUTINES.find(p => p.name === name);
  return legacy ? { ...legacy, archived: false } : null;
}

// Ejercicio por id con series y nota de la primera rutina activa que lo usa (o de una archivada).
// Si no está en ninguna rutina, series vacías. null si no está en la biblioteca.
export function findPlanExercise(id) {
  const lib = library.get(id);
  if (!lib) return null;
  const inRoutine = r => r.exercises.find(e => e.id === id);
  for (const r of [...routines.filter(x => !x.archived), ...routines.filter(x => x.archived)]) {
    const ex = inRoutine(r);
    if (ex) return ex;
  }
  return { ...lib, archived: !!lib.archived, series: [], note: '' };
}

// Ejercicio dentro de una rutina concreta (series y nota de esa rutina) o, si no está, el general.
export function routineExercise(routineId, id) {
  const r = getPlanSession(routineId);
  return (r && r.exercises.find(e => e.id === id)) || findPlanExercise(id);
}

export function fieldsFor(ex) {
  return (ex && Array.isArray(ex.fields)) ? ex.fields : DEFAULT_FIELDS;
}

// Músculos de un ejercicio por id (vacío si no está en la biblioteca).
export function musclesOf(exerciseId) {
  const ex = library.get(exerciseId);
  return ex && Array.isArray(ex.muscles) ? ex.muscles : [];
}
