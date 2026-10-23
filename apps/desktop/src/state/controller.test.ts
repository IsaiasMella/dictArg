import { describe, expect, it } from "vitest";

import {
  CLIP_GRACE_MS,
  HALLUCINATIONS,
  MAX_CLIP_MS,
  MIN_CLIP_MS,
  flattenForComparison,
  guardarYPegar,
} from "./controller";
import { DictationError } from "./types";

/**
 * El filtro descarta la transcripción sólo si la alucinación es **todo** lo que
 * devolvió el proveedor. Se replica acá la comparación de `isHallucination`, que no
 * se exporta: lo que puede romperse es la normalización, y ésa sí es pública.
 */
function detecta(text: string): boolean {
  const flat = flattenForComparison(text);
  return HALLUCINATIONS.some((phrase) => flat === phrase || flat.startsWith(phrase));
}

describe("flattenForComparison", () => {
  it("saca tildes, mayúsculas y signos", () => {
    expect(flattenForComparison("Suscríbete al Canal!")).toBe("suscribete al canal");
  });

  it("colapsa cualquier espacio en blanco a uno solo", () => {
    expect(flattenForComparison("gracias\n  por\tver")).toBe("gracias por ver");
  });

  it("borra el punto final pero no los del medio", () => {
    expect(flattenForComparison("amara.org.")).toBe("amara.org");
  });

  it("no come las eses", () => {
    // La regex vieja era /s+/ en vez de /\s+/: "gracias" quedaba "gracia".
    expect(flattenForComparison("gracias")).toBe("gracias");
  });

  it("no come el último carácter", () => {
    // La regex vieja era /.$/ en vez de /\.$/: "amara.org" quedaba "amara.or".
    expect(flattenForComparison("amara.org")).toBe("amara.org");
  });
});

describe("detección de alucinaciones", () => {
  // Las diez frases del catálogo tienen que
  // detectarse. Antes del arreglo, ninguna podía.
  it.each(HALLUCINATIONS)("detecta la frase exacta: %s", (phrase) => {
    expect(detecta(phrase)).toBe(true);
  });

  it.each([
    ["Gracias por ver el video.", "con puntuación y mayúscula"],
    ["Thanks for watching!", "en inglés, con signo"],
    ["Suscríbete al canal", "con tilde"],
    ["  Amara.org  ", "con espacios sobrantes"],
    ["Subtítulos realizados por la comunidad de Amara.org", "la frase larga completa"],
    ["gracias por ver el video, no te olvides de suscribirte", "con cola: startsWith"],
  ])("detecta %j (%s)", (text) => {
    expect(detecta(text)).toBe(true);
  });

  // La otra mitad del criterio: un dictado real que *contiene* esas palabras no se
  // descarta. Es lo que protege el comentario de `HALLUCINATIONS` — "sólo se
  // descartan si son todo lo que devolvió".
  it.each([
    "Recordale al equipo que hay que dar las gracias por ver el video antes de cortar.",
    "Poné en la minuta que el cliente pidió subtítulos realizados por la comunidad.",
    "Le dije que se suscribiera al canal de novedades del estudio.",
    "Mandale el link de amara.org al traductor.",
    "La muletilla thanks for watching la usan todos los youtubers.",
  ])("no descarta un dictado real que las menciona: %j", (text) => {
    expect(detecta(text)).toBe(false);
  });

  // Filo conocido, fijado a propósito para que un cambio futuro lo haga visible.
  //
  // La comparación es `startsWith`, no igualdad, así que un dictado real que
  // *empieza* con una de las frases sí se descarta — y se descarta en silencio: el
  // usuario ve "No se escuchó nada" y pierde lo que dijo.
  //
  // El `startsWith` está para cubrir la alucinación seguida de más relleno
  // ("...amara.org Más videos en..."), que es como suelen venir. La contrapartida es
  // ésta. El comentario de `HALLUCINATIONS` dice "sólo se descartan si son **todo**
  // lo que devolvió", que describe la igualdad, no el `startsWith`: el código y su
  // comentario no dicen lo mismo.
  //
  // Se deja como está porque el arreglo era de las regex, no redefinir el
  // criterio. Si se decide cerrarlo, el cambio es exigir que el texto entero se
  // consuma con frases del catálogo, y este test es el que hay que dar vuelta.
  it("descarta un dictado real que EMPIEZA con una de las frases", () => {
    expect(detecta("Thanks for watching es la muletilla de los youtubers.")).toBe(true);
  });

  it("no descarta un dictado normal", () => {
    expect(detecta("Che, acordate de llamar al contador antes del viernes.")).toBe(false);
  });

  it("descarta el texto vacío como no-alucinación (lo ataja el chequeo de vacío)", () => {
    expect(detecta("")).toBe(false);
  });
});

/**
 * Los números del tope de duración, fijados acá porque están repartidos en dos constantes y el
 * que importa —el máximo absoluto— es la suma de las dos. Cambiar una sola y creer
 * que el tope sigue siendo 5:30 es el error que este test ataja.
 */
describe("tope de duración del clip", () => {
  it("pregunta a los 5 minutos", () => {
    expect(MAX_CLIP_MS).toBe(5 * 60 * 1000);
  });

  it("da 30 segundos para contestar", () => {
    expect(CLIP_GRACE_MS).toBe(30 * 1000);
  });

  it("no deja pasar de 5:30 sin respuesta", () => {
    expect(MAX_CLIP_MS + CLIP_GRACE_MS).toBe(5.5 * 60 * 1000);
  });

  it("el tope de arriba está lejísimos del piso de abajo", () => {
    // Los dos extremos existen por motivos opuestos: `MIN_CLIP_MS` descarta el
    // toggle accidental, `MAX_CLIP_MS` descarta el que quedó apretado. Que no se
    // crucen nunca es lo que hace que un dictado normal no toque ninguno.
    expect(MIN_CLIP_MS).toBeLessThan(MAX_CLIP_MS / 100);
  });
});

/**
 * Antes se pegaba primero y se guardaba después: si el pegado fallaba, el dictado no
 * llegaba al Historial y se perdía. Los dobles de `guardar` y `pegar` hacen de base y
 * de portapapeles.
 */
describe("guardar el dictado y pegarlo", () => {
  const dictado = "Acordate de llamar al contador.";
  // Lo que `injectText` rechaza cuando otra aplicación tiene tomado el portapapeles.
  const errorDelPortapapeles =
    "No se pudo dejar el texto en el portapapeles (otra aplicación pisó el portapapeles).";

  it("guarda antes de pegar", async () => {
    const pasos: string[] = [];

    await guardarYPegar(
      async () => {
        pasos.push("guardar");
        return true;
      },
      async () => {
        pasos.push("pegar");
      },
    );

    expect(pasos).toEqual(["guardar", "pegar"]);
  });

  it("si el pegado falla, el dictado queda en el Historial y el error lo dice", async () => {
    const historial: string[] = [];

    const error = await guardarYPegar(
      async () => {
        historial.push(dictado);
        return true;
      },
      () => Promise.reject(errorDelPortapapeles),
    ).catch((e: unknown) => e);

    expect(historial).toEqual([dictado]);
    expect(error).toBeInstanceOf(DictationError);
    expect((error as DictationError).message).toBe(errorDelPortapapeles);
    expect((error as DictationError).hint).toBe(
      "Quedó guardado en el Historial para copiarlo desde ahí.",
    );
  });

  it("si el guardado falla, el dictado se pega igual", async () => {
    const pegados: string[] = [];

    await expect(
      guardarYPegar(
        async () => false,
        async () => {
          pegados.push(dictado);
        },
      ),
    ).resolves.toBeUndefined();

    expect(pegados).toEqual([dictado]);
  });

  it("un guardado que tira error tampoco frena el pegado", async () => {
    const pegados: string[] = [];

    await guardarYPegar(
      () => Promise.reject(new Error("database is locked")),
      async () => {
        pegados.push(dictado);
      },
    );

    expect(pegados).toEqual([dictado]);
  });

  it("si fallan los dos, el error no promete el Historial", async () => {
    const error = await guardarYPegar(
      async () => false,
      () => Promise.reject(errorDelPortapapeles),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DictationError);
    expect((error as DictationError).hint).toBe("Tampoco se pudo guardar en el Historial.");
    expect((error as DictationError).hint).not.toContain("Quedó guardado");
  });
});
