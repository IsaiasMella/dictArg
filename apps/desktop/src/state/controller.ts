import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

import { Recorder } from "../lib/audio";
import {
  dictationAck,
  getSettings,
  injectText,
  placePill,
  openSettingsWindow,
  type SettingsView,
} from "../lib/bridge";
import { pruneOldTranscriptions, saveTranscription } from "../lib/db";
import { EVENTS } from "../lib/events";
import { sonar } from "../lib/sonidos";
import { providerKeys, transcribe, type ProviderKeys } from "../lib/transcription";
import {
  DictationError,
  INITIAL_SNAPSHOT,
  type DictationSnapshot,
  type DictationStatus,
} from "./types";

/**
 * Lo que manda Rust en cada pulsación del atajo.
 *
 * `seq` es el número que hay que devolver para que Rust sepa que este webview sigue
 * vivo. Ver `heartbeat.rs`.
 */
interface Toggle {
  action: "toggle" | "start" | "stop";
  seq: number;
}

/** Debajo de esto casi siempre es un toggle accidental, no un dictado. */
export const MIN_CLIP_MS = 350;

/**
 * Tope de duración de un clip antes de preguntar si sigue.
 *
 * Sin tope, un atajo apretado sin querer —o un "frená" que se pierde— genera un clip
 * de una hora que se sube entero y se paga entero. El único freno era el 413 del
 * proveedor, que llega **después** de subir todo.
 */
export const MAX_CLIP_MS = 5 * 60 * 1000;

/**
 * Cuánto se espera la respuesta antes de cortar solo. Máximo absoluto: 5:30.
 *
 * En las tres ramas —seguir, cortar, no contestar— **lo grabado hasta ese momento se
 * transcribe siempre**. La persona habló: descartar el audio sería el peor resultado
 * posible de una función que existe para protegerla de un gasto.
 */
export const CLIP_GRACE_MS = 30 * 1000;

/**
 * Cuándo se considera que hubo voz.
 *
 * Whisper **alucina con audio vacío**: ante silencio devuelve frases de relleno
 * («Gracias», «Subtítulos por la comunidad») que terminan pegadas en el
 * documento. Un umbral de volumen solo no alcanza, porque el ruido de sala de un
 * micrófono común queda justo en el mismo nivel que ese umbral.
 *
 * Lo que sí distingue voz de ruido es la **persistencia**: el ruido de fondo es
 * parejo y bajo, la voz sube por encima durante cientos de milisegundos
 * seguidos. Por eso se cuentan cuadros por encima del piso en vez de mirar el
 * pico, que un solo golpe al escritorio ya alcanzaría para superar.
 */
const VOICE_FLOOR = 0.14;
/** Cuadros con voz que hacen falta. A 40 ms cada uno, esto son ~280 ms. */
const MIN_VOICED_FRAMES = 7;
const ERROR_LINGER_MS = 6000;
const SUCCESS_LINGER_MS = 1400;
const SILENCE_LINGER_MS = 2200;

type Listener = (snapshot: DictationSnapshot) => void;

/**
 * Máquina de estados del dictado. Vive **solo** en la ventana principal, que es
 * la que graba, transcribe e inyecta el texto. La pastilla es una vista
 * pasiva: recibe cada snapshot por evento y no toma decisiones.
 */
export class DictationController {
  private snapshot: DictationSnapshot = INITIAL_SNAPSHOT;
  private readonly recorder = new Recorder();
  private readonly listeners = new Set<Listener>();
  private unlisteners: UnlistenFn[] = [];
  private settings: SettingsView | null = null;
  /** Qué proveedores tienen credencial. Sin la de transcripción no se dicta. */
  private providers: ProviderKeys | null = null;
  private linger: number | undefined;
  private levelTimer: number | undefined;
  /** Dispara la consulta de "¿seguís dictando?" al llegar al tope. */
  private clipCap: number | undefined;
  /** Corta solo si nadie contesta la consulta. */
  private clipGrace: number | undefined;
  /** Cuadros por encima del piso de voz en la grabación en curso. */
  private voicedFrames = 0;
  /** Evita que dos pulsaciones muy juntas se pisen a mitad de una transición. */
  private busy = false;
  /**
   * Llegó un "frená" mientras la grabación todavía estaba arrancando.
   *
   * Se anota en vez de descartarlo: perderlo dejaba la grabación corriendo sola
   * hasta que alguien apretara el atajo de nuevo, con el cronómetro sumando
   * minutos en la pastilla.
   */
  private pendingStop = false;
  /** Mientras la UI captura un atajo nuevo, el actual no debe dictar. */
  private capturing = false;

  async init(): Promise<void> {
    await this.reloadSettings();
    await this.ensureMicPermissionIsVisible();
    void this.prune();

    this.unlisteners.push(
      await listen<Toggle>(EVENTS.toggle, (event) => {
        // El ACK va PRIMERO, antes de tocar el micrófono y antes de cualquier
        // `await`. Lo que Rust mide con esto es si este webview está vivo, no si el
        // dictado salió bien: si se mandara al final, un dictado lento se vería
        // igual que un webview caído y la ventana se recargaría en el medio.
        void dictationAck(event.payload.seq);

        // "toggle" alterna; "start"/"stop" vienen del modo mantener apretado.
        switch (event.payload.action) {
          case "start":
            // En mantener-apretado, volver a apretar durante la ventana de gracia
            // es la misma respuesta que en modo alternar: "seguí grabando".
            if (this.keepRecording()) break;
            // Cualquier estado menos grabar o transcribir: el "Listo" que queda
            // en pantalla un segundo largo después de un dictado no puede
            // comerse la pulsación siguiente.
            if (
              this.snapshot.status !== "recording" &&
              this.snapshot.status !== "processing"
            ) {
              void this.beginRecording();
            }
            break;
          case "stop":
            void this.finishRecording();
            break;
          default:
            void this.toggle();
        }
      }),
      // La segunda sonda del heartbeat: Rust sólo la manda cuando un toggle no
      // volvió. Contestarla es todo lo que hay que hacer.
      await listen<number>(EVENTS.ping, (event) => {
        void dictationAck(event.payload);
      }),
      // La pastilla puede cargar después que la principal; cuando avisa que está
      // lista le re-mandamos el estado actual para que no arranque desincronizada.
      await listen(EVENTS.pillReady, () => {
        void this.broadcast();
      }),
      await listen<string>(EVENTS.shortcutError, (event) => {
        this.setState("error", {
          message: "No se pudo registrar el atajo global.",
          detail: event.payload,
        });
      }),
    );

    await this.broadcast();
  }

  dispose(): void {
    this.stopLevelFeed();
    this.disarmClipCap();
    window.clearTimeout(this.linger);
    this.unlisteners.forEach((off) => off());
    this.unlisteners = [];
    this.recorder.release();
    this.listeners.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  get current(): DictationSnapshot {
    return this.snapshot;
  }

  get micReady(): boolean {
    return this.recorder.micReady;
  }

  /** Pide permiso de micrófono con la ventana a la vista (ver `Recorder`). */
  async warmUpMic(deviceId?: string | null): Promise<void> {
    await this.recorder.warmUp(deviceId);
  }

  /**
   * Si el micrófono todavía no tiene permiso, abre la configuración.
   *
   * El diálogo de permiso del webview se dibuja pegado a la ventana que lo pide,
   * y en uso normal ésta vive escondida en la bandeja: si el permiso se pidiera
   * recién al apretar el atajo, el diálogo sería invisible y el dictado quedaría
   * colgado sin explicación. `permissions.query` responde sin abrir ningún
   * diálogo, así que se puede consultar en cada arranque sin molestar.
   *
   * Pasa siempre en una instalación nueva: el permiso se guarda por origen, y el
   * de producción (`tauri.localhost`) no es el mismo que el del server de dev.
   */
  private async ensureMicPermissionIsVisible(): Promise<void> {
    if (!navigator.permissions?.query) return;
    try {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (status.state !== "granted") {
        await openSettingsWindow();
      }
    } catch {
      // Motor sin soporte para consultar este permiso: no es motivo para romper
      // el arranque, y el flujo normal sigue funcionando.
    }
  }

  async reloadSettings(): Promise<SettingsView> {
    this.settings = await getSettings();
    this.providers = await providerKeys().catch(() => null);
    if (this.snapshot.showWhenIdle !== this.settings.showPillWhenIdle) {
      await this.broadcast();
    }
    return this.settings;
  }

  /**
   * Silencia el atajo mientras la interfaz captura uno nuevo.
   *
   * Antes se liberaba el atajo en el sistema operativo, y eso tenía un efecto
   * feo: con el atajo suelto, Windows recuperaba Alt+Espacio —su combinación
   * para el menú de la ventana— y lo abría encima de la configuración.
   * Manteniéndolo registrado, el sistema lo sigue interceptando y acá
   * simplemente no hacemos nada con él.
   */
  setCapturing(capturing: boolean): void {
    this.capturing = capturing;
  }

  async toggle(): Promise<void> {
    if (this.capturing) return;
    // Durante la ventana de gracia, el atajo significa "sí, seguí". Es la única
    // forma de contestar que no le roba el foco a la aplicación donde se está
    // dictando: la pastilla es `focusable: false` y transparente al mouse a
    // propósito, y ésas son las dos propiedades que hacen que dictar sobre otra app
    // funcione.
    if (this.keepRecording()) return;
    if (this.busy) {
      // La pulsación cayó justo mientras arrancaba una grabación. Es un pedido
      // de frenarla: se anota para atenderlo al terminar de arrancar, en vez de
      // descartarlo y dejarla grabando sin que nadie la corte.
      this.pendingStop = true;
      return;
    }
    if (this.snapshot.status === "processing") return;
    if (this.snapshot.status === "recording") {
      await this.finishRecording();
      return;
    }
    await this.beginRecording();
  }

  private async beginRecording(): Promise<void> {
    if (this.capturing || this.busy) return;
    this.busy = true;
    // Una marca vieja no puede frenar la grabación que recién empieza: sólo
    // vale el "frená" que llegue mientras ésta arranca.
    this.pendingStop = false;
    try {
      const settings = this.settings ?? (await this.reloadSettings());
      if (!this.providers?.transcription) {
        throw new DictationError(
          "Falta la credencial para transcribir.",
          "Poné DEEPGRAM_API_KEY en el .env, o guardala desde la configuración.",
        );
      }
      await this.recorder.warmUp(settings.micDeviceId ?? null);
      const startedAt = await this.recorder.start();
      this.setState("recording", { startedAt });
      // Recién ahora, con la grabación andando: antes podría confirmar un arranque que
      // después falla. Suena con el micrófono abierto y puede colarse en el clip; lo
      // que lo vuelve inofensivo está en `NOTAS` de `sonidos.ts`.
      void sonar("inicio", settings.playSounds);
      // La pastilla se posicionaba una sola vez, en el arranque de la app. Entre
      // grabación y grabación pudo cambiar la resolución o desconectarse el monitor
      // donde estaba.
      void placePill();
      this.startLevelFeed();
      this.armClipCap();
    } catch (error) {
      this.recorder.cancel();
      this.fail(error);
    } finally {
      this.busy = false;
    }

    // El atajo se soltó —o se volvió a apretar— mientras esto arrancaba: recién
    // ahora se puede atender.
    if (this.pendingStop && this.snapshot.status === "recording") {
      await this.finishRecording();
    }
  }

  /**
   * Alimenta el waveform de la pastilla mientras dura la grabación.
   *
   * La pastilla vive en otra ventana y no tiene el stream, así que el nivel se
   * calcula acá y viaja por evento. Va un número por frame a ~25 Hz: suficiente
   * para que la onda se vea fluida sin saturar el IPC.
   */
  private startLevelFeed(): void {
    this.stopLevelFeed();
    this.voicedFrames = 0;
    this.levelTimer = window.setInterval(() => {
      const level = this.recorder.level();
      if (level >= VOICE_FLOOR) this.voicedFrames += 1;
      void emit(EVENTS.levels, level);
    }, 40);
  }

  private stopLevelFeed(): void {
    window.clearInterval(this.levelTimer);
    this.levelTimer = undefined;
  }

  private async finishRecording(): Promise<void> {
    // Llegó a mitad de una transición, típicamente el "soltá" de mantener
    // apretado mientras la grabación todavía estaba abriendo el micrófono. Se
    // anota para atenderlo apenas termine de arrancar.
    if (this.busy) {
      this.pendingStop = true;
      return;
    }
    if (this.snapshot.status !== "recording") return;

    this.pendingStop = false;
    this.busy = true;
    this.stopLevelFeed();
    this.disarmClipCap();
    this.setState("processing");
    try {
      const settings = this.settings ?? (await this.reloadSettings());
      const clip = await this.recorder.stop();
      // Con el grabador ya cerrado y no al pasar a "processing", que es un instante
      // antes: ahí todavía graba, y el sonido quedaría pegado al final del clip que se
      // manda a transcribir.
      void sonar("fin", settings.playSounds);

      if (clip.durationMs < MIN_CLIP_MS) {
        this.setState("idle");
        return;
      }

      if (this.voicedFrames < MIN_VOICED_FRAMES) {
        this.setState("error", { message: "No se escuchó nada." });
        this.lingerToIdle(SILENCE_LINGER_MS);
        return;
      }

      // Un solo paso: transcribir y formatear los resuelve Rust.
      const dictado = await transcribe(clip.blob, settings.language);

      // Un texto vacío es la respuesta cuando no se escuchó voz. El filtro de
      // alucinaciones queda igual: cuesta nada y cubre al proveedor que devuelva
      // relleno en vez de nada.
      if (!dictado.texto || isHallucination(dictado.texto)) {
        this.setState("error", { message: "No se escuchó nada." });
        this.lingerToIdle(SILENCE_LINGER_MS);
        return;
      }

      const text = dictado.texto;

      // El modelo lo informa quien transcribió, no una preferencia guardada.
      // Guardarlo por fila es lo que permite cotizar el historial viejo a lo que
      // costó entonces, aunque hoy se transcriba con otro.
      await guardarYPegar(
        () => this.archive(text, clip.durationMs / 1000, dictado.modelo),
        () => injectText(text, settings.restoreClipboard),
      );
      this.setState("success", { message: preview(text) });
      this.lingerToIdle(SUCCESS_LINGER_MS);
    } catch (error) {
      this.recorder.cancel();
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Guarda el dictado en el historial. Devuelve si quedó guardado.
   *
   * Deliberadamente no propaga errores: corre antes de pegar, y un problema con la
   * base no puede impedir que el texto llegue a la app del usuario.
   */
  private async archive(text: string, durationSeconds: number, model: string): Promise<boolean> {
    try {
      await saveTranscription({ text, durationSeconds, model });
    } catch (error) {
      console.error("[dictarg] no se pudo guardar en el historial:", error);
      return false;
    }

    await this.prune();
    try {
      await emit(EVENTS.historyChanged);
    } catch (error) {
      console.error("[dictarg] no se pudo avisar que cambió el historial:", error);
    }
    return true;
  }

  /** Aplica la retención configurada. Igual que archivar: nunca rompe el flujo. */
  private async prune(): Promise<void> {
    try {
      await pruneOldTranscriptions(this.settings?.historyRetentionDays ?? 90);
    } catch (error) {
      console.error("[dictarg] no se pudo podar el historial:", error);
    }
  }

  private fail(error: unknown): void {
    this.stopLevelFeed();
    const message =
      error instanceof DictationError || error instanceof Error
        ? error.message
        : String(error);
    const detail = error instanceof DictationError ? error.hint : undefined;
    this.setState("error", { message, detail });
    this.lingerToIdle(ERROR_LINGER_MS);
  }

  /**
   * Arranca el reloj del tope de duración. Se rearma cada vez que se contesta que sí.
   */
  private armClipCap(): void {
    window.clearTimeout(this.clipCap);
    this.clipCap = window.setTimeout(() => this.askToContinue(), MAX_CLIP_MS);
  }

  private disarmClipCap(): void {
    window.clearTimeout(this.clipCap);
    window.clearTimeout(this.clipGrace);
    this.clipCap = undefined;
    this.clipGrace = undefined;
  }

  /** Se llegó al tope: se pregunta y se arma el corte por si nadie contesta. */
  private askToContinue(): void {
    if (this.snapshot.status !== "recording") return;

    const cutsAt = Date.now() + CLIP_GRACE_MS;
    this.setState("recording", { startedAt: this.snapshot.startedAt, cutsAt });

    this.clipGrace = window.setTimeout(() => {
      // Nadie contestó. Se corta y **se transcribe lo grabado**: la persona habló,
      // y descartar el audio sería el peor resultado posible de una función que
      // existe para protegerla de un gasto.
      void this.finishRecording();
    }, CLIP_GRACE_MS);
  }

  /**
   * Si hay una consulta abierta, la contesta que sí y devuelve `true`.
   *
   * Devolver `true` es lo que hace que la pulsación **no** siga su camino normal de
   * frenar el dictado: durante esos 30 segundos el atajo cambia de significado, y
   * ése es el costo de contestar sin mouse y sin robar el foco.
   */
  private keepRecording(): boolean {
    if (this.snapshot.status !== "recording" || this.snapshot.cutsAt === undefined) {
      return false;
    }

    window.clearTimeout(this.clipGrace);
    this.clipGrace = undefined;
    this.setState("recording", { startedAt: this.snapshot.startedAt });
    this.armClipCap();
    return true;
  }

  private lingerToIdle(delay: number): void {
    window.clearTimeout(this.linger);
    this.linger = window.setTimeout(() => {
      if (this.snapshot.status === "success" || this.snapshot.status === "error") {
        this.setState("idle");
      }
    }, delay);
  }

  private setState(
    status: DictationStatus,
    extra: { message?: string; detail?: string; startedAt?: number; cutsAt?: number } = {},
  ): void {
    if (status !== "success" && status !== "error") {
      window.clearTimeout(this.linger);
    }
    const message = extra.detail
      ? `${extra.message ?? ""} ${extra.detail}`.trim()
      : extra.message;

    this.snapshot = {
      status,
      message,
      startedAt: extra.startedAt,
      cutsAt: extra.cutsAt,
      showWhenIdle: this.settings?.showPillWhenIdle ?? true,
      shortcut: this.settings?.effectiveShortcut ?? "",
    };
    this.listeners.forEach((listener) => listener(this.snapshot));
    void emit(EVENTS.state, this.snapshot);
  }

  private async broadcast(): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      showWhenIdle: this.settings?.showPillWhenIdle ?? true,
      shortcut: this.settings?.effectiveShortcut ?? "",
    };
    this.listeners.forEach((listener) => listener(this.snapshot));
    await emit(EVENTS.state, this.snapshot);
  }
}

/**
 * Guarda el dictado en el Historial y después lo pega, en ese orden.
 *
 * Primero el Historial: si el pegado falla —otra aplicación tiene tomado el
 * portapapeles, por ejemplo—, lo dictado no se pierde. Un guardado que falla no
 * frena nada: el texto tiene que llegar a la app igual.
 *
 * Si el pegado falla, el error dice que el texto quedó en el Historial sólo
 * cuando el guardado salió bien.
 *
 * Recibe las dos acciones como parámetros para poder testearla sin levantar el
 * controlador, que necesita Tauri, el micrófono y la base.
 */
export async function guardarYPegar(
  guardar: () => Promise<boolean>,
  pegar: () => Promise<void>,
): Promise<void> {
  const guardado = await guardar().catch((error: unknown) => {
    console.error("[dictarg] no se pudo guardar en el historial:", error);
    return false;
  });

  try {
    await pegar();
  } catch (error) {
    // Los comandos de Rust rechazan con el mensaje ya escrito para el usuario.
    const message = error instanceof Error ? error.message : String(error);
    throw new DictationError(
      message,
      guardado
        ? "Quedó guardado en el Historial para copiarlo desde ahí."
        : "Tampoco se pudo guardar en el Historial.",
    );
  }
}

/**
 * Frases que Whisper devuelve cuando el audio no tiene voz.
 *
 * Son restos del material con el que se entrenó —subtítulos de video— y
 * aparecen siempre iguales. Solo se descartan si son **todo** lo que devolvió:
 * dentro de un dictado real, esas mismas palabras se respetan.
 */
export const HALLUCINATIONS = [
  "subtitulos realizados por la comunidad de amara.org",
  "subtitulos por la comunidad de amara.org",
  "mas videos en",
  "suscribete al canal",
  "gracias por ver el video",
  "gracias por ver este video",
  "thanks for watching",
  "thank you for watching",
  "subscribe to my channel",
  "amara.org",
];

/**
 * Normaliza para comparar contra `HALLUCINATIONS`: sin mayúsculas, sin tildes, sin
 * signos y sin el punto final.
 *
 * Se exportó para poder testearla. Tenía dos regex a las que les faltaba una barra
 * invertida —`/s+/` por `/\s+/` y `/.$/` por `/\.$/`— y entre las dos anulaban el
 * filtro entero: la primera comía todas las eses y la segunda el último carácter de
 * cualquier texto. Ninguna de las diez frases podía coincidir nunca.
 *
 * El reemplazo único `[^a-z0-9.]+ → " "` arregla además algo que el orden viejo
 * rompía por su cuenta: los saltos de línea se borraban en vez de convertirse en
 * espacio, y pegaban dos palabras: "gracias" y "por" separadas por un salto
 * quedaban como "graciaspor".
 */
export function flattenForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

function isHallucination(text: string): boolean {
  const flat = flattenForComparison(text);

  return HALLUCINATIONS.some((phrase) => flat === phrase || flat.startsWith(phrase));
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}
