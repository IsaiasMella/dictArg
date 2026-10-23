import { useCallback, useEffect, useState } from "react";

import {
  addDictionaryTerm,
  listDictionary,
  removeDictionaryTerm,
  type DictionaryTerm,
} from "../lib/db";
import ConfirmDialog from "./ConfirmDialog";
import { BookIcon, TrashIcon } from "./icons";
import PanelHeader from "./PanelHeader";

/**
 * El diccionario del usuario.
 *
 * Esta pantalla sólo lista, agrega y borra los términos guardados en SQLite. El sesgo
 * del reconocimiento y el reemplazo de las confusiones los aplica `transcription.ts`
 * al dictar.
 */

/** Cómo se separan las confusiones en el campo de texto. */
const SEPARADOR = ",";

/**
 * Tope de largo de un término, el mismo que valida `addDictionaryTerm` en `db.ts`.
 *
 * Está repetido acá para avisar antes de intentar guardar. El que manda es el de
 * `db.ts`: éste es una cortesía, no una validación.
 */
const MAX_LARGO = 80;

type Estado =
  | { tipo: "cargando" }
  | { tipo: "listo"; terminos: DictionaryTerm[] }
  | { tipo: "error"; mensaje: string };

type Aviso = { texto: string } | null;

export default function DictionaryPanel() {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [termino, setTermino] = useState("");
  const [confusiones, setConfusiones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  // `null` = no se está confirmando nada.
  const [porBorrar, setPorBorrar] = useState<DictionaryTerm | null>(null);

  const cargar = useCallback(async () => {
    try {
      setEstado({ tipo: "listo", terminos: await listDictionary() });
    } catch (error) {
      setEstado({ tipo: "error", mensaje: mensajeDe(error) });
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const agregar = async () => {
    const limpio = termino.trim();
    if (!limpio) return;

    if (estado.tipo !== "listo") return;

    setGuardando(true);
    setAviso(null);
    try {
      const nuevo = await addDictionaryTerm(limpio, partirConfusiones(confusiones));
      setTermino("");
      setConfusiones("");
      // Se inserta en memoria en vez de recargar: la base ya devolvió la fila guardada,
      // y volver a leerla para traer lo que se acaba de escribir es sólo una espera más.
      setEstado((previo) =>
        previo.tipo === "listo"
          ? { tipo: "listo", terminos: ordenar([...sinEse(previo.terminos, nuevo.termino), nuevo]) }
          : previo,
      );
    } catch (error) {
      setAviso({ texto: mensajeDe(error) });
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (item: DictionaryTerm) => {
    setPorBorrar(null);
    setAviso(null);
    try {
      await removeDictionaryTerm(item.id);
      setEstado((previo) =>
        previo.tipo === "listo"
          ? { tipo: "listo", terminos: previo.terminos.filter((t) => t.id !== item.id) }
          : previo,
      );
    } catch (error) {
      setAviso({ texto: mensajeDe(error) });
    }
  };

  const demasiadoLargo = termino.trim().length > MAX_LARGO;

  return (
    <>
      <PanelHeader
        title="Diccionario"
        subtitle="Las palabras que el modelo escribe mal, escritas como van."
      />

      <div className="panel__body scroll">
        {estado.tipo === "cargando" && (
          <div className="skeleton__stack" aria-hidden="true">
            <span className="skeleton skeleton--row" />
            <span className="skeleton skeleton--row" />
            <span className="skeleton skeleton--row" />
          </div>
        )}

        {estado.tipo === "error" && (
          <>
            <p className="notice notice--error">{estado.mensaje}</p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => void cargar()}>
                Reintentar
              </button>
            </div>
          </>
        )}

        {estado.tipo === "listo" && (
          <>
            <div className="termform">
              <div className="termform__fields">
                <input
                  type="text"
                  className="input input--boxed"
                  placeholder="Cómo se escribe (Kubernetes, PostgreSQL, Mendoza)"
                  value={termino}
                  spellCheck={false}
                  maxLength={MAX_LARGO}
                  onChange={(event) => setTermino(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void agregar();
                  }}
                />
                <input
                  type="text"
                  className="input input--boxed"
                  placeholder="Cómo suele salir mal, separado por comas (opcional)"
                  value={confusiones}
                  spellCheck={false}
                  onChange={(event) => setConfusiones(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void agregar();
                  }}
                />
              </div>
              <button
                type="button"
                className="btn btn--primary"
                disabled={guardando || termino.trim() === "" || demasiadoLargo}
                onClick={() => void agregar()}
              >
                {guardando ? "Agregando…" : "Agregar"}
              </button>
            </div>

            <p className="termform__note">
              Con el término solo alcanza para que el modelo lo reconozca mejor. Las
              confusiones son para lo que nunca va a acertar: poniendo{" "}
              <strong>Postgres QL</strong> como confusión de <strong>PostgreSQL</strong>, se
              corrige en cada dictado.
            </p>

            {aviso && (
              <div className="notice notice--error">
                {aviso.texto}
              </div>
            )}

            {estado.terminos.length === 0 ? (
              <div className="empty">
                <span className="empty__soon">
                  <BookIcon />
                </span>
                <span className="empty__title">Todavía no cargaste ninguna palabra</span>
                <span className="empty__note">
                  Nombres propios, jerga de tu laburo, marcas. Cargalas una vez y dejá de
                  corregirlas en cada dictado.
                </span>
              </div>
            ) : (
              <div className="terms">
                {estado.terminos.map((item) => (
                  <div className="term" key={item.id}>
                    <div className="term__body">
                      <span className="term__word">{item.termino}</span>
                      {item.confusiones.length > 0 ? (
                        <span className="term__confusions">
                          en vez de {item.confusiones.join(", ")}
                        </span>
                      ) : (
                        <span className="term__confusions term__confusions--empty">
                          sólo para que lo reconozca mejor
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="rowbtn rowbtn--danger"
                      aria-label={`Borrar ${item.termino}`}
                      onClick={() => setPorBorrar(item)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {estado.tipo === "listo" && estado.terminos.length > 0 && (
              <p className="listfoot">
                {estado.terminos.length === 1 ? "1 palabra" : `${estado.terminos.length} palabras`}
              </p>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={porBorrar !== null}
        danger
        title="Borrar del diccionario"
        body={
          <>
            <strong>{porBorrar?.termino}</strong> deja de corregirse en los dictados que
            vengan. Los que ya están en el historial no cambian.
          </>
        }
        confirmLabel="Borrar"
        onConfirm={() => porBorrar && void borrar(porBorrar)}
        onCancel={() => setPorBorrar(null)}
      />
    </>
  );
}

/**
 * Las confusiones, tal cual se escriben en el campo.
 *
 * Se parte por coma y no por espacio porque una confusión puede tener espacios
 * adentro: "Postgres QL" es exactamente el caso para el que existe la capa 2.
 */
function partirConfusiones(crudo: string): string[] {
  return crudo
    .split(SEPARADOR)
    .map((parte) => parte.trim())
    .filter(Boolean);
}

/** Alfabético, para que el término recién agregado quede en su lugar y no al final. */
function ordenar(terminos: DictionaryTerm[]): DictionaryTerm[] {
  return [...terminos].sort((a, b) => a.termino.localeCompare(b.termino, "es"));
}

/**
 * Saca el término repetido antes de insertar el que devolvió la base.
 *
 * `addDictionaryTerm` hace `ON CONFLICT DO UPDATE`: agregar una palabra que ya estaba le pisa
 * las confusiones y devuelve **la misma fila**. Sin esto quedaría duplicada en pantalla
 * hasta la próxima recarga.
 */
function sinEse(terminos: DictionaryTerm[], termino: string): DictionaryTerm[] {
  return terminos.filter((t) => t.termino.toLowerCase() !== termino.toLowerCase());
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
