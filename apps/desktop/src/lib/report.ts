/**
 * El informe de uso que se copia al portapapeles.
 *
 * Vive separado de la pantalla por la misma razón que `metrics.ts`: es texto
 * generado a partir de números, sin nada de React adentro, y es la pieza que hay
 * que poder mirar sola cuando alguien pegue un informe que no cierra.
 */

import { comma, dayLabel, duration, fullDate, monthLabel, num } from "./format";
import { TYPING_WPM, type Metrics } from "./metrics";
import { formatUsd, ratePerHour } from "./pricing";

/**
 * El informe que se pega en un chat.
 *
 * Texto plano y sin tablas: el destino es WhatsApp o un mail, donde cualquier
 * alineación por espacios se rompe. Va cortado por meses porque no se pide todos
 * los meses —entre pedido y pedido pasan dos o tres—, y un total suelto no
 * dejaría ver si la persona lo usa cada vez más o lo abandonó en el camino.
 */
export function buildReport(m: Metrics, model: string, userName: string): string {
  const peakHour = topOf(m.hours);
  const peakDay = topOf(m.weekdays);
  const adherence = m.daysSinceFirst > 0 ? (m.activeDays / m.daysSinceFirst) * 100 : 0;

  const lines = [
    "INFORME DE USO DE VOICE",
    `Usuario: ${userName.trim() || "(sin nombre configurado)"}`,
    `Generado: ${fullDate(new Date())}`,
    "",
    "— RESUMEN —",
    `Dictados: ${num(m.total.dictations)}`,
    `Audio: ${duration(m.total.seconds, "0 s")} (${num(m.total.seconds)} s)`,
    `Palabras: ${num(m.total.words)}`,
    `Costo de API: ${formatUsd(m.total.cost)}`,
    `Proyección mensual: ${formatUsd(m.projectedMonthlyCost)} (sobre ${m.projectionDays} días)`,
    "",
    "— CUÁNDO —",
    `Primer dictado: ${fullDate(m.firstAt)}`,
    `Último dictado: ${fullDate(m.lastAt)}`,
    `Días desde el primero: ${num(m.daysSinceFirst)}`,
    `Días con uso: ${num(m.activeDays)} de ${num(m.daysSinceFirst)} (${Math.round(adherence)}%)`,
    `Días seguidos ahora: ${num(m.streak)}`,
    `Dictados por día activo: ${comma(m.perActiveDay)}`,
    `Día que más usó: ${dayLabel(m.bestDay.day)} — ${num(m.bestDay.dictations)} dictados, ${duration(m.bestDay.seconds, "0 s")}`,
    `Franja del día más usada: ${peakHour.label} h (${num(peakHour.value)} dictados)`,
    `Día de semana más usado: ${peakDay.label} (${num(peakDay.value)} dictados)`,
    "",
    "— PERÍODOS —",
    period("Últimos 7 días", m.week),
    period("Últimos 30 días", m.month),
    period("Todo", m.total),
    "",
    "— POR MES —",
    ...m.months.map(
      (month) =>
        `${monthLabel(month.month)}: ${num(month.dictations)} dictados, ${duration(month.seconds, "0 s")}, ${formatUsd(month.cost)}`,
    ),
    "",
    "— DICTADOS —",
    `Duración promedio: ${duration(m.averageSeconds, "0 s")}`,
    `Mediana: ${duration(m.medianSeconds, "0 s")}`,
    `El más largo: ${duration(m.longestSeconds, "0 s")}`,
    ...m.durations.map((bucket) => `  ${bucket.label}: ${num(bucket.value)}`),
    `Velocidad al hablar: ${num(m.wordsPerMinute)} palabras por minuto`,
    `Tiempo ahorrado contra tipear a ${TYPING_WPM} ppm: ${duration(m.savedHours * 3600, "0 s")}`,
    "",
    "— MODELOS —",
    `Configurado ahora: ${model}`,
    ...m.models.map(
      (used) =>
        `${used.model} (US$${ratePerHour(used.model)}/h): ${num(used.dictations)} dictados, ${duration(used.seconds, "0 s")}, ${formatUsd(used.cost)}`,
    ),
  ];

  return lines.join("\n");
}

function period(label: string, value: Metrics["total"]): string {
  const average = value.dictations > 0 ? value.seconds / value.dictations : 0;
  return `${label}: ${num(value.dictations)} dictados, ${duration(value.seconds, "0 s")}, promedio ${duration(average, "0 s")}, ${formatUsd(value.cost)}`;
}

/** El cubo con más dictados, para no pegar los 24 en un chat. */
function topOf(buckets: { label: string; value: number }[]): { label: string; value: number } {
  return buckets.reduce((best, item) => (item.value > best.value ? item : best), {
    label: "—",
    value: 0,
  });
}
