// Arranca el modo desarrollo, bajando primero cualquier Dictarg que esté corriendo.
//
// Sin esto, `tauri dev` con la app instalada abierta parece no hacer nada: el
// plugin de instancia única detecta el arranque duplicado, le pasa el foco a la
// que ya estaba y termina la nueva. Uno queda mirando la ventana vieja pensando
// que los cambios no se aplicaron.

import { spawn, spawnSync } from "node:child_process";

const KILL = {
  win32: ["taskkill", ["/IM", "voice.exe", "/F"]],
  darwin: ["pkill", ["-x", "voice"]],
  linux: ["pkill", ["-x", "voice"]],
};

const [command, args] = KILL[process.platform] ?? [];

if (command) {
  const killed = spawnSync(command, args, { stdio: "ignore" });
  // Código 128 en Windows y 1 en pkill significan "no había ninguno": no es error.
  if (killed.status === 0) {
    console.log("[dictarg] cerré la instancia que estaba corriendo");
  }
}

const dev = spawn(
  "npm",
  ["run", "tauri", "dev"],
  {
    stdio: "inherit",
    shell: true,
  },
);

dev.on("exit", (code) => process.exit(code ?? 0));
