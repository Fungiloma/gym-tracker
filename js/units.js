// Unidades de peso. Todo se guarda en kg; la unidad elegida solo cambia lo que se ve y lo que se escribe.
// El estado es del módulo (una unidad activa para toda la app) para no pasarla por cada función de formato.
export const KG_PER_LB = 0.45359237;
export const UNITS = ['kg', 'lb'];

let unit = 'kg';

export function setUnit(u) {
  unit = u === 'lb' ? 'lb' : 'kg';
}

export function getUnit() {
  return unit;
}

export function unitLabel() {
  return unit;
}

const round = (n, decimals) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

export function kgToLb(kg) {
  return kg / KG_PER_LB;
}

// lb → kg con 4 decimales (0,1 g): suficiente para que 100 lb vuelva a verse como 100 lb.
export function lbToKg(lb) {
  return round(lb * KG_PER_LB, 4);
}

// Valor de kg tal como se muestra en la unidad activa: kg tal cual, lb con un decimal.
export function kgToDisplay(kg) {
  if (typeof kg !== 'number' || !Number.isFinite(kg)) return kg;
  return unit === 'lb' ? round(kgToLb(kg), 1) : kg;
}

// Lo que escribe el usuario en la unidad activa → kg (number). Texto no numérico se devuelve igual
// para que la validación del esquema lo rechace.
export function inputToKg(raw) {
  if (unit === 'kg') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? lbToKg(raw) : raw;
  if (typeof raw !== 'string') return raw;
  const t = raw.trim().replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return raw;
  return lbToKg(Number(t));
}

// Peso en la unidad activa, como texto sin unidad ("22.5", "49.6").
export function fmtWeightNum(kg) {
  return String(kgToDisplay(kg));
}

// Peso con unidad ("22.5 kg").
export function fmtWeight(kg) {
  return `${fmtWeightNum(kg)} ${unit}`;
}

// Incremento de carga de la regla de sobrecarga, en kg: 2,5 kg o 5 lb.
export function progressionStepKg(u = unit) {
  return u === 'lb' ? lbToKg(5) : 2.5;
}
