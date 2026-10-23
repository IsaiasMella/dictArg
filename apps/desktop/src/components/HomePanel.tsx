import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { getSettings } from "../lib/bridge";
import { listTranscriptions, usageSummary, type Transcription, type UsageSummary } from "../lib/db";
import { EVENTS } from "../lib/events";
import { costOf, formatUsd } from "../lib/pricing";
import { duration } from "../lib/format";
import EntryRow from "./EntryRow";
import PanelHeader from "./PanelHeader";
import Stat from "./Stat";
import type { Section } from "../App";

export default function HomePanel({ onOpen }: { onOpen: (section: Section) => void }) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [recent, setRecent] = useState<Transcription[]>([]);
  const [name, setName] = useState("");

  const load = useCallback(() => {
    void usageSummary().then(setUsage).catch(() => setUsage(null));
    void listTranscriptions("", null, 3)
      .then((page) => setRecent(page.items))
      .catch(() => setRecent([]));
    void getSettings()
      .then((settings) => setName(settings.userName.trim()))
      .catch(() => setName(""));
  }, []);

  useEffect(() => {
    load();
    const changed = listen(EVENTS.historyChanged, load);
    const settings = listen(EVENTS.settingsChanged, load);
    return () => {
      void changed.then((off) => off());
      void settings.then((off) => off());
    };
  }, [load]);

  const dictations = usage?.dictations ?? 0;
  const average = dictations > 0 ? (usage?.totalSeconds ?? 0) / dictations : 0;

  // Se cotiza por modelo y se suma, igual que el Dashboard.
  //
  // Antes se cotizaba el total contra `settings.model`, un campo guardado que nadie
  // actualizaba y que decía `whisper-large-v3` mientras se pagaba `nova-3`: la
  // tarjeta mostraba menos de la mitad del gasto real y no coincidía con el
  // Dashboard, que sí lo hacía bien.
  const apiCost = (usage?.byModel ?? []).reduce(
    (total, entry) => total + costOf(entry.seconds, entry.model),
    0,
  );

  return (
    <>
      <PanelHeader title={name ? `Hola, ${name}` : "Hola"} />
      <div className="panel__body scroll">
      <div className="stats">
        <Stat value={String(dictations)} label="dictados" />
        <Stat value={duration(usage?.totalSeconds ?? 0)} label="de audio" />
        <Stat value={dictations > 0 ? `${Math.round(average)} s` : "—"} label="promedio" />
        {/* Lo que costó transcribir todo esto con la API de transcripción, a la tarifa
            de `pricing.ts`. Es una estimación: la factura real está en tu cuenta. */}
        <Stat value={formatUsd(apiCost)} label="costo de API" />
      </div>

      <div className="promo">
        <div className="promo__text">
          <span className="promo__title">Enseñale tus palabras</span>
          <span className="promo__note">
            Nombres propios, jerga de tu laburo, marcas. Cargalas una vez y deja de escribirlas mal.
          </span>
        </div>
        <button type="button" className="promo__action" onClick={() => onOpen("diccionario")}>
          Abrir diccionario
        </button>
      </div>

      <div className="sectionhead">
        <h2 className="sectionhead__title">Últimos dictados</h2>
        {recent.length > 0 && (
          <button type="button" className="btn--tiny" onClick={() => onOpen("historial")}>
            Ver todo
          </button>
        )}
      </div>

      {recent.length === 0 ? (
        <div className="empty">
          <span className="empty__title">Todavía no dictaste nada</span>
          <span className="empty__note">
            Poné el cursor donde quieras escribir, apretá el atajo y hablá. Lo que dictes va a
            aparecer acá.
          </span>
        </div>
      ) : (
        <div className="entries">
          {recent.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
      </div>
    </>
  );
}
