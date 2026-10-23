import { invoke } from "@tauri-apps/api/core";

import type { ProviderKeys } from "./transcription";

export interface Settings {
  shortcut: string;
  language: string;
  restoreClipboard: boolean;
  showPillWhenIdle: boolean;
  /** `null` = el micrófono por defecto del sistema. */
  micDeviceId: string | null;
  /** Días que se conservan los dictados. */
  historyRetentionDays: number;
  /** Cómo llamar al usuario. Vacío = saludo sin nombre. */
  userName: string;
  /** `true` = grabar mientras el atajo está apretado, en vez de alternar. */
  pushToTalk: boolean;
  /** Un sonido corto al empezar y al terminar de grabar. Ver `sonidos.ts`. */
  playSounds: boolean;
  /**
   * Pasar el texto por el modelo de formateo antes de pegarlo. Prendido por
   * defecto; se cambia con el switch de Ajustes.
   */
  formatting: boolean;
  /**
   * Que la persona apagó el arranque automático a mano.
   *
   * **No hay control propio en la interfaz**: lo escribe `set_autostart` del lado de
   * Rust, junto con el registro en el sistema operativo. Viaja en este tipo igual
   * porque `save_settings` recibe el objeto entero, y un campo que no viaje volvería
   * a `false` en cada guardado — o sea, Voice se volvería a registrar
   * solo después de que lo apagaste.
   */
  autostartOptout: boolean;
}

export interface SettingsView extends Settings {
  /** Atajo realmente registrado; puede diferir del pedido si el SO lo rechazó. */
  effectiveShortcut: string;
  /**
   * Qué credenciales hay, una por proveedor.
   *
   * Reemplaza al `hasApiKey` viejo, que era un solo booleano e informaba la
   * presencia de la key de Groq — la del formateo, que es opcional.
   */
  keys: ProviderKeys;
  /** Dónde salió guardada cada credencial. */
  keyStorage: { transcription: KeyStorage; formatting: KeyStorage };
  /**
   * El modelo con el que realmente se transcribe, informado por Rust.
   *
   * De sólo lectura: no es una preferencia, no hay interfaz para cambiarlo. Está
   * en la vista y no en `Settings` justamente para que nadie lo pueda guardar y
   * quedarse con un valor que no se corresponde con lo que corre.
   */
  model: string;
}

export const getSettings = () => invoke<SettingsView>("get_settings");

export const saveSettings = (settings: Settings) =>
  invoke<SettingsView>("save_settings", { settings });

/**
 * Cuál de los dos proveedores. Tiene que coincidir con `keys::Provider` de Rust,
 * que lo deserializa en minúscula.
 */
export type Provider = "deepgram" | "groq";

/** Dónde quedó una credencial. `env` es la variable de entorno, que gana sobre todo. */
export type KeyStorage = "env" | "keyring" | "file" | "none";

export const setApiKey = (provider: Provider, key: string) =>
  invoke<"keyring" | "file">("set_api_key", { provider, key });

export const deleteApiKey = (provider: Provider) =>
  invoke<void>("delete_api_key", { provider });

/**
 * Le devuelve a Rust el número de secuencia de un toggle o de un ping.
 *
 * Se llama apenas llega el evento, **antes** de tocar el micrófono: lo que Rust mide
 * con esto es si el webview está vivo, no si el dictado terminó. Si no vuelve, Rust
 * recarga la ventana.
 */
export const dictationAck = (seq: number) => invoke<void>("dictation_ack", { seq });

/**
 * Reubica la pastilla abajo del monitor activo.
 *
 * Se llama al empezar cada grabación. Es barato y cubre el caso que ningún evento de
 * ventana avisa: desconectar el monitor donde la pastilla estaba dibujada.
 */
export const placePill = () => invoke<void>("place_pill_command");

export const injectText = (text: string, restoreClipboard: boolean) =>
  invoke<void>("inject_text", { text, restoreClipboard });

export const copyText = (text: string) => invoke<void>("copy_text", { text });

export const openSettingsWindow = () => invoke<void>("open_settings_window");

export const hideSettingsWindow = () => invoke<void>("hide_settings_window");



export interface AutostartStatus {
  enabled: boolean;
  /** true en `tauri dev`: el ejecutable registrado depende del server de Vite. */
  devBuild: boolean;
}

export const getAutostart = () => invoke<AutostartStatus>("get_autostart");

export const setAutostart = (enabled: boolean) =>
  invoke<AutostartStatus>("set_autostart", { enabled });

/** Los links de contacto de la Ayuda. Tiene que coincidir con `contact::Link`. */
export type ContactLink = "issues" | "linkedin";

/** Abre un link de contacto en el navegador del sistema. Las URLs viven en Rust. */
export const openContact = (link: ContactLink) =>
  invoke<void>("open_contact", { link });
