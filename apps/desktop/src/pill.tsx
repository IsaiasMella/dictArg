import React, { useCallback } from "react";
import { createRoot } from "react-dom/client";
import { emit, listen } from "@tauri-apps/api/event";

import Pill from "./components/Pill";
import { reportCspViolations } from "./lib/csp";
import { EVENTS } from "./lib/events";
import { useRemoteDictation } from "./state/useDictation";
import type { DictationSnapshot } from "./state/types";
import "./styles/pill.css";

// Primero de todo, para no perderse un bloqueo del arranque.
reportCspViolations();

function PillWindow() {
  // La pastilla no decide nada: solo refleja el snapshot que manda la ventana
  // principal. Al montar avisa que está lista, por si cargó después.
  const subscribe = useCallback(
    (listener: (snapshot: DictationSnapshot) => void) => {
      const pending = listen<DictationSnapshot>(EVENTS.state, (event) =>
        listener(event.payload),
      );
      void emit(EVENTS.pillReady, {});
      return () => {
        void pending.then((off) => off());
      };
    },
    [],
  );

  return <Pill snapshot={useRemoteDictation(subscribe)} />;
}

const container = document.getElementById("pill-root");
if (!container) throw new Error("Falta #pill-root en pill.html");

createRoot(container).render(
  <React.StrictMode>
    <PillWindow />
  </React.StrictMode>,
);
