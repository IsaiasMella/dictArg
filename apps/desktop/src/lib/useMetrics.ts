import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { listUsageRows } from "./db";
import { EVENTS } from "./events";
import { computeMetrics, type Metrics } from "./metrics";

/**
 * Las métricas del uso, calculadas una sola vez por cambio del historial.
 *
 * `DashboardPanel` y `UsagePanel` llamaban cada uno a `listUsageRows()` —que trae
 * **todas** las filas, sin límite— y recalculaban las 150 líneas de aritmética
 * enteras ante cada `historyChanged`, o sea después de cada dictado. Con las dos
 * pantallas montadas, eso son dos barridos completos de la tabla y dos cálculos
 * idénticos cada vez que alguien termina de hablar.
 *
 * El caché vive a nivel de módulo y no en un contexto de React porque el consumo es
 * exactamente éste: dos pantallas que quieren el mismo número. Un contexto agregaría
 * un proveedor y un árbol para resolver algo que resuelven quince líneas.
 */

let cache: { metrics: Metrics | null } | null = null;
let enVuelo: Promise<Metrics | null> | null = null;

/** Quién quiere enterarse cuando el caché se renueva. */
const suscriptores = new Set<(metrics: Metrics | null) => void>();

async function recalcular(): Promise<Metrics | null> {
  // Si ya hay una consulta en curso, se comparte en vez de largar otra: las dos
  // pantallas se montan casi al mismo tiempo y las dos piden lo mismo.
  enVuelo ??= listUsageRows()
    .then((rows) => computeMetrics(rows))
    .catch(() => null)
    .finally(() => {
      enVuelo = null;
    });

  const metrics = await enVuelo;
  cache = { metrics };
  suscriptores.forEach((avisar) => avisar(metrics));
  return metrics;
}

/** Tira el caché. Lo llama el listener de `historyChanged`. */
function invalidar(): void {
  cache = null;
  void recalcular();
}

// Un solo listener para todo el módulo, montado la primera vez que alguien usa el
// hook. Antes había uno por pantalla.
let escuchando = false;

function escucharCambios(): void {
  if (escuchando) return;
  escuchando = true;
  void listen(EVENTS.historyChanged, invalidar);
}

export interface MetricsState {
  metrics: Metrics | null;
  loading: boolean;
}

export function useMetrics(): MetricsState {
  const [state, setState] = useState<MetricsState>(() =>
    cache ? { metrics: cache.metrics, loading: false } : { metrics: null, loading: true },
  );

  useEffect(() => {
    escucharCambios();

    const avisar = (metrics: Metrics | null) => setState({ metrics, loading: false });
    suscriptores.add(avisar);

    if (cache) {
      avisar(cache.metrics);
    } else {
      void recalcular();
    }

    return () => {
      suscriptores.delete(avisar);
    };
  }, []);

  return state;
}
