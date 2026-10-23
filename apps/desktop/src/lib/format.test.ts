import { describe, expect, it } from "vitest";

import {
  LOCALE,
  clockDuration,
  comma,
  dayLabel,
  duration,
  fullDate,
  hoursLabel,
  monthLabel,
  num,
  relativeDayLabel,
  shortDate,
  timeOfDay,
} from "./format";

describe("números", () => {
  it("usa punto como separador de miles", () => {
    expect(num(9276)).toBe("9.276");
  });

  it("redondea antes de separar", () => {
    expect(num(1234.6)).toBe("1.235");
  });

  it("usa coma decimal", () => {
    expect(comma(1.25)).toBe("1,3");
    expect(comma(1.25, 2)).toBe("1,25");
  });
});

describe("duration", () => {
  it("elige la unidad que se lee mejor", () => {
    expect(duration(45)).toBe("45 s");
    expect(duration(90)).toBe("1,5 min");
    expect(duration(3700)).toBe("1,0 h");
  });

  it("respeta los bordes de cada unidad", () => {
    expect(duration(59)).toBe("59 s");
    expect(duration(60)).toBe("1,0 min");
    expect(duration(3599)).toBe("60,0 min");
    expect(duration(3600)).toBe("1,0 h");
  });

  it("devuelve el vacío que le pasen ante nada o basura", () => {
    expect(duration(0)).toBe("—");
    expect(duration(-5)).toBe("—");
    expect(duration(Number.NaN)).toBe("—");
    expect(duration(0, "0 s")).toBe("0 s");
  });
});

describe("clockDuration", () => {
  it("usa formato de reloj a partir del minuto", () => {
    // Convive con `duration` a propósito: en una fila del historial "1:30" se
    // compara de un vistazo con las de arriba y abajo.
    expect(clockDuration(90)).toBe("1:30");
    expect(clockDuration(605)).toBe("10:05");
  });

  it("abajo del minuto usa segundos, igual que duration", () => {
    expect(clockDuration(45)).toBe("45 s");
  });

  it("rellena los segundos a dos dígitos", () => {
    expect(clockDuration(61)).toBe("1:01");
  });

  it("difiere de duration justamente arriba del minuto", () => {
    expect(clockDuration(90)).not.toBe(duration(90));
    expect(clockDuration(45)).toBe(duration(45));
  });
});

describe("hoursLabel", () => {
  it("abajo de una hora pasa a minutos", () => {
    expect(hoursLabel(0.5)).toBe("30 min");
  });

  it("de una hora para arriba usa horas con coma", () => {
    expect(hoursLabel(2.25)).toBe("2,3 h");
  });

  it("devuelve el vacío ante nada", () => {
    expect(hoursLabel(0)).toBe("—");
    expect(hoursLabel(Number.NaN)).toBe("—");
  });
});

/**
 * El locale se fija y no se deja en `undefined`.
 *
 * Con `undefined`, `toLocale*` usa el del sistema, y una interfaz escrita entera en
 * castellano terminaba mezclando "27 de agosto" con "August 27" en la misma pantalla
 * según la máquina.
 */
describe("fechas, siempre en el mismo locale", () => {
  const agosto = new Date(2026, 7, 27, 14, 35);

  it("el locale del producto es es-AR", () => {
    expect(LOCALE).toBe("es-AR");
  });

  it("escribe el mes en castellano", () => {
    expect(shortDate(agosto)).toContain("agosto");
    expect(shortDate(agosto)).not.toContain("August");
  });

  it("usa día/mes/año y no el orden estadounidense", () => {
    expect(fullDate(agosto)).toBe("27/08/2026");
  });

  it("abrevia el mes desde una clave YYYY-MM-DD", () => {
    expect(dayLabel("2026-08-27")).toContain("27");
    expect(dayLabel("")).toBe("—");
  });

  it("escribe el mes completo desde una clave YYYY-MM", () => {
    expect(monthLabel("2026-08")).toContain("agosto");
    expect(monthLabel("2026-08")).toContain("2026");
  });

  it("da la hora en 24 h", () => {
    expect(timeOfDay(agosto.toISOString())).toBe("14:35");
  });

  it("no rompe con una fecha corrupta", () => {
    expect(timeOfDay("no soy una fecha")).toBe("");
    expect(relativeDayLabel(new Date("no soy una fecha"))).toBe("");
  });
});

describe("relativeDayLabel", () => {
  const hoy = new Date(2026, 8, 6, 15);

  it("dice Hoy y Ayer", () => {
    expect(relativeDayLabel(new Date(2026, 8, 6, 9), hoy)).toBe("Hoy");
    expect(relativeDayLabel(new Date(2026, 8, 5, 23), hoy)).toBe("Ayer");
  });

  it("de anteayer para atrás escribe la fecha con año", () => {
    const etiqueta = relativeDayLabel(new Date(2026, 8, 4), hoy);
    expect(etiqueta).toContain("2026");
    expect(etiqueta).toContain("septiembre");
  });

  it("cruza el cambio de mes sin confundirse", () => {
    const primeroDeSeptiembre = new Date(2026, 8, 1, 10);
    expect(relativeDayLabel(new Date(2026, 7, 31, 10), primeroDeSeptiembre)).toBe("Ayer");
  });
});
