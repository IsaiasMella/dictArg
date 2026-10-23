/**
 * Las cuentas del panel, separadas de la pantalla que las muestra.
 *
 * Acá no hay JSX ni acceso a la base: entra la lista de dictados y sale todo
 * calculado. Es la parte que conviene poder mirar sola cuando un número parezca
 * raro.
 */

import { costOf } from "./pricing";
import type { UsageRow } from "./db";

/**
 * Velocidad de tipeo con la que se compara el dictado, en palabras por minuto.
 *
 * 40 es lo que escribe alguien cómodo con el teclado que no es tipista. Está
 * elegido tirando para abajo a propósito: el número que sale de acá es "cuánto
 * tiempo te ahorraste", y prefiero que sea conservador y creíble antes que
 * halagador. Cambiar esta constante cambia ese cartel y nada más.
 */
export const TYPING_WPM = 40;

export interface Period {
  dictations: number;
  seconds: number;
  words: number;
  cost: number;
}

export interface Bucket {
  label: string;
  value: number;
}

export interface ModelUse {
  model: string;
  dictations: number;
  seconds: number;
  cost: number;
}

export interface MonthUse {
  month: string;
  dictations: number;
  seconds: number;
  cost: number;
}

export interface Metrics {
  /** Totales de todo lo que hay guardado. */
  total: Period;
  today: Period;
  week: Period;
  month: Period;

  /** Fecha del dictado más viejo que sobrevive en el historial. */
  firstAt: Date;
  lastAt: Date;
  /** Días transcurridos desde el primer dictado, contando hoy. */
  daysSinceFirst: number;
  /** Días distintos con al menos un dictado. */
  activeDays: number;
  /** Días seguidos dictando hasta hoy. */
  streak: number;
  /** El día que más dictaste. */
  bestDay: { day: string; dictations: number; seconds: number };

  /** Duración de los dictados, en segundos. */
  averageSeconds: number;
  medianSeconds: number;
  longestSeconds: number;

  /** Palabras por minuto de audio: a qué velocidad hablás. */
  wordsPerMinute: number;
  /** Horas que habrías tardado tipeando esas mismas palabras. */
  typingHours: number;
  /** Esas horas menos las que pasaste dictando. */
  savedHours: number;
  /** Costo cada mil palabras dictadas. */
  costPerThousandWords: number;

  /** Costo por mes al ritmo de los últimos días. */
  projectedMonthlyCost: number;
  /** Sobre cuántos días se calculó esa proyección. */
  projectionDays: number;
  /** Dictados por día, entre los días en que dictaste. */
  perActiveDay: number;
  /** Segundos de audio por día, entre los días en que dictaste. */
  secondsPerActiveDay: number;

  durations: Bucket[];
  hours: Bucket[];
  weekdays: Bucket[];
  models: ModelUse[];
  months: MonthUse[];
}

const EMPTY_PERIOD: Period = { dictations: 0, seconds: 0, words: 0, cost: 0 };

/** `YYYY-MM-DD` del día local: la clave con la que se agrupa por día. */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Medianoche local de `date`, que es donde empieza y termina un "día". */
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function accumulate(target: Period, row: UsageRow): void {
  target.dictations += 1;
  target.seconds += row.seconds;
  target.words += row.words;
  target.cost += costOf(row.seconds, row.model);
}

/**
 * Días calendario hacia atrás, incluyendo hoy.
 *
 * "Últimos 7 días" son los últimos siete días del almanaque y no las últimas
 * 168 horas: es lo que la persona quiere decir cuando pregunta cuánto usó la
 * herramienta esta semana.
 */
function since(days: number, now: Date): Date {
  const start = startOfDay(now);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

export function computeMetrics(rows: UsageRow[], now = new Date()): Metrics | null {
  if (rows.length === 0) return null;

  const total: Period = { ...EMPTY_PERIOD };
  const today: Period = { ...EMPTY_PERIOD };
  const week: Period = { ...EMPTY_PERIOD };
  const month: Period = { ...EMPTY_PERIOD };

  const todayStart = startOfDay(now);
  const weekStart = since(7, now);
  const monthStart = since(30, now);

  const byDay = new Map<string, { dictations: number; seconds: number }>();
  const byModel = new Map<string, ModelUse>();
  const byMonth = new Map<string, MonthUse>();
  const hours = new Array(24).fill(0);
  // Lunes primero, que es como se lee una semana en español.
  const weekdays = new Array(7).fill(0);
  const durations = [0, 0, 0, 0];
  const lengths: number[] = [];

  // Se inicializan en null y se llenan con la primera fecha **válida**.
  //
  // Antes arrancaban con `new Date(rows[0].createdAt)` sin validar. Un `created_at`
  // corrupto en la primera fila dejaba `firstAt` en `Invalid Date`, y a partir de ahí
  // todas las comparaciones daban falso en silencio: `daysSinceFirst` quedaba `NaN` y
  // se propagaba a la proyección de costo y a la adherencia del informe.
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;

  for (const row of rows) {
    const at = new Date(row.createdAt);
    if (Number.isNaN(at.getTime())) continue;

    if (firstAt === null || at < firstAt) firstAt = at;
    if (lastAt === null || at > lastAt) lastAt = at;

    accumulate(total, row);
    if (at >= todayStart) accumulate(today, row);
    if (at >= weekStart) accumulate(week, row);
    if (at >= monthStart) accumulate(month, row);

    const key = dayKey(at);
    const day = byDay.get(key) ?? { dictations: 0, seconds: 0 };
    day.dictations += 1;
    day.seconds += row.seconds;
    byDay.set(key, day);

    const cost = costOf(row.seconds, row.model);

    const model = byModel.get(row.model) ?? {
      model: row.model || "(sin registrar)",
      dictations: 0,
      seconds: 0,
      cost: 0,
    };
    model.dictations += 1;
    model.seconds += row.seconds;
    model.cost += cost;
    byModel.set(row.model, model);

    const mKey = monthKey(at);
    const entry = byMonth.get(mKey) ?? { month: mKey, dictations: 0, seconds: 0, cost: 0 };
    entry.dictations += 1;
    entry.seconds += row.seconds;
    entry.cost += cost;
    byMonth.set(mKey, entry);

    hours[at.getHours()] += 1;
    weekdays[(at.getDay() + 6) % 7] += 1;

    if (row.seconds < 10) durations[0] += 1;
    else if (row.seconds < 30) durations[1] += 1;
    else if (row.seconds < 60) durations[2] += 1;
    else durations[3] += 1;

    lengths.push(row.seconds);
  }

  lengths.sort((a, b) => a - b);
  const middle = Math.floor(lengths.length / 2);
  const medianSeconds =
    lengths.length % 2 === 0
      ? (lengths[middle - 1] + lengths[middle]) / 2
      : lengths[middle];

  // Todas las filas tenían la fecha rota: no hay ninguna métrica que se pueda
  // calcular sobre eso, y devolver `null` es más honesto que devolver ceros que se
  // leen como "no usaste la app".
  if (firstAt === null || lastAt === null) return null;

  const daysSinceFirst =
    Math.round((startOfDay(now).getTime() - startOfDay(firstAt).getTime()) / 86_400_000) + 1;

  // La racha sigue viva mientras no se saltee un día entero: si hoy todavía no
  // dictaste, se cuenta desde ayer. Cortarla a la medianoche sería castigar por
  // no haber empezado el día dictando.
  const cursor = startOfDay(now);
  if (!byDay.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (byDay.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  let bestDay = { day: "", dictations: 0, seconds: 0 };
  for (const [day, value] of byDay) {
    if (value.dictations > bestDay.dictations) {
      bestDay = { day, dictations: value.dictations, seconds: value.seconds };
    }
  }

  // La proyección se divide por los días que la app estuvo instalada, no por 30
  // fijos: recién instalada, dividir tres días de uso por treinta da un número
  // diez veces más chico que la realidad y la proyección deja de servir para
  // decidir nada. Con más de un mes encima, las dos cuentas son la misma.
  const projectionDays = Math.min(30, Math.max(1, daysSinceFirst));

  const minutes = total.seconds / 60;
  const wordsPerMinute = minutes > 0 ? total.words / minutes : 0;
  const typingHours = total.words / TYPING_WPM / 60;
  const activeDays = byDay.size;

  return {
    total,
    today,
    week,
    month,
    firstAt,
    lastAt,
    daysSinceFirst,
    activeDays,
    streak,
    bestDay,
    averageSeconds: total.dictations > 0 ? total.seconds / total.dictations : 0,
    medianSeconds,
    longestSeconds: lengths[lengths.length - 1] ?? 0,
    wordsPerMinute,
    typingHours,
    savedHours: Math.max(0, typingHours - total.seconds / 3600),
    costPerThousandWords: total.words > 0 ? (total.cost / total.words) * 1000 : 0,
    projectedMonthlyCost: (month.cost / projectionDays) * 30.4,
    projectionDays,
    perActiveDay: activeDays > 0 ? total.dictations / activeDays : 0,
    // Se divide por los días con uso y no por los transcurridos: el número que
    // contesta "cuánto grabo por día" es el de los días en que efectivamente se dicta.
    // Contra los días corridos, un fin de semana sin trabajar lo hunde a la mitad.
    secondsPerActiveDay: activeDays > 0 ? total.seconds / activeDays : 0,
    durations: [
      { label: "menos de 10 s", value: durations[0] },
      { label: "10 a 30 s", value: durations[1] },
      { label: "30 a 60 s", value: durations[2] },
      { label: "más de 1 min", value: durations[3] },
    ],
    hours: hours.map((value, hour) => ({ label: `${hour}`, value })),
    weekdays: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((label, index) => ({
      label,
      value: weekdays[index],
    })),
    models: [...byModel.values()].sort((a, b) => b.seconds - a.seconds),
    months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)),
  };
}
