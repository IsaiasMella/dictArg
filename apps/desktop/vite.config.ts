import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri espera un puerto fijo y falla si no está disponible.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Los tests corren con la misma resolución de módulos que la app, que es la razón
  // de elegir Vitest sobre Jest: no hay una segunda configuración que mantener
  // sincronizada con ésta.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  build: {
    // Dos entradas: la ventana principal (config) y la pastilla flotante.
    rollupOptions: {
      input: {
        main: "index.html",
        pill: "pill.html",
      },
    },
  },
});
