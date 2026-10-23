/** Nombres de eventos compartidos entre Rust, la ventana principal y la pastilla. */
export const EVENTS = {
  /** Rust -> ventana principal: se apretó el atajo global. */
  toggle: "dictation-toggle",
  /**
   * Rust -> ventana principal: "¿seguís viva?".
   *
   * Se manda sólo cuando un toggle no volvió, para confirmar antes de recargar la
   * ventana. Ver `heartbeat.rs`.
   */
  ping: "dictation-ping",
  /** Ventana principal -> todas: cambió el estado del dictado. */
  state: "dictation-state",
  /** Pastilla -> ventana principal: "recién arranqué, mandame el estado". */
  pillReady: "dictation-pill-ready",
  /** Rust -> todas: no se pudo registrar ningún atajo. */
  shortcutError: "dictation-shortcut-error",
  /**
   * Ventana principal -> pastilla: nivel de audio instantáneo (0..1) mientras
   * graba. Va un solo número por frame; el historial para dibujar la onda lo
   * acumula la pastilla. Mandar el espectro entero sería mucho más tráfico por
   * IPC para el mismo resultado visual.
   */
  levels: "dictation-levels",
  /** Se insertó o borró una transcripción: quien liste, que recargue. */
  historyChanged: "dictation-history-changed",
  /** Se guardaron los ajustes: quien dependa de ellos, que relea. */
  settingsChanged: "dictation-settings-changed",
} as const;
