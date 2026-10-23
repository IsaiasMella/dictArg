import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import DashboardPanel from "./components/DashboardPanel";
import DictionaryPanel from "./components/DictionaryPanel";
import HelpPanel from "./components/HelpPanel";
import HistoryPanel from "./components/HistoryPanel";
import HomePanel from "./components/HomePanel";
import Modal from "./components/Modal";
import Settings from "./components/Settings";
import {
  AccountIcon,
  BookIcon,
  ChartIcon,
  CloseIcon,
  GearIcon,
  HelpIcon,
  HistoryIcon,
  HomeIcon,
  MaximizeIcon,
  MinimizeIcon,
  PanelIcon,
} from "./components/icons";
import { hideSettingsWindow } from "./lib/bridge";
import { useDictation } from "./state/useDictation";
import type { DictationController } from "./state/controller";
import type { DictationSnapshot } from "./state/types";

/**
 * Las pantallas que ocupan el panel: se navega a ellas y se quedan.
 *
 * Son las que se usan mientras se trabaja —mirar el historial, cargar una palabra— y
 * las que tienen sentido como destino. Ver `Overlay` para las otras.
 */
export type Section = "inicio" | "historial" | "diccionario" | "dashboard";

/**
 * Las que se abren encima y se cierran: Ajustes y Ayuda.
 *
 * No son destinos, son idas y vueltas: se entra a cambiar o a mirar una cosa y se
 * vuelve a lo que se estaba haciendo. Como sección obligaban a acordarse
 * de dónde venías para volver, y dejaban la aplicación mostrando una pantalla de
 * configuración como si fuera un lugar donde se está.
 *
 * El Dashboard **no** está acá a propósito: ahí sí se está un rato, leyendo.
 */
export type Overlay = "ajustes" | "ayuda";

const NAV: { id: Section; label: string; icon: () => React.ReactElement }[] = [
  { id: "inicio", label: "Inicio", icon: HomeIcon },
  { id: "historial", label: "Historial", icon: HistoryIcon },
  { id: "diccionario", label: "Diccionario", icon: BookIcon },
];

export default function App({ controller }: { controller: DictationController }) {
  const snapshot = useDictation(controller);
  const [section, setSection] = useState<Section>("inicio");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // `null` = no hay nada abierto encima. Uno solo a la vez: son todos idas y
  // vueltas, y dos superpuestos dejarían a la persona sin saber qué cierra Escape.
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  const cerrar = () => setOverlay(null);

  const renderNav = (items: typeof NAV) =>
    items.map(({ id, label, icon: Glyph }) => (
      <button
        key={id}
        type="button"
        className={`nav__item ${section === id ? "is-active" : ""}`}
        aria-current={section === id ? "page" : undefined}
        onClick={() => setSection(id)}
      >
        <span className="nav__icon">
          <Glyph />
        </span>
        {label}
      </button>
    ));

  return (
    <div className="app">
      {/* Cruza toda la ventana por encima del sidebar. Arrastra la ventana; los
          botones no llevan el atributo, así siguen siendo clicables. */}
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar__group">
          <button
            type="button"
            className="iconbtn"
            aria-label={sidebarOpen ? "Ocultar la barra lateral" : "Mostrar la barra lateral"}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <PanelIcon />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label="Ajustes"
            onClick={() => setOverlay("ajustes")}
          >
            <AccountIcon />
          </button>
        </div>

        <div className="titlebar__group">
          <button
            type="button"
            className="iconbtn"
            aria-label="Ayuda"
            onClick={() => setOverlay("ayuda")}
          >
            <HelpIcon />
          </button>
          <span className="titlebar__spacer" />
          <button
            type="button"
            className="iconbtn"
            aria-label="Minimizar"
            onClick={() => void getCurrentWindow().minimize()}
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label="Maximizar"
            onClick={() => void getCurrentWindow().toggleMaximize()}
          >
            <MaximizeIcon />
          </button>
          <button
            type="button"
            className="iconbtn iconbtn--close"
            aria-label="Cerrar a la bandeja"
            title="Dictarg sigue funcionando en la bandeja"
            onClick={() => void hideSettingsWindow()}
          >
            <CloseIcon />
          </button>
        </div>
      </div>


      <div className="app__body">
        <aside className={`sidebar ${sidebarOpen ? "" : "sidebar--hidden"}`}>
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="brand__name">Dictarg</span>
          </div>

          <nav className="nav">{renderNav(NAV)}</nav>

          <div className="sidebar__grow" />

          <MicState snapshot={snapshot} />

          <nav className="nav">
            {/* El Dashboard sí es una sección: ahí se está un rato, leyendo. Ajustes
                y Ayuda se abren encima y se cierran. */}
            <button
              type="button"
              className={`nav__item ${section === "dashboard" ? "is-active" : ""}`}
              aria-current={section === "dashboard" ? "page" : undefined}
              onClick={() => setSection("dashboard")}
            >
              <span className="nav__icon">
                <ChartIcon />
              </span>
              Dashboard
            </button>
            <button
              type="button"
              className={`nav__item ${overlay === "ajustes" ? "is-active" : ""}`}
              onClick={() => setOverlay("ajustes")}
            >
              <span className="nav__icon">
                <GearIcon />
              </span>
              Ajustes
            </button>
            <button
              type="button"
              className={`nav__item ${overlay === "ayuda" ? "is-active" : ""}`}
              onClick={() => setOverlay("ayuda")}
            >
              <span className="nav__icon">
                <HelpIcon />
              </span>
              Ayuda
            </button>
          </nav>
        </aside>

        <main className="panel">
          {section === "inicio" && <HomePanel onOpen={setSection} />}
          {section === "historial" && <HistoryPanel />}
          {section === "diccionario" && (
            <DictionaryPanel />
          )}
          {section === "dashboard" && <DashboardPanel />}
        </main>
      </div>

      <Modal open={overlay === "ajustes"} onClose={cerrar} label="Ajustes">
        <Settings controller={controller} />
      </Modal>

      <Modal open={overlay === "ayuda"} onClose={cerrar} label="Ayuda">
        <HelpPanel shortcut={snapshot.shortcut} />
      </Modal>
    </div>
  );
}

/**
 * Estado del dictado, anclado abajo del sidebar.
 *
 * Reemplaza al banner que antes ocupaba el ancho del panel: el estado importa
 * de reojo, no como titular, y acá está visible en todas las secciones.
 */
function MicState({ snapshot }: { snapshot: DictationSnapshot }) {
  const copy: Record<DictationSnapshot["status"], { kind: string; text: string }> = {
    idle: { kind: "ready", text: "Micrófono listo" },
    recording: { kind: "recording", text: "Grabando…" },
    processing: { kind: "busy", text: "Transcribiendo…" },
    success: { kind: "ready", text: "Texto insertado" },
    error: { kind: "error", text: snapshot.message ?? "Algo falló" },
  };

  const state = copy[snapshot.status];

  return (
    <div className={`micstate micstate--${state.kind}`} title={snapshot.message ?? undefined}>
      <span className="micstate__dot" aria-hidden="true" />
      <span className="micstate__text">
        {state.text}
      </span>
    </div>
  );
}
