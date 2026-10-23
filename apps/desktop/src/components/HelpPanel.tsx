/**
 * Acá vive la instrucción que antes ocupaba el subtítulo de Inicio: se lee una
 * vez y después estorba, así que su lugar es este y no la pantalla de arranque.
 */
import { useState } from "react";

import { openContact, type ContactLink } from "../lib/bridge";
import PanelHeader from "./PanelHeader";

export default function HelpPanel({ shortcut }: { shortcut: string }) {
  const [aviso, setAviso] = useState<string | null>(null);

  const abrir = async (link: ContactLink) => {
    setAviso(null);
    try {
      await openContact(link);
    } catch (error) {
      setAviso(typeof error === "string" ? error : String(error));
    }
  };

  const key = shortcut || "Ctrl+Super";

  const steps = [
    <>
      Poné el cursor donde quieras escribir: un chat, un correo, el navegador, lo que sea.
    </>,
    <>
      Apretá <span className="kbd">{key}</span> y hablá. Abajo de la pantalla vas a ver una
      barrita que se pone roja mientras te escucha.
    </>,
    <>
      Volvé a apretar <span className="kbd">{key}</span>. El texto aparece solo donde tenías el
      cursor.
    </>,
  ];

  return (
    <>
      <PanelHeader title="Ayuda" subtitle="Cómo se usa y cómo contactarnos." />
      <div className="panel__body scroll">
      <h2 className="sectionhead__title sectionhead__title--help">
        Cómo se usa
      </h2>

      <ol className="help__list">
        {steps.map((step, index) => (
          <li key={index} className="help__step">
            <span className="help__num">{index + 1}</span>
            <span className="help__text">{step}</span>
          </li>
        ))}
      </ol>

      <div className="sectionhead">
        <h2 className="sectionhead__title">Si algo no anda</h2>
      </div>

      <div className="settings">
        <Row
          label="El texto no se pega"
          note="El dictado se copia al portapapeles y se pega con Ctrl+V en la ventana donde estabas. Si otra aplicación tenía tomado el portapapeles, la barrita lo avisa: volvé a intentar."
        />
        <Row
          label="No toma el micrófono"
          note="Entrá a Ajustes y apretá «Conectar micrófono» con esta ventana a la vista, para poder ver el permiso que pide Windows."
        />
        <Row
          label="El atajo no responde"
          note="Puede estar tomado por otro programa. Cambialo desde Ajustes y probá otra combinación."
        />
      </div>

      <div className="sectionhead">
        <h2 className="sectionhead__title">Contacto</h2>
      </div>
      <p className="muted">
        Contanos qué te pasó. Sirve más un «esto me resultó incómodo» que un reporte perfecto.
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={() => void abrir("issues")}>
          Reportar un problema en GitHub
        </button>
        <button type="button" className="btn" onClick={() => void abrir("linkedin")}>
          LinkedIn
        </button>
      </div>
      {aviso && <p className="setting__note setting__note--warn">{aviso}</p>}
      </div>
    </>
  );
}

function Row({ label, note }: { label: string; note: string }) {
  return (
    <div className="setting setting--stacked">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        <span className="setting__note">{note}</span>
      </div>
    </div>
  );
}
