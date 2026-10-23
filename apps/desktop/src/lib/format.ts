/**
 * Cómo se escriben los números y las fechas en la interfaz.
 *
 * Está separado para que el panel de métricas y el informe que se copia digan
 * exactamente lo mismo: si "1,25 h" en pantalla y "1.25 h" en el informe fueran
 * dos funciones distintas, tarde o temprano se despegan.
 *
 * Ya se habían despegado: `EntryRow` y `HomePanel` tenían cada uno su propia función
 * de duración, y `HistoryPanel` su propio `dayLabel`. Peor, algunas fijaban `"es-AR"`
 * y otras pasaban `undefined`, así que en una máquina configurada en inglés la misma
 * pantalla mezclaba "27 de agosto" con "August 27".
 *
 * **Nada de esto se formatea fuera de este archivo.** Si un caso necesita otro
 * formato —`1:30` en el historial es defendible— va como una función más acá, con
 * nombre propio, no como una copia local.
 *
 * Todo en español rioplatense: coma decimal y punto como separador de miles.
 */

/**
 * El único locale del producto.
 *
 * Fijo y no `undefined`: con `undefined` cada `toLocale*` usa el del sistema, y una
 * interfaz escrita entera en castellano terminaba mostrando fechas en inglés.
 */
export const LOCALE = "es-AR";

/** Entero con separador de miles: 9276 -> "9.276". */
export const num = (value: number) => Math.round(value).toLocaleString(LOCALE);

/** Decimal con coma: 1.25 -> "1,3". */
export const comma = (value: number, decimals = 1) =>
  value.toFixed(decimals).replace(".", ",");

/** Segundos en la unidad que se lea mejor. */
export function duration(seconds: number, empty = "—"): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return empty;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${comma(seconds / 60)} min`;
  return `${comma(seconds / 3600)} h`;
}

/** Horas sueltas, que abajo de una hora se leen mejor en minutos. */
export function hoursLabel(value: number, empty = "—"): string {
  if (!Number.isFinite(value) || value <= 0) return empty;
  if (value < 1) return `${Math.round(value * 60)} min`;
  return `${comma(value)} h`;
}

/** "27 de agosto". */
export const shortDate = (date: Date) =>
  date.toLocaleDateString(LOCALE, { day: "numeric", month: "long" });

/** "27/08/2026", para el informe: sin ambigüedad y corto. */
export const fullDate = (date: Date) =>
  date.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });

/** De la clave `YYYY-MM-DD` a "27 ago". */
export function dayLabel(key: string): string {
  if (!key) return "—";
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
  });
}

/** De la clave `YYYY-MM` a "agosto de 2026". */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(LOCALE, {
    month: "long",
    year: "numeric",
  });
}

/**
 * Duración en formato reloj: `90 -> "1:30"`.
 *
 * Convive con `duration` a propósito y no es una copia: en una fila del historial,
 * "1:30" se lee mejor que "1,5 min" porque se compara de un vistazo con las de
 * arriba y abajo. Lo que no puede pasar es que las dos existan sin que se sepa cuál
 * usar dónde, que era el estado anterior.
 */
export function clockDuration(seconds: number, empty = "—"): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return empty;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

/**
 * "14:35".
 *
 * `hour12: false` explícito: el CLDR de `es-AR` usa 12 horas por defecto, así que sin
 * esto la hora de cada fila del historial sale como "02:35 p. m." — cinco caracteres
 * más, en una columna angosta, y ambigua de un vistazo. Lo detectó un test al fijar
 * el locale, porque antes esta función pasaba `undefined` y tomaba el del sistema.
 */
export function timeOfDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * El encabezado de un día en el historial: "Hoy", "Ayer" o la fecha completa.
 *
 * Toma un `Date` y no una clave `YYYY-MM-DD` como `dayLabel`, porque acá la fecha
 * viene de un `created_at` que puede estar corrupto y hay que poder decirlo.
 */
export function relativeDayLabel(date: Date, now: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) return "";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) return "Hoy";
  if (date.toDateString() === yesterday.toDateString()) return "Ayer";

  return date.toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
}
