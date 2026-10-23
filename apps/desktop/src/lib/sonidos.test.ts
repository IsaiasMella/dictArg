import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTAS, VOLUMEN, type Sonido } from "./sonidos";

/**
 * Un `AudioContext` de mentira: los tests corren en Node, sin Web Audio. Alcanza con
 * que registre cuántas veces se construyó y cuántos osciladores arrancó.
 */
class ContextoFalso {
  static creados = 0;
  static osciladores = 0;
  static despertados = 0;
  state: AudioContextState;
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {
    ContextoFalso.despertados += 1;
    this.state = "running";
  });

  constructor() {
    ContextoFalso.creados += 1;
    this.state = ContextoFalso.estadoInicial;
  }

  static estadoInicial: AudioContextState = "running";

  createOscillator() {
    ContextoFalso.osciladores += 1;
    return {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
}

/**
 * El módulo guarda un solo contexto para toda la app. Cada test importa uno recién
 * cargado para no heredar el del anterior.
 */
async function modulo() {
  vi.resetModules();
  return import("./sonidos");
}

beforeEach(() => {
  ContextoFalso.creados = 0;
  ContextoFalso.osciladores = 0;
  ContextoFalso.despertados = 0;
  ContextoFalso.estadoInicial = "running";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sonar", () => {
  it("apagado no toca el audio en absoluto", async () => {
    vi.stubGlobal("AudioContext", ContextoFalso);
    const { sonar } = await modulo();

    await sonar("inicio", false);
    await sonar("fin", false);

    expect(ContextoFalso.creados).toBe(0);
  });

  it("sin Web Audio no rompe", async () => {
    // El caso de estos mismos tests, y el de cualquier motor que no lo tenga.
    vi.stubGlobal("AudioContext", undefined);
    const { sonar } = await modulo();

    await expect(sonar("inicio", true)).resolves.toBeUndefined();
  });

  it("si el audio falla, se loguea y el dictado sigue", async () => {
    // La jerarquía de fallos: un adorno no puede hacer fracasar un dictado.
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("sin dispositivo de salida");
        }
      },
    );
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sonar } = await modulo();

    await expect(sonar("fin", true)).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledOnce();
  });

  it("toca una nota por cada una definida", async () => {
    vi.stubGlobal("AudioContext", ContextoFalso);
    const { sonar } = await modulo();

    await sonar("inicio", true);

    expect(ContextoFalso.osciladores).toBe(NOTAS.inicio.length);
  });

  it("reusa un solo contexto para todos los sonidos", async () => {
    vi.stubGlobal("AudioContext", ContextoFalso);
    const { sonar } = await modulo();

    await sonar("inicio", true);
    await sonar("fin", true);
    await sonar("inicio", true);

    expect(ContextoFalso.creados).toBe(1);
  });

  it("despierta el contexto si quedó suspendido", async () => {
    ContextoFalso.estadoInicial = "suspended";
    vi.stubGlobal("AudioContext", ContextoFalso);
    const { sonar } = await modulo();

    await sonar("inicio", true);

    expect(ContextoFalso.despertados).toBe(1);
    expect(ContextoFalso.osciladores).toBe(NOTAS.inicio.length);
  });

  it("si el audio tardó en despertar, no suena tarde", async () => {
    // Un "empezó a grabar" que llega un segundo después suena cuando ya estás
    // hablando: mejor nada.
    ContextoFalso.estadoInicial = "suspended";
    vi.stubGlobal("AudioContext", ContextoFalso);
    const { sonar } = await modulo();
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(1000);

    await sonar("inicio", true);

    expect(ContextoFalso.osciladores).toBe(0);
  });
});

describe("las notas", () => {
  const fin = (sonido: Sonido) =>
    Math.max(...NOTAS[sonido].map((nota) => nota.desde + nota.duracion));

  it.each<Sonido>(["inicio", "fin"])("%s dura menos de 150 ms", (sonido) => {
    // El de inicio suena con el micrófono abierto. Si durara lo que `MIN_VOICED_FRAMES`
    // (~280 ms), podría hacer pasar un clip en silencio por uno con voz.
    expect(fin(sonido)).toBeLessThanOrEqual(0.15);
  });

  it("el de inicio sube y el de fin baja", () => {
    const frecuencias = (sonido: Sonido) => NOTAS[sonido].map((nota) => nota.frecuencia);

    expect(frecuencias("inicio")[0]).toBeLessThan(frecuencias("inicio")[1]);
    expect(frecuencias("fin")).toEqual([...frecuencias("inicio")].reverse());
  });

  it("es bajito", () => {
    // Dos notas se pisan un instante: la suma tampoco puede pasar de un aviso suave.
    expect(VOLUMEN * 2).toBeLessThanOrEqual(0.2);
  });
});
