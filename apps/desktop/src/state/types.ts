export type DictationStatus =
  | "idle"
  | "recording"
  | "processing"
  | "success"
  | "error";

export interface DictationSnapshot {
  status: DictationStatus;
  /** Texto auxiliar: mensaje de error o preview de lo transcripto. */
  message?: string;
  /** epoch ms del inicio de la grabación, para el cronómetro de la pastilla. */
  startedAt?: number;
  /** Si la pastilla debe dibujarse cuando no pasa nada. */
  showWhenIdle: boolean;
  /**
   * Atajo activo, para mostrarlo mientras graba. La primera persona que probó la
   * app supo arrancar el dictado y no supo cómo terminarlo: el atajo tiene que
   * estar a la vista en el momento en que hace falta, no sólo en los ajustes.
   */
  shortcut: string;
  /**
   * Cuándo se corta sola la grabación si nadie contesta, en epoch ms.
   *
   * Sólo está durante los 30 segundos de gracia que siguen al tope de 5 minutos.
   * `undefined` el resto del tiempo. Ver `MAX_CLIP_MS` en `controller.ts`.
   */
  cutsAt?: number;
}

export const INITIAL_SNAPSHOT: DictationSnapshot = {
  status: "idle",
  showWhenIdle: true,
  shortcut: "",
};

/** Error con mensaje ya listo para mostrarle al usuario. */
export class DictationError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "DictationError";
  }
}
