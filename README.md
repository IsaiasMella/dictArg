# Dictarg

App de escritorio para Windows que dicta por voz y pega el texto en la aplicación donde tenés el cursor. Apretás `Ctrl + Windows`, hablás, volvés a apretar y el texto aparece.

## Licencia

Código fuente disponible bajo [PolyForm Noncommercial 1.0.0](LICENSE). No es open source: el uso comercial no está permitido sin autorización.

Si estás evaluando este proyecto como parte de un proceso de selección, tenés mi permiso para descargarlo, ejecutarlo y probarlo con ese fin.

## Qué hace y cómo funciona

- **Atajo global.** Por defecto es `Ctrl + Windows` (en Ajustes figura como `Ctrl+Super`). Una pulsación empieza a grabar y la siguiente termina. En Ajustes se puede cambiar el atajo o pasar a "mantener apretado para hablar".
- **Transcripción por API.** El audio se manda a Deepgram (modelo `nova-3`).
- **Formateo.** El texto pasa por un modelo de Groq (`openai/gpt-oss-20b`) que saca muletillas, corrige la puntuación y escribe números y listas. Viene prendido por defecto y se apaga con el switch "Formatear el texto" en Ajustes. Si el formateo falla, se pega el texto tal cual salió de la transcripción.
- **Pegado.** El texto se copia al portapapeles y se pega con `Ctrl+V` en la ventana donde estabas. Si tenías algo copiado, vuelve al portapapeles después de pegar. Viene prendido por defecto y se puede apagar en Ajustes.
- **Datos locales.** El historial y el diccionario se guardan en SQLite, en `%APPDATA%\com.isaias.voice\voice.db`. No hay cuentas ni servidor propio: cada persona usa sus propias keys.
- **Stack.** Tauri 2, con la interfaz en React + TypeScript y el resto en Rust: atajo, pedidos a las APIs, portapapeles y base de datos.

La app también tiene un Historial con búsqueda, un Diccionario de palabras propias y un Dashboard de uso y costo estimado.

## Requisitos

- **Windows.** Solo está probado en Windows. El atajo global usa un hook de teclado propio de Windows.
- **Node.js** `^20.19.0 || >=22.12.0`, que es lo que pide Vite 7 (está en `engines` de `package.json`).
- **Rust** estable. Con el `Cargo.lock` actual, las dependencias piden Rust 1.89 o más nuevo.
- Los requisitos de Tauri para Windows, Microsoft C++ Build Tools y WebView2: <https://v2.tauri.app/start/prerequisites/>

## Keys

| Key | Para qué | Dónde se consigue |
|---|---|---|
| `DEEPGRAM_API_KEY` | Transcripción. Obligatoria: sin esta key no se puede dictar. | <https://console.deepgram.com> |
| `GROQ_API_KEY` | Formateo del texto. Sin esta key se pega el texto sin formatear, y Ajustes muestra un aviso. | <https://console.groq.com/keys> |

El uso de cada API se cobra en tu propia cuenta.

## Cómo correrlo

```sh
npm ci
cp .env.example .env    # pegá tus keys en .env
npm run dev
```

- `npm ci` también configura el hook de pre-commit que frena commits con credenciales.
- `npm run dev` cierra cualquier instancia de la app que esté corriendo (`voice.exe`) y levanta el modo desarrollo de Tauri.
- Las keys también se pueden cargar desde Ajustes. Ahí se validan contra la API y se guardan en el llavero del sistema. Si definís una key en el `.env`, tiene prioridad sobre la guardada en Ajustes.
- En la versión instalada, la app busca el `.env` al lado del ejecutable o en `%APPDATA%\com.isaias.voice\.env`.

## Generar el instalador

```sh
npm run build
```

Genera el instalador NSIS en:

```
apps/desktop/src-tauri/target/release/bundle/nsis/Dictarg_<versión>_x64-setup.exe
```

La versión es la del campo `version` de `apps/desktop/src-tauri/tauri.conf.json`. El ejecutable suelto queda en `apps/desktop/src-tauri/target/release/voice.exe`.

## Tests y chequeos

```sh
npm run check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

`npm run check` corre el chequeo de tipos de TypeScript y los tests de Vitest. El CI (`.github/workflows/ci.yml`) corre en Windows en cada push y en cada PR. Además de estos tres chequeos, compila el frontend y corre `cargo check`.

## Estructura

```
apps/desktop/
  src/          interfaz: ventana principal y pastilla flotante (React + TypeScript)
  src-tauri/    Rust: atajo global, transcripción, formateo, portapapeles, SQLite
  scripts/      dev.mjs (modo desarrollo) y empaquetar.mjs (instalador)
.github/workflows/ci.yml
.githooks/pre-commit
.env.example
DECISIONS.md    por qué está hecho así
LICENSE
```

## Contacto

- LinkedIn: <https://www.linkedin.com/in/isaias-mella/>
- Issues: <https://github.com/IsaiasMella/dictArg/issues>

## Licencia

[PolyForm Noncommercial 1.0.0](LICENSE).
