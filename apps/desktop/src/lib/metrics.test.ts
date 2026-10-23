import { describe, expect, it } from "vitest";

import type { UsageRow } from "./db";
import { TYPING_WPM, computeMetrics } from "./metrics";

/**
 * Las fechas se construyen en hora **local**, no en UTC.
 *
 * `computeMetrics` trabaja con días del calendario del usuario (`startOfDay`,
 * `getHours`, `getDay`), así que un test escrito con `"2026-09-06T00:00:00Z"` pasa o
 * falla según la zona horaria de la máquina que lo corre. Ésa es exactamente la clase
 * de error que estos tests existen para atajar.
 */
function fila(
  fecha: Date,
  { seconds = 60, words = 100, model = "nova-3" }: Partial<Omit<UsageRow, "createdAt">> = {},
): UsageRow {
  return { createdAt: fecha.toISOString(), seconds, words, model };
}

/** Un día a las 10 de la mañana, hora local. */
function dia(año: number, mes: number, día: number, hora = 10): Date {
  return new Date(año, mes - 1, día, hora, 0, 0, 0);
}

const HOY = dia(2026, 9, 6, 15);

describe("computeMetrics", () => {
  it("devuelve null sin dictados", () => {
    expect(computeMetrics([], HOY)).toBeNull();
  });

  it("suma los totales", () => {
    const m = computeMetrics(
      [
        fila(dia(2026, 9, 6), { seconds: 30, words: 50 }),
        fila(dia(2026, 9, 6), { seconds: 90, words: 150 }),
      ],
      HOY,
    );

    expect(m?.total.dictations).toBe(2);
    expect(m?.total.seconds).toBe(120);
    expect(m?.total.words).toBe(200);
  });

  it("separa hoy, la semana y el mes por día de calendario", () => {
    const m = computeMetrics(
      [
        fila(dia(2026, 9, 6)), // hoy
        fila(dia(2026, 9, 2)), // esta semana
        fila(dia(2026, 8, 20)), // este mes (30 días)
        fila(dia(2026, 6, 1)), // más viejo
      ],
      HOY,
    );

    expect(m?.today.dictations).toBe(1);
    expect(m?.week.dictations).toBe(2);
    expect(m?.month.dictations).toBe(3);
    expect(m?.total.dictations).toBe(4);
  });

  it("cuenta la semana por días del almanaque, no por 168 horas", () => {
    // Un dictado de hace 5 días a las 23:00 entra, aunque el reloj diga otra cosa:
    // la semana se cuenta por días, que es lo que la persona quiere decir.
    const m = computeMetrics([fila(dia(2026, 9, 1, 23))], HOY);
    expect(m?.week.dictations).toBe(1);
  });

  describe("racha", () => {
    it("cuenta los días seguidos hasta hoy", () => {
      const m = computeMetrics(
        [fila(dia(2026, 9, 4)), fila(dia(2026, 9, 5)), fila(dia(2026, 9, 6))],
        HOY,
      );
      expect(m?.streak).toBe(3);
    });

    it("sigue viva si hoy todavía no dictaste", () => {
      // Cortarla a la medianoche sería castigar por no haber empezado el día
      // dictando. Se cuenta desde ayer.
      const m = computeMetrics([fila(dia(2026, 9, 4)), fila(dia(2026, 9, 5))], HOY);
      expect(m?.streak).toBe(2);
    });

    it("se corta con un día salteado", () => {
      const m = computeMetrics(
        [fila(dia(2026, 9, 1)), fila(dia(2026, 9, 2)), fila(dia(2026, 9, 6))],
        HOY,
      );
      expect(m?.streak).toBe(1);
    });

    it("es cero si el último dictado es de anteayer o antes", () => {
      const m = computeMetrics([fila(dia(2026, 9, 3))], HOY);
      expect(m?.streak).toBe(0);
    });

    it("varios dictados en el mismo día cuentan como un día", () => {
      const m = computeMetrics(
        [fila(dia(2026, 9, 6, 9)), fila(dia(2026, 9, 6, 18)), fila(dia(2026, 9, 5))],
        HOY,
      );
      expect(m?.streak).toBe(2);
      expect(m?.activeDays).toBe(2);
    });

    it("el audio por día se divide por los días con uso, no por los transcurridos", () => {
      // Es lo que contesta "cuánto grabo por día". Contra los días corridos, un fin de
      // semana sin trabajar hunde el número a la mitad y deja de decir nada.
      const m = computeMetrics(
        [
          fila(dia(2026, 9, 1), { seconds: 120 }),
          fila(dia(2026, 9, 1), { seconds: 60 }),
          fila(dia(2026, 9, 6), { seconds: 60 }),
        ],
        HOY,
      );

      // 240 segundos en dos días con uso, aunque hayan pasado seis.
      expect(m?.activeDays).toBe(2);
      expect(m?.daysSinceFirst).toBe(6);
      expect(m?.secondsPerActiveDay).toBe(120);
    });
  });

  it("cuenta los días desde el primero incluyendo hoy", () => {
    const m = computeMetrics([fila(dia(2026, 9, 4)), fila(dia(2026, 9, 6))], HOY);
    expect(m?.daysSinceFirst).toBe(3);
  });

  it("un solo dictado hoy da un día, no cero", () => {
    const m = computeMetrics([fila(dia(2026, 9, 6))], HOY);
    expect(m?.daysSinceFirst).toBe(1);
  });

  it("encuentra el día con más dictados", () => {
    const m = computeMetrics(
      [
        fila(dia(2026, 9, 4)),
        fila(dia(2026, 9, 5)),
        fila(dia(2026, 9, 5)),
        fila(dia(2026, 9, 5)),
        fila(dia(2026, 9, 6)),
      ],
      HOY,
    );
    expect(m?.bestDay.dictations).toBe(3);
  });

  describe("mediana de duración", () => {
    it("con una cantidad impar toma el del medio", () => {
      const m = computeMetrics(
        [
          fila(dia(2026, 9, 6), { seconds: 10 }),
          fila(dia(2026, 9, 6), { seconds: 100 }),
          fila(dia(2026, 9, 6), { seconds: 40 }),
        ],
        HOY,
      );
      expect(m?.medianSeconds).toBe(40);
    });

    it("con una cantidad par promedia los dos del medio", () => {
      const m = computeMetrics(
        [
          fila(dia(2026, 9, 6), { seconds: 10 }),
          fila(dia(2026, 9, 6), { seconds: 20 }),
          fila(dia(2026, 9, 6), { seconds: 40 }),
          fila(dia(2026, 9, 6), { seconds: 100 }),
        ],
        HOY,
      );
      expect(m?.medianSeconds).toBe(30);
    });

    it("no depende del orden en que vengan las filas", () => {
      const segundos = [90, 5, 45, 200, 12];
      const filas = segundos.map((s) => fila(dia(2026, 9, 6), { seconds: s }));
      const alReves = [...filas].reverse();
      expect(computeMetrics(filas, HOY)?.medianSeconds).toBe(
        computeMetrics(alReves, HOY)?.medianSeconds,
      );
    });
  });

  it("clasifica las duraciones en los cuatro tramos, con los bordes donde dice", () => {
    const m = computeMetrics(
      [
        fila(dia(2026, 9, 6), { seconds: 9 }), // menos de 10
        fila(dia(2026, 9, 6), { seconds: 10 }), // 10 a 30
        fila(dia(2026, 9, 6), { seconds: 29 }), // 10 a 30
        fila(dia(2026, 9, 6), { seconds: 30 }), // 30 a 60
        fila(dia(2026, 9, 6), { seconds: 60 }), // más de 1 min
      ],
      HOY,
    );

    expect(m?.durations.map((d) => d.value)).toEqual([1, 2, 1, 1]);
  });

  it("pone el lunes primero en los días de la semana", () => {
    // 2026-09-07 es lunes.
    const m = computeMetrics([fila(dia(2026, 9, 7))], dia(2026, 9, 7, 15));
    expect(m?.weekdays[0]).toEqual({ label: "Lun", value: 1 });
    expect(m?.weekdays[6].label).toBe("Dom");
  });

  it("agrupa por hora local del dictado", () => {
    const m = computeMetrics([fila(dia(2026, 9, 6, 14))], HOY);
    expect(m?.hours[14].value).toBe(1);
    expect(m?.hours[13].value).toBe(0);
  });

  it("agrupa por modelo y ordena por segundos", () => {
    const m = computeMetrics(
      [
        fila(dia(2026, 9, 6), { seconds: 10, model: "whisper-large-v3" }),
        fila(dia(2026, 9, 6), { seconds: 100, model: "nova-3" }),
      ],
      HOY,
    );

    expect(m?.models[0].model).toBe("nova-3");
    expect(m?.models).toHaveLength(2);
  });

  it("nombra los modelos vacíos en vez de mostrar una fila en blanco", () => {
    const m = computeMetrics([fila(dia(2026, 9, 6), { model: "" })], HOY);
    expect(m?.models[0].model).toBe("(sin registrar)");
  });

  describe("proyección mensual", () => {
    it("recién instalada divide por los días de uso, no por 30", () => {
      // Con tres días de uso, dividir por 30 daría una proyección diez veces más
      // chica que la realidad y no serviría para decidir nada.
      const m = computeMetrics([fila(dia(2026, 9, 4)), fila(dia(2026, 9, 6))], HOY);
      expect(m?.projectionDays).toBe(3);
    });

    it("con más de un mes encima se estabiliza en 30", () => {
      const m = computeMetrics([fila(dia(2026, 5, 1)), fila(dia(2026, 9, 6))], HOY);
      expect(m?.projectionDays).toBe(30);
    });
  });

  it("calcula el ahorro contra tipear, y nunca lo deja negativo", () => {
    // 400 palabras a 40 ppm son 10 minutos de tipeo contra 1 minuto de dictado.
    const m = computeMetrics([fila(dia(2026, 9, 6), { seconds: 60, words: 400 })], HOY);

    expect(m?.typingHours).toBeCloseTo(400 / TYPING_WPM / 60, 10);
    expect(m?.savedHours).toBeGreaterThan(0);

    // Un dictado larguísimo con dos palabras: tipearlo hubiera sido más rápido.
    // El cartel dice "ahorraste", así que el piso es cero, no un número negativo.
    const lento = computeMetrics([fila(dia(2026, 9, 6), { seconds: 3600, words: 2 })], HOY);
    expect(lento?.savedHours).toBe(0);
  });

  it("no divide por cero cuando no hay palabras ni segundos", () => {
    const m = computeMetrics([fila(dia(2026, 9, 6), { seconds: 0, words: 0 })], HOY);

    expect(m?.wordsPerMinute).toBe(0);
    expect(m?.costPerThousandWords).toBe(0);
    expect(m?.averageSeconds).toBe(0);
    expect(Number.isFinite(m?.projectedMonthlyCost ?? Number.NaN)).toBe(true);
  });

  /**
   * `firstAt` arrancaba con `new Date(rows[0].createdAt)` sin validar: un
   * `created_at` corrupto en la primera fila lo dejaba en `Invalid Date`, y desde ahí
   * todas las comparaciones daban falso en silencio. `daysSinceFirst` quedaba `NaN` y
   * se propagaba a la proyección de costo y a la adherencia del informe.
   */
  describe("filas con la fecha rota", () => {
    it("ignora una fila corrupta y calcula con el resto", () => {
      const m = computeMetrics(
        [
          { createdAt: "no soy una fecha", seconds: 60, words: 100, model: "nova-3" },
          fila(dia(2026, 9, 4)),
          fila(dia(2026, 9, 6)),
        ],
        HOY,
      );

      expect(m?.total.dictations).toBe(2);
      expect(m?.daysSinceFirst).toBe(3);
      expect(Number.isNaN(m?.daysSinceFirst ?? Number.NaN)).toBe(false);
    });

    it("no se rompe si la corrupta es la primera del arreglo", () => {
      const m = computeMetrics(
        [
          { createdAt: "", seconds: 30, words: 10, model: "nova-3" },
          fila(dia(2026, 9, 6)),
        ],
        HOY,
      );

      expect(m?.firstAt.getTime()).not.toBeNaN();
      expect(m?.lastAt.getTime()).not.toBeNaN();
      expect(m?.streak).toBe(1);
    });

    it("devuelve null si TODAS las fechas están rotas", () => {
      // Devolver ceros se leería como "no usaste la app", que es falso y peor que
      // no mostrar nada.
      const m = computeMetrics(
        [{ createdAt: "basura", seconds: 60, words: 100, model: "nova-3" }],
        HOY,
      );
      expect(m).toBeNull();
    });
  });
});
