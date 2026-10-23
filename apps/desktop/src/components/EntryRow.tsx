import { useEffect, useRef, useState } from "react";

import { copyText } from "../lib/bridge";
import { clockDuration, timeOfDay } from "../lib/format";
import { CheckIcon, CopyIcon, TrashIcon } from "./icons";
import type { Transcription } from "../lib/db";

/**
 * Una fila del historial, compartida por Inicio y por Historial.
 *
 * Las acciones aparecen recién al pasar por encima: estando siempre visibles
 * competían con el texto, que es lo único que el usuario vino a leer. Se revelan
 * también con el foco del teclado, así que no quedan fuera de alcance.
 */
export default function EntryRow({
  entry,
  onDelete,
}: {
  entry: Transcription;
  onDelete?: (entry: Transcription) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    await copyText(entry.text);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="entry">
      <span className="entry__time">{timeOfDay(entry.createdAt)}</span>

      <div className="entry__body">
        <span className="entry__text">{entry.text}</span>
        <span className="entry__stamp">
          {clockDuration(entry.durationSeconds)} · {shortModel(entry.model)}
        </span>
      </div>

      <div className="entry__actions">
        <button
          type="button"
          className="rowbtn rowbtn--copy"
          aria-label={copied ? "Copiado" : "Copiar el texto"}
          title={copied ? "Copiado" : "Copiar"}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        {onDelete && (
          <button
            type="button"
            className="rowbtn rowbtn--danger"
            aria-label="Borrar este dictado"
            title="Borrar"
            onClick={() => onDelete(entry)}
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}

/** «whisper-large-v3-turbo» no entra en una fila; el sufijo alcanza. */
function shortModel(model: string): string {
  return model.replace("whisper-large-v3", "large-v3").replace("large-v3-turbo", "turbo");
}
