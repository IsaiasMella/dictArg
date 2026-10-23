/**
 * Los sonidos de empezar y terminar de grabar.
 *
 * Existen para saber que Voice te escuchó **sin mirar la pantalla**: la pastilla está
 * abajo y chiquita, y quien dicta está mirando lo que escribe. Se sintetizan acá con
 * Web Audio en vez de venir de un archivo porque el CSP del webview no deja cargar
 * nada de afuera y un par de osciladores pesan cero.
 *
 * Son cortos, bajitos y con envolvente a propósito: la idea viene de Wispr Flow, pero
 * los de Wispr Flow terminan molestando a fuerza de escucharlos cien veces por día. Por
 * lo mismo se pueden apagar desde Ajustes.
 */

export type Sonido = "inicio" | "fin";

export interface Nota {
  /** En Hz. */
  frecuencia: number;
  /** Segundos desde que arranca el sonido. */
  desde: number;
  /** Segundos que dura, con ataque y caída incluidos. */
  duracion: number;
}

// Re y La: una quinta justa, que suena a "listo" y no a alarma. Más agudo empieza a
// pinchar el oído; más grave se pierde en los parlantes de una notebook.
const RE5 = 587.33;
const LA5 = 880;

/**
 * Qué suena en cada caso. `fin` es el espejo de `inicio`: sube al empezar, baja al
 * terminar, y el oído distingue uno del otro sin tener que aprender nada.
 *
 * **Todo el sonido dura menos de 150 ms, y no es por estética.** El de inicio suena
 * con el micrófono ya abierto, así que por los parlantes puede colarse en la
 * grabación. Mientras dure menos que `MIN_VOICED_FRAMES` del controlador (~280 ms),
 * no alcanza por sí solo para que un clip en silencio pase por uno con voz —que es lo
 * que le abre la puerta a las alucinaciones de Whisper—. Estirarlo es romper eso.
 */
export const NOTAS: Record<Sonido, readonly Nota[]> = {
  inicio: [
    { frecuencia: RE5, desde: 0, duracion: 0.07 },
    { frecuencia: LA5, desde: 0.05, duracion: 0.09 },
  ],
  fin: [
    { frecuencia: LA5, desde: 0, duracion: 0.07 },
    { frecuencia: RE5, desde: 0.05, duracion: 0.09 },
  ],
};

/** Pico de cada nota, de 0 a 1. Bajo a propósito: tiene que avisar, no sobresaltar. */
export const VOLUMEN = 0.08;

/**
 * Cuánto tarda cada nota en llegar al pico. Arrancar de golpe en el pico es lo que
 * hace el "clic" al principio de un tono; 5 ms ya no se oyen como ataque.
 */
const ATAQUE_S = 0.005;

/**
 * El "cero" de la envolvente. La rampa exponencial no puede llegar a 0 —es un
 * logaritmo—, y esto está 58 dB debajo del pico: inaudible.
 */
const SILENCIO = 0.0001;

/**
 * Margen antes de la primera nota. `currentTime` avanza de a bloques de unos pocos
 * milisegundos, y agendar en un instante que ya pasó hace que la rampa arranque por
 * la mitad: vuelve el clic.
 */
const MARGEN_S = 0.01;

/**
 * Si el audio tarda más que esto en habilitarse, el sonido ya no se reproduce.
 *
 * Un "empezó a grabar" que llega un segundo tarde confunde más de lo que ayuda: suena
 * cuando ya estás hablando, o después de que terminaste. En la app no debería pasar
 * —wry habilita el autoplay por defecto—, pero el costo de cubrirlo es esta línea.
 */
const DEMORA_MAXIMA_MS = 250;

/**
 * Uno solo para toda la app, creado recién la primera vez que hace falta.
 *
 * Crear uno por sonido va acumulando hilos de audio hasta que el sistema se niega a
 * dar más, y además cada uno arranca con su propia latencia.
 */
let contexto: AudioContext | null = null;

function contextoDeAudio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!contexto || contexto.state === "closed") {
    contexto = new AudioContext();
  }
  return contexto;
}

/**
 * Reproduce uno de los dos sonidos, si están activados.
 *
 * **Nunca falla.** Es un adorno del dictado, no parte de él: si el audio de salida no
 * anda, el dictado tiene que seguir exactamente igual. Por eso el error se loguea y
 * se traga, y la promesa siempre se resuelve.
 */
export async function sonar(sonido: Sonido, activados: boolean): Promise<void> {
  if (!activados) return;

  try {
    const ctx = contextoDeAudio();
    if (!ctx) return;

    if (ctx.state !== "running") {
      const pedido = Date.now();
      await ctx.resume();
      if (Date.now() - pedido > DEMORA_MAXIMA_MS) return;
    }

    const cero = ctx.currentTime + MARGEN_S;
    for (const nota of NOTAS[sonido]) {
      tocar(ctx, nota, cero);
    }
  } catch (error) {
    console.warn("[dictarg] no se pudo reproducir el sonido:", error);
  }
}

function tocar(ctx: AudioContext, nota: Nota, cero: number): void {
  const empieza = cero + nota.desde;
  const termina = empieza + nota.duracion;

  // Seno puro: es la onda más suave que hay. Cualquier otra suma armónicos, y los
  // armónicos son lo que hace que un aviso suene a electrodoméstico.
  const oscilador = ctx.createOscillator();
  oscilador.type = "sine";
  oscilador.frequency.value = nota.frecuencia;

  // Ataque corto y caída exponencial: así se apaga una cuerda pulsada, y es lo que
  // hace que termine sin clic y suene a "blip" y no a pitido.
  const envolvente = ctx.createGain();
  envolvente.gain.setValueAtTime(SILENCIO, empieza);
  envolvente.gain.linearRampToValueAtTime(VOLUMEN, empieza + ATAQUE_S);
  envolvente.gain.exponentialRampToValueAtTime(SILENCIO, termina);

  oscilador.connect(envolvente);
  envolvente.connect(ctx.destination);
  oscilador.onended = () => {
    oscilador.disconnect();
    envolvente.disconnect();
  };

  oscilador.start(empieza);
  // Un poco después de que la envolvente llegó al piso, para no cortar la cola.
  oscilador.stop(termina + 0.02);
}
