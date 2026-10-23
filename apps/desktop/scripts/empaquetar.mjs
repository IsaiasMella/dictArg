// Compila Voice y genera el instalador local de Windows.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dirApp = fileURLToPath(new URL("..", import.meta.url));
const { status } = spawnSync("npm run tauri build", {
  cwd: dirApp,
  shell: true,
  stdio: "inherit",
});
if (status !== 0) process.exit(status ?? 1);

const exe = join(dirApp, "src-tauri", "target", "release", process.platform === "win32" ? "voice.exe" : "voice");
if (!existsSync(exe)) {
  console.error("[voice] la compilación terminó sin generar el ejecutable");
  process.exit(1);
}
console.log(`\n[voice] ejecutable listo: ${exe}`);
if (process.platform === "win32") {
  const version = JSON.parse(readFileSync(join(dirApp, "package.json"), "utf8")).version;
  const installer = join(dirApp, "src-tauri", "target", "release", "bundle", "nsis", `Dictarg_${version}_${process.arch}-setup.exe`);
  if (!existsSync(installer)) {
    console.error("[voice] falta el instalador NSIS");
    process.exit(1);
  }
  console.log(`[voice] instalador listo: ${installer}`);
}
