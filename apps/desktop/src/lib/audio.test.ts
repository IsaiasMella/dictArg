import { describe, expect, it } from "vitest";

import { extensionFor, micStateOf } from "./audio";

/**
 * El estado del micrófono, que es donde estaba el bug.
 *
 * Voice mantiene el `MediaStream` abierto mientras corre. Para decidir si sirve, se
 * miraba sólo `readyState === "live"` — y un track silenciado por afuera **sigue
 * estando `live`**. Apretar "mute" en una llamada de WhatsApp, Zoom o Meet silencia
 * el dispositivo de captura de todo el sistema, así que Voice arrancaba a grabar,
 * capturaba silencio, y devolvía un dictado vacío sin decir por qué.
 */
describe("micStateOf", () => {
  it("un track vivo y sin silenciar está listo", () => {
    expect(micStateOf({ readyState: "live", muted: false })).toBe("ready");
  });

  it("un track vivo pero silenciado NO está listo", () => {
    // El caso de la llamada. Es el que antes pasaba por bueno.
    expect(micStateOf({ readyState: "live", muted: true })).toBe("muted");
  });

  it("distingue silenciado de perdido", () => {
    // No es lo mismo y no se arreglan igual: al silenciado no le sirve reabrirlo
    // —el dispositivo del sistema sigue muteado—, al perdido sí.
    expect(micStateOf({ readyState: "ended", muted: false })).toBe("gone");
    expect(micStateOf({ readyState: "ended", muted: true })).toBe("gone");
  });

  it("sin track no hay micrófono", () => {
    expect(micStateOf(null)).toBe("gone");
    expect(micStateOf(undefined)).toBe("gone");
  });
});

describe("extensionFor", () => {
  it("saca los codecs del mime", () => {
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
  });

  it("resuelve los formatos de cada webview", () => {
    // WebView2 en Windows y Linux; WKWebView en macOS.
    expect(extensionFor("audio/webm")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
    expect(extensionFor("audio/ogg;codecs=opus")).toBe("ogg");
  });

  it("cae en webm ante un mime que no conoce", () => {
    expect(extensionFor("audio/vaya-a-saber")).toBe("webm");
  });
});
