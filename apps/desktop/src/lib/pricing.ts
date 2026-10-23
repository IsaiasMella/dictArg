/**
 * Lo que cuesta transcribir, en dólares.
 *
 * Precios por hora de audio, sacados de la documentación de cada proveedor
 * (deepgram.com/pricing y console.groq.com/docs/models) y verificados el
 * 2026-09-01. Ninguna de las dos APIs los expone, así que cuando cambian hay que
 * tocarlos a mano —y acá solo—: ésta es la razón de que la tabla viva en su
 * propio archivo en vez de estar copiada en cada pantalla que muestra plata.
 *
 * La tabla va por modelo y no por proveedor para que el historial viejo se siga
 * cotizando a lo que costó cuando se grabó, aunque hoy se transcriba con otro.
 */
export const RATE_PER_HOUR: Record<string, number> = {
  // Deepgram, el que transcribe hoy: US$0,0043 por minuto.
  "nova-3": 0.258,
  // Groq, de cuando la transcripción pasaba por Whisper. Se conservan porque el
  // historial viejo está guardado con estos nombres y sus horas se siguen
  // cotizando a lo que costaron entonces.
  "whisper-large-v3": 0.111,
  "whisper-large-v3-turbo": 0.04,
};

/** Con qué modelo se hacen las cuentas cuando el guardado no está en la tabla. */
const FALLBACK_MODEL = "nova-3";

export function ratePerHour(model: string): number {
  return RATE_PER_HOUR[model] ?? RATE_PER_HOUR[FALLBACK_MODEL];
}

/** Lo que costó (o costaría) transcribir `seconds` de audio con `model`. */
export function costOf(seconds: number, model: string): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return (seconds / 3600) * ratePerHour(model);
}

/**
 * Formatea un importe para mostrarlo.
 *
 * Con dos decimales fijos, cualquier uso corto muestra `US$0.00`, que se lee
 * como un error antes que como un número. Por debajo del centavo se muestran
 * cuatro decimales: se ve que hay algo y que es poquísimo, que es justamente el
 * dato interesante.
 */
export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return `US$${amount.toFixed(4)}`;
  return `US$${amount.toFixed(2)}`;
}
