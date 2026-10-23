import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { getSettings } from "../lib/bridge";
import {
  clearTranscriptions,
  countTranscriptions,
  countTranscriptionsMatching,
  deleteTranscription,
  listTranscriptions,
  type Cursor,
  type Transcription,
} from "../lib/db";
import { EVENTS } from "../lib/events";
import { num, relativeDayLabel } from "../lib/format";
import ConfirmDialog from "./ConfirmDialog";
import EntryRow from "./EntryRow";
import { SearchIcon } from "./icons";
import PanelHeader from "./PanelHeader";

/** Espera antes de consultar mientras se tipea, para no pegarle a la base en cada tecla. */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * A qué distancia del final del scroll se pide la página siguiente.
 *
 * Con margen, para que la página que sigue ya esté cuando se llega abajo y no se vea
 * el salto. 400 px es más o menos una pantalla de dictados cortos.
 */
const PREFETCH_MARGIN_PX = 400;

interface DayGroup {
  key: string;
  label: string;
  entries: Transcription[];
}

export default function HistoryPanel() {
  const [items, setItems] = useState<Transcription[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `null` = no se está confirmando nada. Un número = cuántos dictados se van a
  // borrar, ya consultado a la base.
  const [pendingWipe, setPendingWipe] = useState<number | null>(null);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);

  const scroller = useRef<HTMLDivElement>(null);

  /** Primera página: reemplaza lo que haya. */
  const refresh = useCallback(async (term: string) => {
    try {
      const [page, count] = await Promise.all([
        listTranscriptions(term),
        countTranscriptionsMatching(term),
      ]);
      setItems(page.items);
      setCursor(page.next);
      setTotal(count);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * La página siguiente, al llegar al final del scroll.
   *
   * `cursor` hace de guarda de "hay más": cuando la consulta devuelve `null` se deja
   * de pedir. `loadingMore` evita que dos eventos de scroll seguidos pidan la misma
   * página dos veces y la dupliquen en pantalla.
   */
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listTranscriptions(search, cursor);
      setItems((previos) => [...previos, ...page.items]);
      setCursor(page.next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, search]);

  useEffect(() => {
    const id = window.setTimeout(() => void refresh(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [search, refresh]);

  // El subtítulo decía "se conservan los últimos 3 meses" con la retención
  // configurable entre un mes y un año.
  useEffect(() => {
    void getSettings()
      .then((settings) => setRetentionDays(settings.historyRetentionDays))
      .catch(() => setRetentionDays(null));
  }, []);

  // Un dictado nuevo entra por el atajo global, no por esta ventana: sin escuchar
  // el evento la lista quedaría vieja mientras el panel está abierto.
  useEffect(() => {
    const pending = listen(EVENTS.historyChanged, () => void refresh(search));
    return () => void pending.then((off) => off());
  }, [refresh, search]);

  const groups = useMemo(() => groupByDay(items), [items]);

  const remove = async (item: Transcription) => {
    await deleteTranscription(item.id);
    await refresh(search);
  };

  /**
   * Primer paso de "Borrar todo": preguntar, con el número puesto.
   *
   * El conteo sale de la base y no de `items.length` porque la lista está paginada
   * —de a 50— y decir "se van a borrar 50" cuando hay 1.247 sería mentir justo en el
   * momento en que la persona decide.
   */
  const askToWipe = async () => {
    try {
      setPendingWipe(await countTranscriptions());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const wipe = async () => {
    setPendingWipe(null);
    await clearTranscriptions();
    await refresh(search);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < PREFETCH_MARGIN_PX) {
      void loadMore();
    }
  };

  return (
    <>
      <PanelHeader title="Historial" subtitle={retentionSubtitle(retentionDays)} />

      <div className="toolbar">
        <div className="field">
          <SearchIcon />
          <input
            type="search"
            className="input"
            placeholder="Buscar en el historial"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {items.length > 0 && !search && (
          <button type="button" className="btn btn--danger" onClick={() => void askToWipe()}>
            Borrar todo
          </button>
        )}
      </div>

      <ConfirmDialog
        open={pendingWipe !== null}
        danger
        title="Borrar todo el historial"
        body={
          <>
            Se van a borrar <strong>{formatCount(pendingWipe ?? 0)}</strong>. No se puede
            deshacer y no hay ninguna copia: el historial vive sólo en esta computadora.
          </>
        }
        confirmLabel="Borrar todo"
        onConfirm={() => void wipe()}
        onCancel={() => setPendingWipe(null)}
      />

      <div
        className="panel__body scroll panel__body--flush"
        ref={scroller}
        onScroll={onScroll}
      >
        {error && <p className="notice notice--error">{error}</p>}

        {loading && (
          <div className="skeleton__stack" aria-hidden="true">
            <span className="skeleton skeleton--row" />
            <span className="skeleton skeleton--row" />
            <span className="skeleton skeleton--row" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="empty">
            <span className="empty__title">
              {search ? "Ningún dictado coincide" : "Todavía no hay dictados"}
            </span>
            <span className="empty__note">
              {search
                ? "Probá con otras palabras."
                : "Apretá el atajo y hablá: lo que dictes se guarda acá solo."}
            </span>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.key}>
            {/* La fecha queda clavada arriba mientras se recorre el día */}
            <div className="daygroup__label">{group.label}</div>
            <div className="daygroup__items">
              {group.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} onDelete={(item) => void remove(item)} />
              ))}
            </div>
          </div>
        ))}

        {/* Cuántos hay en total y cuántos se están viendo. Sin esto, una lista que
            se terminó no se distingue de una lista que se cortó — que es lo que
            pasaba con el tope de 200 filas. */}
        {!loading && total !== null && total > 0 && (
          <p className="listfoot">
            {cursor
              ? `${items.length} de ${formatCount(total)}${loadingMore ? " · cargando…" : ""}`
              : `${formatCount(total)}${search ? " coinciden" : ""}`}
          </p>
        )}
      </div>
    </>
  );
}

function formatCount(total: number): string {
  return total === 1 ? "1 dictado" : `${num(total)} dictados`;
}

/** El subtítulo dice la retención que está puesta, no una fija. */
function retentionSubtitle(days: number | null): string {
  if (days === null) return "Los dictados se guardan sólo en esta computadora.";
  if (days >= 365) return "Se conserva el último año.";
  if (days >= 30) {
    const meses = Math.round(days / 30);
    return meses === 1 ? "Se conserva el último mes." : `Se conservan los últimos ${meses} meses.`;
  }
  return `Se conservan los últimos ${days} días.`;
}

/** Agrupa por día calendario, respetando el orden que ya trae la consulta. */
function groupByDay(items: Transcription[]): DayGroup[] {
  const groups: DayGroup[] = [];

  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = Number.isNaN(date.getTime()) ? item.createdAt : date.toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.entries.push(item);
    } else {
      groups.push({ key, label: relativeDayLabel(date), entries: [item] });
    }
  }

  return groups;
}
