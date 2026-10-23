import { describe, expect, it } from "vitest";

import { RATE_PER_HOUR, costOf, formatUsd, ratePerHour } from "./pricing";

describe("ratePerHour", () => {
  it("devuelve la tarifa del modelo que se usa hoy", () => {
    expect(ratePerHour("nova-3")).toBe(0.258);
  });

  it("conserva las tarifas de los modelos retirados", () => {
    // El historial viejo se sigue cotizando a lo que costó entonces, no a lo que
    // costaría hoy: el costo no se recalcula retroactivamente.
    expect(ratePerHour("whisper-large-v3")).toBe(0.111);
    expect(ratePerHour("whisper-large-v3-turbo")).toBe(0.04);
  });

  it("cae al modelo actual si el guardado no está en la tabla", () => {
    expect(ratePerHour("modelo-que-no-existe")).toBe(RATE_PER_HOUR["nova-3"]);
    expect(ratePerHour("")).toBe(RATE_PER_HOUR["nova-3"]);
  });
});

describe("costOf", () => {
  it("cobra por hora de audio", () => {
    expect(costOf(3600, "nova-3")).toBeCloseTo(0.258, 10);
    expect(costOf(1800, "nova-3")).toBeCloseTo(0.129, 10);
  });

  it("no cobra por duraciones vacías, negativas o rotas", () => {
    expect(costOf(0, "nova-3")).toBe(0);
    expect(costOf(-30, "nova-3")).toBe(0);
    expect(costOf(Number.NaN, "nova-3")).toBe(0);
    expect(costOf(Number.POSITIVE_INFINITY, "nova-3")).toBe(0);
  });
});

/**
 * La tarjeta de Inicio tiene que dar
 * **exactamente** el mismo número que el Dashboard.
 *
 * Inicio agrupa en SQL (`usageSummary().byModel`) y el Dashboard suma fila por fila
 * (`metrics.accumulate`). Son dos caminos distintos hacia el mismo total, y sólo
 * coinciden porque el costo es lineal en los segundos. Si alguien le agrega a la
 * tarifa un mínimo por pedido o un redondeo, dejan de coincidir — y este test es el
 * que lo va a decir.
 */
describe("Inicio y Dashboard cotizan igual", () => {
  const filas = [
    { seconds: 130, model: "nova-3" },
    { seconds: 45, model: "nova-3" },
    { seconds: 900, model: "whisper-large-v3" },
    { seconds: 62, model: "whisper-large-v3-turbo" },
    { seconds: 7, model: "nova-3" },
    { seconds: 300, model: "" },
  ];

  it("el agrupado por modelo da lo mismo que fila por fila", () => {
    const filaPorFila = filas.reduce((t, r) => t + costOf(r.seconds, r.model), 0);

    const porModelo = new Map<string, number>();
    for (const fila of filas) {
      porModelo.set(fila.model, (porModelo.get(fila.model) ?? 0) + fila.seconds);
    }
    const agrupado = [...porModelo].reduce((t, [model, seconds]) => t + costOf(seconds, model), 0);

    expect(agrupado).toBeCloseTo(filaPorFila, 12);
  });

  it("subestima a más de la mitad si se cotiza el total contra `whisper-large-v3`", () => {
    // Éste era el defecto exacto: se sumaban todos los segundos y se cotizaban
    // contra `settings.model`, que decía `whisper-large-v3` mientras se pagaba
    // `nova-3`. Se usa un historial todo en nova-3 porque es el caso real: el modelo
    // se cambió hace rato y las filas viejas son una minoría.
    const historialReal = [
      { seconds: 130, model: "nova-3" },
      { seconds: 45, model: "nova-3" },
      { seconds: 900, model: "nova-3" },
      { seconds: 62, model: "nova-3" },
    ];

    const totalSegundos = historialReal.reduce((t, r) => t + r.seconds, 0);
    const correcto = historialReal.reduce((t, r) => t + costOf(r.seconds, r.model), 0);
    const comoEstabaAntes = costOf(totalSegundos, "whisper-large-v3");

    expect(comoEstabaAntes).toBeLessThan(correcto / 2);
  });
});

describe("formatUsd", () => {
  it("usa cuatro decimales por debajo del centavo", () => {
    // Con dos decimales, cualquier uso corto muestra US$0.00 y se lee como error.
    expect(formatUsd(0.0043)).toBe("US$0.0043");
  });

  it("usa dos decimales de un centavo para arriba", () => {
    expect(formatUsd(1.5)).toBe("US$1.50");
    expect(formatUsd(0.01)).toBe("US$0.01");
  });

  it("muestra el cero sin decimales largos", () => {
    expect(formatUsd(0)).toBe("US$0.00");
  });
});
