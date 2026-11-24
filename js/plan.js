// Plan de entrenamiento: datos estáticos, sin acceso al DOM.
// Sesiones y ejercicios llevan ids estables: el historial se enlaza por id, no por nombre.
//
// fields: qué se apunta en cada serie y en qué campo del esquema v2 se guarda.
// Por defecto kg + reps. Las superseries declaran sus dos campos en el mismo orden que
// las etiquetas de la v1 (weight, weight2), lo que permite al lector v1 reubicar las reps
// que la v1 guardaba como kg.
const KG = { key: 'weight', unit: 'kg', label: 'kg' };
const REPS = { key: 'repsDone', unit: 'reps', label: 'reps' };
export const DEFAULT_FIELDS = [KG, REPS];

const s = (reps, rest, drop) => (drop ? { reps, rest, drop: true } : { reps, rest });
const rep = (n, reps, rest) => Array.from({ length: n }, () => s(reps, rest));

export const PLAN = [
  {
    id: 'pecho-hombro', name: 'Sesión 1: Pecho + Hombro', emoji: '🏋️', duration: 75,
    exercises: [
      { id: 'press-banca-mancuernas', name: 'Press banca mancuernas', type: 'traditional', series: rep(4, '8-10', 90), note: '4×8-10 · 90s descanso' },
      { id: 'press-inclinado-mancuernas', name: 'Press inclinado mancuernas', type: 'dropset', series: [...rep(3, '10-12', 90), s('10-12 DROP', 180, true)], note: 'Drop set última serie · -25% → fallo · 2-3 min post' },
      { id: 'aperturas-polea-alta', name: 'Aperturas polea alta', type: 'myoreps', series: [s('15-20 (activ.)', 15), s('5 (mini)', 15), s('5 (mini)', 15), s('3-5 (mini)', 0)], note: 'Myo-reps · Total: 25-30 reps' },
      { id: 'aperturas-polea-baja', name: 'Aperturas polea baja sentado', type: 'traditional', series: rep(3, '12-15', 75), note: '3×12-15 · 75s descanso' },
      { id: 'press-militar-mancuernas', name: 'Press militar mancuernas', type: 'myoreps', series: [s('12 (activ.)', 15), s('4-5 (mini)', 15), s('3-4 (mini)', 15), s('3 (mini)', 0)], note: 'Myo-reps · Total: 22-24 reps' },
      { id: 'elevaciones-frontales', name: 'Elevaciones frontales mancuernas', type: 'traditional', series: rep(3, '10-12', 60), note: '3×10-12 · 60s descanso' },
    ],
  },
  {
    id: 'pierna', name: 'Sesión 2: Pierna', emoji: '🦵', duration: 75,
    exercises: [
      { id: 'peso-muerto', name: 'Peso muerto', type: 'traditional', series: rep(4, '6-8', 165), note: '4×6-8 · 2.5-3 min descanso' },
      { id: 'prensa', name: 'Prensa', type: 'dropset', series: [...rep(3, '10-12', 120), s('10-12 DROP', 180, true)], note: 'Drop set última serie · -30% · 3 min post' },
      {
        id: 'ss-extension-curl-femoral', name: 'Superserie: Extensión cuádriceps + Curl femoral', type: 'superset',
        series: rep(3, '12-15 / 12-15', 90), note: 'Sin descanso entre ejercicios · 90s entre rondas',
        fields: [{ key: 'weight', unit: 'kg', label: 'Extensión' }, { key: 'weight2', unit: 'kg', label: 'Curl femoral' }],
      },
      { id: 'sentadilla-bulgara', name: 'Sentadilla búlgara con giro', type: 'traditional', series: rep(3, '10×pierna', 90), note: '3×10 por pierna · 90s entre piernas' },
      { id: 'gemelos', name: 'Gemelos', type: 'myoreps', series: [s('20 (activ.)', 15), s('6-8 (mini)', 15), s('5-6 (mini)', 15), s('4-5 (mini)', 0)], note: 'Myo-reps · Total: 35-40 reps' },
    ],
  },
  {
    id: 'espalda-biceps', name: 'Sesión 3: Espalda + Bíceps', emoji: '💪', duration: 70,
    exercises: [
      {
        id: 'ss-dominadas-press-cerrado', name: 'Superserie: Dominadas + Press cerrado/Fondos', type: 'superset',
        series: rep(4, '8-10 / 10-12', 90), note: 'Antagonista · 4 rondas · 90s',
        fields: [{ key: 'repsDone', unit: 'reps', label: 'Dominadas' }, { key: 'weight', unit: 'kg', label: 'Press/Fondos' }],
      },
      { id: 'remo-barra', name: 'Remo barra', type: 'dropset', series: [...rep(3, '8-10', 120), s('8-10 DROP', 0, true)], note: 'Drop set última serie · -20% → fallo' },
      { id: 'remo-maquina', name: 'Remo máquina', type: 'traditional', series: rep(3, '10-12', 90), note: '3×10-12 · 90s descanso' },
      {
        id: 'ss-curl-biceps-martillo', name: 'Superserie: Curl bíceps + Curl martillo', type: 'superset',
        series: rep(3, '10-12 / 10-12', 75), note: 'Sin descanso entre ejercicios · 75s entre rondas',
        fields: [{ key: 'weight', unit: 'kg', label: 'Curl bíceps' }, { key: 'weight2', unit: 'kg', label: 'Curl martillo' }],
      },
    ],
  },
  {
    id: 'pecho-triceps-core', name: 'Sesión 4: Pecho Extra + Tríceps + Core ⭐', emoji: '🔥', duration: 60,
    exercises: [
      { id: 'press-inclinado-barra', name: 'Press banca inclinado barra/máquina', type: 'dropset', series: [...rep(2, '10-12', 120), s('10-12 DROP', 0, true)], note: 'Drop set última serie · -25% → fallo' },
      { id: 'cruces-polea-media', name: 'Cruces polea media', type: 'myoreps', series: [s('15 (activ.)', 15), s('5 (mini)', 15), s('4-5 (mini)', 15), s('3-4 (mini)', 0)], note: 'Myo-reps · Total: 27-29 reps' },
      {
        id: 'ss-triceps-flexiones', name: 'Superserie: Tríceps polea + Flexiones explosivas', type: 'superset',
        series: rep(3, '12/brazo + máx', 90), note: '3 rondas · 90s descanso',
        fields: [{ key: 'weight', unit: 'kg', label: 'Tríceps' }, { key: 'repsDone', unit: 'reps', label: 'Flexiones' }],
      },
      { id: 'press-frances-mancuernas', name: 'Press francés mancuernas', type: 'myoreps', series: [s('12-15 (activ.)', 15), s('5 (mini)', 15), s('4-5 (mini)', 15), s('3-4 (mini)', 0)], note: 'Myo-reps' },
      { id: 'core-circuito', name: 'Core: Plancha + Dead bug + Pallof press', type: 'circuit', series: [s('45s/12r/10×lado', 120), s('45s/12r/10×lado', 120), s('45s/12r/10×lado', 0)], note: 'Circuito · 2-3 rondas · 2 min entre rondas' },
    ],
  },
];

export const BADGE = {
  traditional: { label: 'Tradicional' },
  dropset:     { label: 'Drop Set' },
  myoreps:     { label: 'Myo-reps' },
  superset:    { label: 'Superserie' },
  circuit:     { label: 'Circuito' },
};

export function getPlanSession(id) {
  return PLAN.find(p => p.id === id) || null;
}

export function findPlanSessionByName(name) {
  return PLAN.find(p => p.name === name) || null;
}

// Busca un ejercicio por id en todo el plan (los ids son únicos entre sesiones).
export function findPlanExercise(id) {
  for (const p of PLAN) {
    const ex = p.exercises.find(e => e.id === id);
    if (ex) return ex;
  }
  return null;
}

export function fieldsFor(ex) {
  return (ex && Array.isArray(ex.fields)) ? ex.fields : DEFAULT_FIELDS;
}
