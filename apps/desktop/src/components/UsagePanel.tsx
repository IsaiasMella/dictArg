import { useState } from "react";

import { copyText } from "../lib/bridge";
import { duration, num } from "../lib/format";
import { buildReport } from "../lib/report";
import { useMetrics } from "../lib/useMetrics";

/**
 * Lo que cada usuario ve de su propio uso, y lo que se lleva al portapapeles.
 *
 * Las dos cosas no son la misma a propósito. En pantalla van tres números que le
 * sirven a quien dicta —cuánto habló, cuántas veces, cuántos días—: lo que cuesta
 * operarlo es un dato del producto, no suyo. El informe que se copia sí lo trae,
 * porque su destino es quien paga la API.
 *
 * Ni una ni otra incluyen una palabra de lo dictado: son cuentas, no contenido.
 */
export default function UsagePanel({ model, userName }: { model: string; userName: string }) {
  const { metrics } = useMetrics();
  const [copied, setCopied] = useState(false);

  if (!metrics) return null;

  const m = metrics;

  const copy = async () => {
    await copyText(buildReport(m, model, userName));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="setting setting--stacked setting--usage">
      <div className="setting__text">
        <span className="setting__label">Tu uso</span>
        <span className="setting__note">
          Sólo cuentas: cuánto hablaste, cuántas veces y qué días. El informe no incluye ni una
          palabra de lo que dictaste, así que se puede compartir sin entregar nada privado.
        </span>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat__value">{duration(m.total.seconds)}</span>
          <span className="stat__label">de audio dictado</span>
        </div>
        <div className="stat">
          <span className="stat__value">{num(m.total.dictations)}</span>
          <span className="stat__label">dictados</span>
        </div>
        <div className="stat">
          <span className="stat__value">{num(m.activeDays)}</span>
          <span className="stat__label">días usados</span>
        </div>
      </div>

      <button type="button" className="btn btn--start" onClick={() => void copy()}>
        {copied ? "Informe copiado" : "Copiar informe de uso"}
      </button>
    </section>
  );
}
