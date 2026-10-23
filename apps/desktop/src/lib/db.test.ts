import { describe, expect, it } from "vitest";

import { escapeLikePattern, pruneCutoff } from "./db";

describe("escapeLikePattern", () => {
  it("no toca un término normal", () => {
    expect(escapeLikePattern("contador")).toBe("contador");
    expect(escapeLikePattern("reunión del jueves")).toBe("reunión del jueves");
  });

  it("escapa el porcentaje, que si no traería todo el historial", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
  });

  it("escapa el guión bajo, que si no sería un comodín de un carácter", () => {
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("escapa la propia barra invertida, que es el ESCAPE de la consulta", () => {
    expect(escapeLikePattern("C:\\Users")).toBe("C:\\\\Users");
  });

  it("escapa todas las apariciones, no sólo la primera", () => {
    expect(escapeLikePattern("%_%")).toBe("\\%\\_\\%");
  });

  it("deja pasar el término vacío", () => {
    expect(escapeLikePattern("")).toBe("");
  });
});

/**
 * Esta función decide qué dictados se destruyen, y no hay copia en ningún lado.
 * Los casos que importan son los degenerados: si un `days` roto produjera
 * una fecha en vez de `null`, el `DELETE` se ejecutaría con un corte inventado.
 */
describe("pruneCutoff", () => {
  const ahora = new Date("2026-09-06T12:00:00.000Z");

  it("corta exactamente `days` días atrás", () => {
    expect(pruneCutoff(90, ahora)).toBe("2026-06-08T12:00:00.000Z");
    expect(pruneCutoff(1, ahora)).toBe("2026-09-05T12:00:00.000Z");
  });

  it("devuelve null cuando no hay que podar nada", () => {
    expect(pruneCutoff(0, ahora)).toBeNull();
    expect(pruneCutoff(-30, ahora)).toBeNull();
  });

  it("devuelve null ante un número roto, en vez de una fecha cualquiera", () => {
    expect(pruneCutoff(Number.NaN, ahora)).toBeNull();
    expect(pruneCutoff(Number.POSITIVE_INFINITY, ahora)).toBeNull();
    expect(pruneCutoff(Number.NEGATIVE_INFINITY, ahora)).toBeNull();
  });

  it("cubre el máximo de retención de un año sin desbordar", () => {
    // 365 es el tope duro de `MAX_RETENTION_DAYS` en settings.rs.
    expect(pruneCutoff(365, ahora)).toBe("2025-09-06T12:00:00.000Z");
  });
});
