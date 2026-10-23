import { DictationError } from "../state/types";

/**
 * Formatos que aceptan tanto el webview como Groq. WebView2 (Windows/Linux)
 * resuelve en webm/opus; WKWebView (macOS) en mp4/aac.
 */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export function extensionFor(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return EXTENSIONS[base] ?? "webm";
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface Clip {
  blob: Blob;
  durationMs: number;
  fileName: string;
}

/**
 * Cuánto se le da a un micrófono para que empiece a entregar audio.
 *
 * Chromium a veces entrega el track silenciado por unos milisegundos mientras el
 * driver arranca, así que fallar en el primer cuadro daría un error falso en un
 * arranque perfectamente normal. Medio segundo alcanza para distinguir ese parpadeo
 * de un micrófono que está silenciado de verdad, y es poco como para que se note en
 * el peor caso.
 */
const UNMUTE_GRACE_MS = 500;

/**
 * En qué estado está el micrófono que ya teníamos abierto.
 *
 * `muted` es el estado que faltaba mirar y el que rompía el dictado durante una
 * llamada: un track silenciado **sigue estando `live`**. Ver `micStateOf`.
 */
export type MicState = "ready" | "muted" | "gone";

/**
 * El estado de un track de audio.
 *
 * Está afuera de la clase y tipado por forma para poder probarlo sin un DOM: es la
 * decisión que estaba mal, no la mecánica de abrir el micrófono.
 *
 * **`live` no quiere decir que entregue audio.** Cuando otra aplicación silencia el
 * dispositivo de captura —apretar "mute" en una llamada de WhatsApp, Zoom o Meet lo
 * hace— el track queda vivo y `muted` en `true`, y todo lo que graba es silencio.
 * Mirar sólo `readyState` es lo que hacía que Voice arrancara a grabar igual y
 * devolviera un dictado vacío sin explicar nada.
 */
export function micStateOf(
  track: { readyState: string; muted: boolean } | null | undefined,
): MicState {
  if (!track || track.readyState !== "live") return "gone";
  return track.muted ? "muted" : "ready";
}

/**
 * Captura de micrófono.
 *
 * El `MediaStream` se pide una vez y se mantiene vivo mientras corre la app.
 * Dos razones: el prompt de permiso del webview aparece pegado a la ventana, y
 * la ventana principal está escondida en la bandeja durante el uso normal —si
 * pidiéramos permiso ahí, el diálogo sería invisible. Además arrancar a grabar
 * con el stream ya caliente es instantáneo, sin el medio segundo de warm-up del
 * driver de audio.
 */
export class Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;
  private deviceId: string | null = null;

  get micReady(): boolean {
    return micStateOf(this.audioTrack()) === "ready";
  }

  /** El track de audio en uso, si hay alguno. */
  private audioTrack(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }

  /**
   * Pide permiso de micrófono y deja el stream listo.
   *
   * Idempotente mientras no cambie el dispositivo pedido. Omitir el argumento
   * significa "seguí con el que ya tenías"; pasar `null` fuerza el micrófono por
   * defecto del sistema.
   */
  async warmUp(deviceId?: string | null): Promise<void> {
    const wanted = deviceId === undefined ? this.deviceId : deviceId;
    const sameDevice = wanted === this.deviceId;
    const state = micStateOf(this.audioTrack());

    if (state === "ready" && sameDevice) return;

    // Vivo pero silenciado, y con el mismo dispositivo: **reabrirlo no cambia nada.**
    // Lo que está en silencio es el dispositivo del sistema, no nuestro stream, así
    // que un `getUserMedia` nuevo devuelve otro track igual de muteado. Se le da un
    // momento por si es el parpadeo del arranque, y si sigue así se dice por qué.
    if (state === "muted" && sameDevice) {
      if (await this.waitForUnmute()) return;
      throw mutedMicError();
    }

    this.release();
    this.deviceId = wanted;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DictationError("Este sistema no expone acceso al micrófono.");
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Exacto a propósito: si el micrófono elegido se desenchufó, preferimos
          // un error explicable antes que grabar en silencio desde otro.
          ...(wanted ? { deviceId: { exact: wanted } } : {}),
        },
      });
    } catch (error) {
      throw describeMicError(error);
    }

    this.attachAnalyser();

    // El micrófono se abrió, pero eso todavía no quiere decir que entregue audio: si
    // otra aplicación lo dejó silenciado, el track nace muteado. Grabar igual daría
    // medio minuto de silencio y un dictado vacío sin ninguna explicación.
    if (!(await this.waitForUnmute())) {
      throw mutedMicError();
    }
  }

  /**
   * Espera a que el micrófono deje de estar silenciado.
   *
   * Devuelve `false` si se acabó la paciencia y sigue muteado. No es un `sleep`
   * ciego: se resuelve apenas llega el evento `unmute`, así que en el caso normal
   * —el parpadeo de medio segundo del driver— no cuesta nada.
   */
  private waitForUnmute(): Promise<boolean> {
    const track = this.audioTrack();
    if (!track) return Promise.resolve(false);
    if (!track.muted) return Promise.resolve(true);

    return new Promise((resolve) => {
      let timer = 0;

      const done = (unmuted: boolean) => {
        window.clearTimeout(timer);
        track.removeEventListener("unmute", onUnmute);
        resolve(unmuted);
      };

      const onUnmute = () => done(true);

      timer = window.setTimeout(() => done(false), UNMUTE_GRACE_MS);
      track.addEventListener("unmute", onUnmute);
    });
  }

  /**
   * Grafo de análisis para el waveform, montado sobre el mismo stream que ya se
   * graba: no se abre un segundo micrófono ni hace falta nada nativo.
   */
  private attachAnalyser(): void {
    if (!this.stream) return;
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      context.createMediaStreamSource(this.stream).connect(analyser);

      this.context = context;
      this.analyser = analyser;
      this.samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      // Chromium habilita el AudioContext una vez concedido el permiso de
      // micrófono, pero puede quedar suspendido igual. Si falla, el dictado sigue
      // funcionando: lo único que se pierde es la animación.
      void context.resume().catch(() => undefined);
    } catch {
      this.context = null;
      this.analyser = null;
      this.samples = null;
    }
  }

  /**
   * Volumen instantáneo (RMS) normalizado a 0..1.
   *
   * La raíz cuadrada sobre el RMS comprime el rango dinámico: sin eso la voz
   * hablada normal queda aplastada contra el piso de la barra y la onda casi no
   * se mueve.
   */
  level(): number {
    if (!this.analyser || !this.samples) return 0;
    this.analyser.getByteTimeDomainData(this.samples);

    let sum = 0;
    for (const sample of this.samples) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / this.samples.length);
    return Math.min(1, Math.sqrt(rms) * 1.6);
  }

  async start(): Promise<number> {
    await this.warmUp();
    if (!this.stream) throw new DictationError("No hay micrófono disponible.");

    // Si quedó viva una grabación anterior, se descarta y se arranca de cero.
    //
    // Antes se devolvía el `startedAt` de esa grabación vieja, dando por hecho
    // que era la misma: el cronómetro de la pastilla aparecía contando desde el
    // dictado anterior —minutos, no segundos— y el clip que se mandaba a
    // transcribir arrastraba todo el audio del medio.
    this.cancel();

    const mimeType = pickMimeType();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
    this.startedAt = Date.now();
    return this.startedAt;
  }

  /** Detiene y devuelve el clip. Descarta el recorder pero conserva el stream. */
  async stop(): Promise<Clip> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      throw new DictationError("No había ninguna grabación en curso.");
    }

    const durationMs = Date.now() - this.startedAt;
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || this.chunks[0]?.type || "audio/webm";
        resolve(new Blob(this.chunks, { type }));
      };
      recorder.onerror = () => reject(new DictationError("Se cortó la captura de audio."));
      recorder.stop();
    });

    this.recorder = null;
    this.chunks = [];

    return { blob, durationMs, fileName: `dictado.${extensionFor(blob.type)}` };
  }

  /** Aborta sin devolver nada (por ejemplo si falló algo a mitad de camino). */
  cancel(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      try {
        this.recorder.stop();
      } catch {
        /* ya estaba cerrado */
      }
    }
    this.recorder = null;
    this.chunks = [];
  }

  release(): void {
    this.cancel();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.analyser = null;
    this.samples = null;
  }
}

/**
 * El micrófono está abierto pero silenciado por afuera de Voice.
 *
 * Es el caso de las llamadas: apretar "mute" en WhatsApp, Zoom o Meet silencia el
 * dispositivo de captura para todo el sistema, no sólo para esa llamada. El mensaje
 * nombra las aplicaciones a propósito — "el micrófono está silenciado" a secas manda
 * a la persona a revisar los permisos de Voice, que es el lugar equivocado.
 */
function mutedMicError(): DictationError {
  return new DictationError(
    "El micrófono está silenciado.",
    "Si estás en una llamada de WhatsApp, Zoom o Meet, activalo ahí: mientras esté apagado en la llamada, Dictarg tampoco puede escucharte.",
  );
}

function describeMicError(error: unknown): DictationError {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new DictationError(
        "Permiso de micrófono denegado.",
        "Habilitalo en la configuración de privacidad del sistema y reiniciá Dictarg.",
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return new DictationError(
        "No se encontró ningún micrófono.",
        "Conectá uno y volvé a probar desde esta ventana.",
      );
    case "NotReadableError":
      return new DictationError(
        "El micrófono está ocupado por otra aplicación.",
        "Suele pasar durante una llamada: activá el micrófono en WhatsApp, Zoom o Meet, o cortá la llamada, y probá de nuevo.",
      );
    default:
      return new DictationError(
        `No se pudo abrir el micrófono: ${error instanceof Error ? error.message : String(error)}`,
      );
  }
}

export interface MicDevice {
  deviceId: string;
  label: string;
}

/**
 * Micrófonos disponibles.
 *
 * Los `label` vienen vacíos hasta que se concede el permiso: el navegador no
 * expone los nombres de los dispositivos a una página que todavía no accedió al
 * micrófono. Por eso la UI enumera recién después de conectar, y acá igual se
 * devuelve un nombre de reserva para no listar filas en blanco.
 */
export async function listMicrophones(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Micrófono ${index + 1}`,
    }));
}
