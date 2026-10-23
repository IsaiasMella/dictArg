import { invoke } from "@tauri-apps/api/core";

import { DictationError } from "../state/types";
import { listDictionary } from "./db";

/**
 * Las dos mitades del dictado, vistas desde la interfaz.
 *
 * Acá no hay ninguna URL ni ninguna credencial: los dos pasos ocurren del lado
 * de Rust. Además de ser el único lugar donde puede vivir la key, es lo que
 * evita el CORS —Deepgram rechaza los pedidos REST hechos desde un navegador— y
 * lo que permite cambiar de proveedor sin tocar una línea de esta capa.
 *
 * Del lado de Rust: `src-tauri/src/stt.rs` y `src-tauri/src/polish.rs`.
 */

export interface ProviderKeys {
  /** Sin esto no se puede dictar. */
  transcription: boolean;
  /** Sin esto se dicta igual, pero el texto sale sin formatear. */
  formatting: boolean;
}

export const providerKeys = () => invoke<ProviderKeys>("provider_keys");

/** El dictado ya resuelto: texto listo para pegar, y con qué modelo salió. */
export interface Dictado {
  texto: string;
  /**
   * El modelo con el que se transcribió. **Lo informa quien transcribió.**
   *
   * Es la constante `MODEL` de `stt.rs`: el modelo real, no una preferencia guardada.
   */
  modelo: string;
}

/**
 * Audio a texto listo para pegar.
 *
 * Un solo paso: Rust transcribe y formatea, y garantiza que un problema de formateo
 * devuelva el crudo.
 *
 * Devuelve texto vacío cuando no se escuchó voz. El proveedor de hoy no inventa
 * frases ante el silencio —que era el problema de Whisper—, así que un texto vacío es
 * una respuesta legítima y no un error.
 */
export async function transcribe(blob: Blob, language: string): Promise<Dictado> {
  const audio = await toBase64(blob);
  const terms = await listDictionary().catch(() => []);

  try {
    const result = await invoke<Dictado>("transcribe_audio", {
      audio,
      mime: blob.type || "audio/webm",
      language,
      keywords: terms.map((term) => term.termino).slice(0, 100),
    });
    const replacements = terms.flatMap((term) =>
      term.confusiones.map((confusion) => ({ confusion, correct: term.termino })),
    ).sort((a, b) => b.confusion.length - a.confusion.length);
    let texto = result.texto;
    for (const { confusion, correct } of replacements) {
      const escaped = confusion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      texto = texto.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), correct);
    }
    return { ...result, texto };
  } catch (error) {
    // Los comandos rechazan con el mensaje ya escrito para el usuario.
    throw new DictationError(typeof error === "string" ? error : String(error));
  }
}

/**
 * Chequeos de "guardar y probar". Resuelven si la credencial sirve **antes** de
 * guardarla, así nadie se queda con una key inválida en el llavero creyendo que
 * está configurado.
 *
 * Son dos comandos y no uno parametrizado porque los proveedores autentican
 * distinto —Deepgram con `Token`, Groq con `Bearer`— y el mensaje de error tiene
 * que mandar a la consola correcta.
 */
export const verifyDeepgramKey = (key: string) =>
  invoke<void>("verify_deepgram_key", { key });

export const verifyGroqKey = (key: string) => invoke<void>("verify_groq_key", { key });

/**
 * Bytes a base64.
 *
 * De a bloques y no en una sola pasada: `String.fromCharCode(...bytes)` con un
 * clip entero mete cientos de miles de argumentos en la pila de la llamada y
 * revienta.
 */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;

  let binary = "";
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }

  return btoa(binary);
}
