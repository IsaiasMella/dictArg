import { comma, dayLabel, duration, hoursLabel, monthLabel, num, shortDate } from "../lib/format";
import { TYPING_WPM, type Bucket, type Period } from "../lib/metrics";
import { useMetrics } from "../lib/useMetrics";
import { formatUsd, ratePerHour } from "../lib/pricing";
import PanelHeader from "./PanelHeader";
import Stat from "./Stat";

/**
 * Todo lo que se puede saber del uso a partir del historial local.
 *
 * Las cuentas viven en `lib/metrics.ts`; acá sólo se muestran.
 */
export default function DashboardPanel() {
  const { metrics, loading } = useMetrics();

  if (loading) {
    return (
      <>
        <PanelHeader title="Dashboard" subtitle="Tu uso de Dictarg, medido." />
        <div className="panel__body scroll">
          <div className="stats">
            <span className="skeleton skeleton--card" />
            <span className="skeleton skeleton--card" />
            <span className="skeleton skeleton--card" />
            <span className="skeleton skeleton--card" />
          </div>
          <div className="skeleton skeleton--row skeleton--chart" />
        </div>
      </>
    );
  }

  if (!metrics) {
    return (
      <>
        <PanelHeader title="Dashboard" subtitle="Tu uso de Dictarg, medido." />
        <div className="panel__body scroll">
          <div className="empty">
            <span className="empty__title">Todavía no hay nada que medir</span>
            <span className="empty__note">
              En cuanto dictes por primera vez, acá va a aparecer cuánto usás Dictarg, cuánto
              hablaste y cuánto costaría pagarlo por API.
            </span>
          </div>
        </div>
      </>
    );
  }

  const m = metrics;
  const costPerDictation = m.total.dictations > 0 ? m.total.cost / m.total.dictations : 0;

  return (
    <>
      <PanelHeader title="Dashboard" subtitle="Tu uso de Dictarg, medido." />
      <div className="panel__body scroll">
        <div className="stats">
          <Stat value={num(m.total.dictations)} label="dictados" />
          <Stat value={duration(m.total.seconds)} label="de audio" />
          <Stat value={formatUsd(m.total.cost)} label="costo de API" />
          <Stat value={`${num(m.daysSinceFirst)} d`} label={`desde el ${shortDate(m.firstAt)}`} />
        </div>

        <div className="sectionhead">
          <h2 className="sectionhead__title">Cuánto lo usás</h2>
        </div>

        <div className="dtable__wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Período</th>
                <th className="num">Dictados</th>
                <th className="num">Audio</th>
                <th className="num">Promedio</th>
                <th className="num">Costo</th>
              </tr>
            </thead>
            <tbody>
              <PeriodRow label="Hoy" period={m.today} />
              <PeriodRow label="Últimos 7 días" period={m.week} />
              <PeriodRow label="Últimos 30 días" period={m.month} />
              <PeriodRow label="Todo" period={m.total} />
            </tbody>
          </table>
        </div>

        <div className="sectionhead">
          <h2 className="sectionhead__title">Tu ritmo</h2>
        </div>

        {/* Los días seguidos y la racha estuvieron acá y se sacaron: medían constancia,
            que es una métrica de aplicación de gimnasio y no dice nada sobre si Voice
            sirve. Lo que quedó contesta "cuánto dicto cuando dicto". El informe que se
            copia sí las sigue calculando — es otro documento y otro uso. */}
        <div className="stats">
          <Stat value={comma(m.perActiveDay)} label="dictados por día que usás Dictarg" />
          <Stat value={duration(m.secondsPerActiveDay)} label="de audio por día que usás Dictarg" />
          <Stat
            value={`${num(m.bestDay.dictations)} dictados`}
            label={`el mejor día, ${dayLabel(m.bestDay.day)}`}
          />
        </div>

        <div className="sectionhead">
          <h2 className="sectionhead__title">Lo que dictaste</h2>
        </div>

        <div className="stats">
          <Stat value={num(m.total.words)} label="palabras" />
          <Stat value={num(Math.round(m.wordsPerMinute))} label="palabras por minuto" />
          <Stat value={hoursLabel(m.savedHours)} label={`ahorradas contra tipear a ${TYPING_WPM} ppm`} />
          <Stat value={formatUsd(m.costPerThousandWords)} label="cada mil palabras" />
        </div>

        <p className="dash__note">
          Tipeando esas {num(m.total.words)} palabras a {TYPING_WPM} por minuto habrías tardado{" "}
          {hoursLabel(m.typingHours)}. Dictarlas te llevó {duration(m.total.seconds)}.
        </p>

        <div className="sectionhead">
          <h2 className="sectionhead__title">Cómo son tus dictados</h2>
        </div>

        <div className="stats">
          <Stat value={duration(m.averageSeconds)} label="duración promedio" />
          <Stat value={duration(m.medianSeconds)} label="mediana" />
          <Stat value={duration(m.longestSeconds)} label="el más largo" />
        </div>

        <Bars items={m.durations} total={m.total.dictations} />

        <div className="sectionhead">
          <h2 className="sectionhead__title">Costo</h2>
        </div>

        <div className="stats">
          <Stat value={formatUsd(m.projectedMonthlyCost)} label="por mes, a este ritmo" />
          <Stat value={formatUsd(costPerDictation)} label="por dictado" />
          <Stat value={formatUsd(m.total.cost)} label="gastado en total" />
        </div>

        <p className="dash__note">
          La proyección estira a un mes lo que gastaste en{" "}
          {m.projectionDays === 1 ? "el último día" : `los últimos ${m.projectionDays} días`}. Es la
          cuenta que dice cuánto costaría en API un usuario que dicte tanto como vos.
        </p>

        {m.models.length > 0 && (
          <div className="dtable__wrap dtable__wrap--spaced">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th className="num">Dictados</th>
                  <th className="num">Audio</th>
                  <th className="num">Tarifa</th>
                  <th className="num">Costo</th>
                </tr>
              </thead>
              <tbody>
                {m.models.map((model) => (
                  <tr key={model.model}>
                    <td>{model.model}</td>
                    <td className="num">{num(model.dictations)}</td>
                    <td className="num">{duration(model.seconds)}</td>
                    <td className="num">US${ratePerHour(model.model)}/h</td>
                    <td className="num">{formatUsd(model.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="sectionhead">
          <h2 className="sectionhead__title">Mes a mes</h2>
        </div>

        <div className="dtable__wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="num">Dictados</th>
                <th className="num">Audio</th>
                <th className="num">Costo</th>
              </tr>
            </thead>
            <tbody>
              {m.months.map((month) => (
                <tr key={month.month}>
                  <td>{monthLabel(month.month)}</td>
                  <td className="num">{num(month.dictations)}</td>
                  <td className="num">{duration(month.seconds)}</td>
                  <td className="num">{formatUsd(month.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="dash__note dash__note--tight">
          Todo esto sale del historial de esta computadora, así que llega hasta donde llegue la
          retención configurada en Ajustes: lo que se podó ya no cuenta. El último dictado fue el{" "}
          {shortDate(m.lastAt)}.
        </p>
      </div>
    </>
  );
}

function PeriodRow({ label, period }: { label: string; period: Period }) {
  const average = period.dictations > 0 ? period.seconds / period.dictations : 0;
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{num(period.dictations)}</td>
      <td className="num">{duration(period.seconds)}</td>
      <td className="num">{period.dictations > 0 ? duration(average) : "—"}</td>
      <td className="num">{formatUsd(period.cost)}</td>
    </tr>
  );
}

/** Barras horizontales con la cuenta al costado. */
function Bars({ items, total }: { items: Bucket[]; total: number }) {
  return (
    <div className="bars">
      {items.map((item) => (
        <div className="bar" key={item.label}>
          <span className="bar__label">{item.label}</span>
          <span className="bar__track">
            <span
              className="bar__fill"
              style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%` }}
            />
          </span>
          <span className="bar__value">{num(item.value)}</span>
        </div>
      ))}
    </div>
  );
}
