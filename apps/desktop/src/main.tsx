import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { reportCspViolations } from "./lib/csp";
import { DictationController } from "./state/controller";
import "./styles/main.css";

// Primero de todo, para no perderse un bloqueo del arranque.
reportCspViolations();

// Una sola instancia por ventana: es la dueña del micrófono y del flujo.
const controller = new DictationController();
void controller.init();

const container = document.getElementById("root");
if (!container) throw new Error("Falta #root en index.html");

createRoot(container).render(
  <React.StrictMode>
    <App controller={controller} />
  </React.StrictMode>,
);
