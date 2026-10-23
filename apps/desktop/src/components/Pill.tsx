import { useEffect, useState } from "react";

import type { DictationSnapshot } from "../state/types";
import Waveform from "./Waveform";

/** Cuántas barras tiene el indicador de "transcribiendo". */
const LOADER_BARS = [0, 1, 2, 3, 4];

/** Cuánto tiempo se muestra el recordatorio del atajo al empezar a grabar. */
const HINT_MS = 3000;

function useElapsed(startedAt: number | undefined, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || !startedAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active, startedAt]);

  if (!startedAt || !active) return "0:00";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Segundos que faltan para el corte automático, o `null` si no hay consulta abierta. */
function useCountdown(cutsAt: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (cutsAt === undefined) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [cutsAt]);

  if (cutsAt === undefined) return null;
  return Math.max(0, Math.ceil((cutsAt - now) / 1000));
}

/**
 * Si todavía toca mostrar el recordatorio del atajo.
 *
 * Con su propio `setTimeout`. Antes esto era una comparación de `Date.now()` hecha
 * en el render, sin temporizador: el cartel se apagaba **de casualidad**, porque el
 * cronómetro re-renderiza cada 250 ms y en algún render la cuenta daba falso. Si
 * alguien optimizaba el cronómetro —o el dictado terminaba antes—, el cartel quedaba
 * pegado.
 */
function useHint(startedAt: number | undefined, active: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active || startedAt === undefined) {
      setVisible(false);
      return;
    }

    const restante = HINT_MS - (Date.now() - startedAt);
    if (restante <= 0) {
      setVisible(false);
      return;
    }

    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), restante);
    return () => window.clearTimeout(id);
  }, [active, startedAt]);

  return visible;
}

export default function Pill({ snapshot }: { snapshot: DictationSnapshot }) {
  const elapsed = useElapsed(snapshot.startedAt, snapshot.status === "recording");
  const remaining = useCountdown(snapshot.cutsAt);
  // La instrucción para frenar sólo hace falta al principio: quien ya sabe no
  // necesita leerla, y dejarla fija ensancha la pastilla todo el dictado.
  const showHint =
    useHint(snapshot.startedAt, snapshot.status === "recording") && snapshot.shortcut !== "";

  // En reposo no hay nada que comunicar, así que la pastilla se reduce a una
  // barrita sin contenido: ni punto ni texto.
  if (snapshot.status === "idle") {
    return snapshot.showWhenIdle ? <div className="pill pill--idle" /> : null;
  }

  // La consulta del tope de duración. Reemplaza al recordatorio del atajo
  // porque las dos cosas juntas no entran, y ésta es la urgente: si nadie contesta,
  // el dictado se corta.
  if (remaining !== null && snapshot.status === "recording") {
    return (
      <div className="pill pill--recording pill--asking">
        <Indicator snapshot={snapshot} />
        <span className="pill__label">{elapsed}</span>
        <span className="pill__ask">
          ¿Seguís dictando? {snapshot.shortcut || "El atajo"} para continuar · corta en{" "}
          {remaining} s
        </span>
      </div>
    );
  }

  return (
    <div className={`pill pill--${snapshot.status}`}>
      <Indicator snapshot={snapshot} />
      <span className="pill__label">{label(snapshot, elapsed)}</span>
      {showHint && <span className="pill__hint">{snapshot.shortcut} para terminar</span>}
    </div>
  );
}

function Indicator({ snapshot }: { snapshot: DictationSnapshot }) {
  switch (snapshot.status) {
    case "recording":
      return <Waveform active />;
    case "processing":
      // Las barras de la onda se quedan y pasan a moverse solas, como hace Wispr
      // Flow: la pastilla no cambia de forma, así que se lee como "lo que dijiste
      // se está procesando" y no como otra cosa que apareció. El spinner de antes
      // era un aro gris de 13 px y, con las animaciones de Windows apagadas, quedaba
      // quieto: la pastilla parecía colgada justo en el momento de esperar.
      return (
        <span className="pill__loader" aria-hidden="true">
          {LOADER_BARS.map((i) => (
            <i key={i} />
          ))}
        </span>
      );
    case "success":
      return <span className="pill__glyph" aria-hidden="true">&#10003;</span>;
    case "error":
      return <span className="pill__glyph" aria-hidden="true">!</span>;
    default:
      // idle nunca llega acá: sale antes con la barrita vacía.
      return null;
  }
}

function label(snapshot: DictationSnapshot, elapsed: string): string {
  switch (snapshot.status) {
    case "recording":
      return elapsed;
    case "processing":
      return "Transcribiendo";
    case "success":
      return "Listo";
    case "error":
      return truncate(snapshot.message ?? "Error", 34);
    default:
      return "";
  }
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
}
