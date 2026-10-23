# Dictarg

App de escritorio para Windows que dicta por voz y pega el texto donde está el cursor. Tauri 2: interfaz en React + TypeScript y el resto en Rust. La transcripción usa Deepgram (`nova-3`) y el formateo opcional usa Groq (`openai/gpt-oss-20b`); los dos pedidos salen desde Rust con las keys de cada usuario. Historial y diccionario se guardan en SQLite local. El porqué de cada decisión está en `DECISIONS.md`.

## Estructura

- `apps/desktop/src/`: interfaz. `main.tsx` y `App.tsx` son la ventana principal, `pill.tsx` la pastilla flotante. La máquina de estados del dictado está en `state/controller.ts`; el acceso a SQLite, en `lib/db.ts`.
- `apps/desktop/src-tauri/src/`: Rust. Atajo global (`hotkey.rs`, `shortcut.rs`), transcripción (`stt.rs`), formateo (`polish.rs`), comandos del dictado (`dictation.rs`), pegado (`inject.rs`, `focus.rs`), migraciones (`db.rs`), keys (`keys.rs`, `secret.rs`).
- `apps/desktop/scripts/`: `dev.mjs` (modo desarrollo) y `empaquetar.mjs` (instalador).
- `.githooks/pre-commit`: frena commits con credenciales.
- `.github/workflows/ci.yml`: CI en Windows en cada push y PR.

## Comandos

Desde la raíz:

- `npm ci`: instala dependencias y configura el hook de pre-commit.
- `npm run dev`: cierra la app si está corriendo y levanta `tauri dev`.
- `npm run build`: compila y genera el instalador NSIS.
- `npm run check`: tipos de TypeScript y tests de Vitest.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

## Convenciones

- No subir credenciales. Las keys van en `.env` (a partir de `.env.example`) o se cargan desde Ajustes, que las guarda en el llavero del sistema.
- Las migraciones SQLite son acumulativas: no editar las existentes, agregar una versión nueva. El plugin guarda un checksum de cada una y una base con una migración modificada deja de abrir.
- No cambiar el `identifier` de `tauri.conf.json`, el servicio del llavero (`secret.rs`) ni `DB_URL` (`db.rs`): una instalación existente perdería sus datos o sus keys.
- Los pedidos de red salen desde Rust. La CSP no le deja red al webview.
- Tests de TypeScript en `*.test.ts` al lado del código; los de Rust, en módulos `#[cfg(test)]`.
- Finales de línea LF (`.gitattributes`).
- Solo está probado en Windows: el atajo global usa un hook de teclado propio de Windows.
