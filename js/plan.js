// Plan de entrenamiento: datos estáticos, sin acceso al DOM.
export const SUPERSET_LABELS = {
  "Superserie: Dominadas + Press cerrado/Fondos": ["Reps", "kg"],
  "Superserie: Extensión cuádriceps + Curl femoral": ["kg", "kg"],
  "Superserie: Curl bíceps + Curl martillo": ["kg", "kg"],
  "Superserie: Tríceps polea + Flexiones explosivas": ["kg", "Reps"],
};

export const PLAN = {
  "Sesión 1: Pecho + Hombro": [
    { name: "Press banca mancuernas", type: "traditional", series: [{ reps: "8-10", rest: 90 },{ reps: "8-10", rest: 90 },{ reps: "8-10", rest: 90 },{ reps: "8-10", rest: 90 }], note: "4×8-10 · 90s descanso" },
    { name: "Press inclinado mancuernas", type: "dropset", series: [{ reps: "10-12", rest: 90 },{ reps: "10-12", rest: 90 },{ reps: "10-12", rest: 90 },{ reps: "10-12 DROP", rest: 180, drop: true }], note: "Drop set última serie · -25% → fallo · 2-3 min post" },
    { name: "Aperturas polea alta", type: "myoreps", series: [{ reps: "15-20 (activ.)", rest: 15 },{ reps: "5 (mini)", rest: 15 },{ reps: "5 (mini)", rest: 15 },{ reps: "3-5 (mini)", rest: 0 }], note: "Myo-reps · Total: 25-30 reps" },
    { name: "Aperturas polea baja sentado", type: "traditional", series: [{ reps: "12-15", rest: 75 },{ reps: "12-15", rest: 75 },{ reps: "12-15", rest: 75 }], note: "3×12-15 · 75s descanso" },
    { name: "Press militar mancuernas", type: "myoreps", series: [{ reps: "12 (activ.)", rest: 15 },{ reps: "4-5 (mini)", rest: 15 },{ reps: "3-4 (mini)", rest: 15 },{ reps: "3 (mini)", rest: 0 }], note: "Myo-reps · Total: 22-24 reps" },
    { name: "Elevaciones frontales mancuernas", type: "traditional", series: [{ reps: "10-12", rest: 60 },{ reps: "10-12", rest: 60 },{ reps: "10-12", rest: 60 }], note: "3×10-12 · 60s descanso" },
  ],
  "Sesión 2: Pierna": [
    { name: "Peso muerto", type: "traditional", series: [{ reps: "6-8", rest: 165 },{ reps: "6-8", rest: 165 },{ reps: "6-8", rest: 165 },{ reps: "6-8", rest: 165 }], note: "4×6-8 · 2.5-3 min descanso" },
    { name: "Prensa", type: "dropset", series: [{ reps: "10-12", rest: 120 },{ reps: "10-12", rest: 120 },{ reps: "10-12", rest: 120 },{ reps: "10-12 DROP", rest: 180, drop: true }], note: "Drop set última serie · -30% · 3 min post" },
    { name: "Superserie: Extensión cuádriceps + Curl femoral", type: "superset", series: [{ reps: "12-15 / 12-15", rest: 90 },{ reps: "12-15 / 12-15", rest: 90 },{ reps: "12-15 / 12-15", rest: 90 }], note: "Sin descanso entre ejercicios · 90s entre rondas" },
    { name: "Sentadilla búlgara con giro", type: "traditional", series: [{ reps: "10×pierna", rest: 90 },{ reps: "10×pierna", rest: 90 },{ reps: "10×pierna", rest: 90 }], note: "3×10 por pierna · 90s entre piernas" },
    { name: "Gemelos", type: "myoreps", series: [{ reps: "20 (activ.)", rest: 15 },{ reps: "6-8 (mini)", rest: 15 },{ reps: "5-6 (mini)", rest: 15 },{ reps: "4-5 (mini)", rest: 0 }], note: "Myo-reps · Total: 35-40 reps" },
  ],
  "Sesión 3: Espalda + Bíceps": [
    { name: "Superserie: Dominadas + Press cerrado/Fondos", type: "superset", series: [{ reps: "8-10 / 10-12", rest: 90 },{ reps: "8-10 / 10-12", rest: 90 },{ reps: "8-10 / 10-12", rest: 90 },{ reps: "8-10 / 10-12", rest: 90 }], note: "Antagonista · 4 rondas · 90s" },
    { name: "Remo barra", type: "dropset", series: [{ reps: "8-10", rest: 120 },{ reps: "8-10", rest: 120 },{ reps: "8-10", rest: 120 },{ reps: "8-10 DROP", rest: 0, drop: true }], note: "Drop set última serie · -20% → fallo" },
    { name: "Remo máquina", type: "traditional", series: [{ reps: "10-12", rest: 90 },{ reps: "10-12", rest: 90 },{ reps: "10-12", rest: 90 }], note: "3×10-12 · 90s descanso" },
    { name: "Superserie: Curl bíceps + Curl martillo", type: "superset", series: [{ reps: "10-12 / 10-12", rest: 75 },{ reps: "10-12 / 10-12", rest: 75 },{ reps: "10-12 / 10-12", rest: 75 }], note: "Sin descanso entre ejercicios · 75s entre rondas" },
  ],
  "Sesión 4: Pecho Extra + Tríceps + Core ⭐": [
    { name: "Press banca inclinado barra/máquina", type: "dropset", series: [{ reps: "10-12", rest: 120 },{ reps: "10-12", rest: 120 },{ reps: "10-12 DROP", rest: 0, drop: true }], note: "Drop set última serie · -25% → fallo" },
    { name: "Cruces polea media", type: "myoreps", series: [{ reps: "15 (activ.)", rest: 15 },{ reps: "5 (mini)", rest: 15 },{ reps: "4-5 (mini)", rest: 15 },{ reps: "3-4 (mini)", rest: 0 }], note: "Myo-reps · Total: 27-29 reps" },
    { name: "Superserie: Tríceps polea + Flexiones explosivas", type: "superset", series: [{ reps: "12/brazo + máx", rest: 90 },{ reps: "12/brazo + máx", rest: 90 },{ reps: "12/brazo + máx", rest: 90 }], note: "3 rondas · 90s descanso" },
    { name: "Press francés mancuernas", type: "myoreps", series: [{ reps: "12-15 (activ.)", rest: 15 },{ reps: "5 (mini)", rest: 15 },{ reps: "4-5 (mini)", rest: 15 },{ reps: "3-4 (mini)", rest: 0 }], note: "Myo-reps" },
    { name: "Core: Plancha + Dead bug + Pallof press", type: "circuit", series: [{ reps: "45s/12r/10×lado", rest: 120 },{ reps: "45s/12r/10×lado", rest: 120 },{ reps: "45s/12r/10×lado", rest: 0 }], note: "Circuito · 2-3 rondas · 2 min entre rondas" },
  ],
};

export const BADGE = {
  traditional: { label: "Tradicional", color: "#3b82f6" },
  dropset:     { label: "Drop Set",    color: "#ef4444" },
  myoreps:     { label: "Myo-reps",    color: "#a855f7" },
  superset:    { label: "Superserie",  color: "#f59e0b" },
  circuit:     { label: "Circuito",    color: "#10b981" },
};

export const SESSION_KEYS = Object.keys(PLAN);

// Presentación de la home: emoji y duración estimada por sesión (mismo orden que PLAN).
export const SESSION_EMOJIS = ['🏋️', '🦵', '💪', '🔥'];
export const SESSION_DURATIONS = ['75', '75', '70', '60'];

// Datos iniciales de una sesión nueva: una fila por serie del plan, con los kg de la
// última sesión del mismo nombre precargados (comportamiento actual, se revisa en la fase 2).
export function buildSessionData(sessionName, sessions = []) {
  const data = {};
  (PLAN[sessionName] || []).forEach(ex => {
    data[ex.name] = ex.series.map(s => ({ reps: s.reps, weight: '', weight2: '' }));
  });

  const last = sessions
    .filter(s => s && s.session === sessionName)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (last && Array.isArray(last.exercises)) {
    last.exercises.forEach(ex => {
      if (!ex || !Object.hasOwn(data, ex.name) || !Array.isArray(ex.series)) return;
      ex.series.forEach((s, i) => {
        if (data[ex.name][i] && s) {
          data[ex.name][i].weight = s.weight || '';
          data[ex.name][i].weight2 = s.weight2 || '';
        }
      });
    });
  }
  return data;
}

// Descanso de la serie identificada por la clave "ejercicio-serie" del plan, o null.
export function restFor(sessionName, key) {
  const m = /^(\d+)-(\d+)$/.exec(String(key));
  if (!m) return null;
  const ex = (PLAN[sessionName] || [])[Number(m[1])];
  const s = ex && ex.series[Number(m[2])];
  return s && s.rest > 0 ? s.rest : null;
}
