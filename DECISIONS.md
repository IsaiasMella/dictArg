# Decisiones

Por qué Dictarg está hecho así. Las decisiones tienen un motivo escrito por el autor o documentado en el código o en el historial del repo. Lo que no tiene motivo registrado está en "Detalles de implementación", donde solo se describe qué hace.

## Decisiones

### Tauri en vez de Electron
- **Decisión:** la app usa Tauri 2: la interfaz corre en el webview del sistema y el resto en Rust.
- **Motivo:** es más liviano.
- **Alternativas descartadas:** Electron.

### Transcripción por API, no con un modelo local
- **Decisión:** el audio se transcribe con la API de Deepgram (modelo `nova-3`).
- **Motivo:** la app apunta a PCs corporativas de pocos recursos (por ejemplo, un i3 de 7.ª generación con 2 a 8 GB de RAM) que no sostienen modelos locales, y así se evita hacer el trabajo dos veces.
- **Alternativas descartadas:** un modelo de transcripción local.

### Deepgram en vez de Whisper
- **Decisión:** la transcripción pasó de Whisper (vía Groq) a Deepgram `nova-3`.
- **Motivo:** «En mi uso, Whisper a veces cambiaba el sentido de las palabras y otras veces no devolvía transcripción, con lo que se perdía el dictado y había que volver a grabar. Con el modelo de Deepgram que uso, la transcripción fue más fiel.»
- **Alternativas descartadas:** Whisper vía Groq.

### Sin login ni backend: solo SQLite local
- **Decisión:** el historial y el diccionario se guardan en SQLite, en `%APPDATA%\com.isaias.voice\voice.db`. No hay cuentas ni servidor propio, y cada persona carga sus propias keys de Deepgram y Groq.
- **Motivo:** el proyecto queda simple, y cada usuario usa sus propias keys.
- **Alternativas descartadas:** un backend propio con login.

### Pedidos a las APIs desde Rust
- **Decisión:** los pedidos a Deepgram y a Groq salen desde Rust (`stt.rs`, `polish.rs`). Las keys se leen en Rust (`keys.rs`), y el webview no tiene permiso de red: la CSP solo permite `connect-src 'self' ipc: http://ipc.localhost`.
- **Motivo:** según los comentarios del código, Deepgram rechaza por CORS los pedidos REST hechos desde un navegador, y así la credencial nunca entra al proceso que dibuja la interfaz.
- **Alternativas descartadas:** no hay registradas.

### Formateo prendido por defecto, con switch en Ajustes
- **Decisión:** el formateo viene prendido (`DEFAULT_ENABLED = true` en `polish.rs`) y se apaga con el switch "Formatear el texto" de Ajustes. Se guarda en el campo `formatting` de `settings.json`.
- **Motivo:** el formateo es el corazón del producto.
- **Alternativas descartadas:** no hay registradas.

### Formatear con un modelo rápido en Groq
- **Decisión:** el formateo usa `openai/gpt-oss-20b` en Groq, con `reasoning_effort: "low"` y un tope de 20 s. Si se pasa del tope, se pega el texto sin formatear.
- **Motivo:** el formateo agrega una segunda vuelta a la red antes de pegar el texto, así que conviene el modelo más rápido y no el más grande (`docs/prompt-formateo.md`, en el historial del repo).
- **Alternativas descartadas:** no hay registradas.

### Guardas del formateo
- **Decisión:** el dictado viaja entre `<transcripcion>` y `</transcripcion>`, y el prompt aclara que ese texto es solo datos. Además, la respuesta del modelo se descarta, y se pega el texto sin formatear, en tres casos:
  - Trae una negativa ("lo siento", "no puedo ayudar"…) que no estaba en el dictado.
  - El texto se achicó a menos de la mitad.
  - Aparece una palabra que no estaba en el dictado.
- **Motivo:** según el código, y también un documento del historial:
  - **Etiquetas y prompt:** un dictado puede contener una pregunta o una orden, y sin esa aclaración el modelo contesta el dictado en vez de formatearlo.
  - **Negativas:** con `openai/gpt-oss-20b`, dos dictados volvieron convertidos en «Lo siento, pero no puedo ayudar con eso», y eso fue lo que se pegó.
  - **Largo mínimo:** un texto que se achicó a la mitad no fue formateado, fue reemplazado o resumido.
  - **Palabra nueva:** cubre las fallas silenciosas —agregar una oración, "mejorar" la redacción, cambiar una palabra por un sinónimo— que pasan cualquier control de largo.
- **Alternativas descartadas:** confiar solo en el prompt. El código dice que «un prompt igual no alcanza».

### Pegar por portapapeles y restaurarlo a 1 segundo
- **Decisión:** el texto se copia al portapapeles y se simula `Ctrl+V` (`inject.rs`). Si "No perder lo que tenías copiado" está prendido (viene así), un segundo después de pegar se devuelve lo que había antes. Solo se devuelve si el portapapeles todavía tiene el dictado.
- **Motivo:** según el código:
  - **Pegar en vez de tipear:** pegar es instantáneo y no se rompe con tildes, ñ, autocompletado ni layouts de teclado distintos.
  - **El segundo de espera:** las apps basadas en Chromium (Electron y los navegadores) leen el portapapeles un poco después de recibir el `Ctrl+V`. Con un margen corto se devolvía el contenido viejo antes de que lo leyeran, y no se pegaba nada.
- **Alternativas descartadas:** tipear el texto carácter por carácter.

### Atajo `Ctrl+Super` con un hook de teclado propio
- **Decisión:** el atajo por defecto es `Ctrl+Super`, es decir, Ctrl más la tecla Windows (`shortcut.rs`). Se detecta con un hook `WH_KEYBOARD_LL` propio (`hotkey.rs`), no con el registro de atajos del sistema.
- **Motivo:**
  - «Con el registro de atajos del sistema no se podía usar la tecla Windows y el atajo respondía de forma irregular (a veces había que apretarlo dos o tres veces). Probé antes Ctrl+Espacio y Ctrl+Alt; este último choca con otros comandos que usan esas teclas. Ctrl+Super es el mismo atajo que usa Wispr Flow.»
  - Además, el código documenta la razón técnica: `RegisterHotKey` exige una tecla final, así que una combinación de solo modificadores como `Ctrl+Win` no se puede expresar.
- **Alternativas descartadas:** el registro de atajos del sistema, `Ctrl+Espacio` y `Ctrl+Alt`.

### Solo Windows
- **Decisión:** solo se soporta y se prueba Windows. El hook de teclado del atajo existe solo para Windows; en otros sistemas no se instala. El CI corre en `windows-latest`. `tauri.conf.json` todavía tiene ajustes de macOS y Linux, pero no se prueban.
- **Motivo:** es el único sistema operativo con el que el autor cuenta para probarlo: no tiene Mac ni Linux.
- **Alternativas descartadas:** no hay registradas.

### Dashboard de costos visible para todos
- **Decisión:** el Dashboard y la tarjeta "costo de API" de Inicio se muestran a cualquier usuario. El costo es una estimación hecha con las tarifas por hora que están fijas en `pricing.ts`.
- **Motivo:** cada usuario usa su propia key, y ver su gasto le sirve.
- **Alternativas descartadas:** no hay registradas.

### Licencia PolyForm Noncommercial 1.0.0
- **Decisión:** el código está bajo PolyForm Noncommercial 1.0.0 (`LICENSE`). Es código fuente disponible, no open source.
- **Motivo:** el autor quiere que se pueda leer, descargar y usar, pero no que terceros lo comercialicen.
- **Alternativas descartadas:** MIT, Apache 2.0, GPL v3 y MPL 2.0.

### Aviso cuando falta la key de Groq
- **Decisión:** con el formateo prendido y sin key de Groq, Ajustes muestra un aviso debajo del switch. El dictado no cambia: se pega el texto sin formatear.
- **Motivo:** sin la key, el texto se pegaba sin formatear y nada lo indicaba.
- **Alternativas descartadas:** no hay registradas.

### Guardar en el Historial antes de pegar
- **Decisión:** cada dictado primero se guarda en el Historial y después se pega (`guardarYPegar` en `controller.ts`). Si el guardado falla, el pegado sigue. Si el pegado falla, el error avisa que el texto quedó en el Historial, pero solo cuando el guardado salió bien.
- **Motivo:** no perder el dictado si falla el pegado.
- **Alternativas descartadas:** pegar primero y guardar después, que era el orden anterior.

## Detalles de implementación

Qué hace el código. Estos puntos no tienen un motivo registrado.

- **Base de datos:**
  - SQLite con `tauri-plugin-sql`, con dos tablas: `transcriptions` y `dictionary_terms`.
  - Las migraciones son acumulativas y nunca se reescriben, porque el plugin guarda un checksum de cada una. Por eso siguen columnas y una tabla que hoy no se usan.
  - El historial se pagina por cursor `(created_at, id)` y se busca con `LIKE`, escapando los comodines.
  - La retención va de 7 a 365 días (90 por defecto). La poda corre al arrancar y después de cada dictado.
  - Las credenciales no se guardan en la base.
- **Orden de lectura de las keys** (`keys.rs`, `secret.rs`, `dpapi.rs`): primero variable de entorno o `.env`, después el llavero del sistema y por último `credentials.json` en `%APPDATA%\com.isaias.voice`, cifrado con DPAPI en Windows.
- **Vigilancia del webview** (`heartbeat.rs`): cada pulsación del atajo lleva un número de secuencia que el webview tiene que devolver. Si no contesta en 300 ms ni a una segunda consulta de 700 ms, aparece una notificación del sistema y las ventanas se recargan, o se recrean.
- **Filtro de silencio y tope de duración** (`controller.ts`):
  - Se descartan las grabaciones de menos de 350 ms y las que no tienen unos 280 ms con voz (7 cuadros de 40 ms por encima del umbral de volumen).
  - Se descarta la transcripción si es una de las frases típicas de relleno ("Gracias por ver el video", etc.) o si empieza con una.
  - A los 5 minutos de grabación se pregunta si seguir, con 30 s de gracia.
- **Diccionario:** hasta 100 términos van a Deepgram como `keyterm`. Después de transcribir, `transcription.ts` reemplaza en el texto las "confusiones" cargadas por el término correcto.
- **Defensas contra prompt injection en el formateo** (`polish.rs`):
  - Al dictado se le sacan las etiquetas `<transcripcion>` antes de envolverlo, para que no pueda cerrarlas antes de tiempo.
  - Además de las guardas de la sección anterior, la respuesta se rechaza si el largo supera el 160 % del original. Ese control se aplica en dictados de 40 o más letras y cifras.
  - Ante cualquier rechazo o error, se pega el texto sin formatear.

## Seguridad y dependencias

Resultados del 2026-10-22, con los lockfiles del repo.

- **`npm audit`:** 0 vulnerabilidades, con y sin dependencias de desarrollo (`npm audit --omit=dev`).
- **`cargo audit`:** reporta 7 vulnerabilidades en 4 crates.

  | Crate | Avisos | Quién lo declara en `Cargo.lock` |
  |---|---|---|
  | `rkyv` | RUSTSEC-2026-0235 | `rust_decimal`, que declaran `sqlx` y `tauri-plugin-sql` |
  | `rsa` | RUSTSEC-2023-0071 | `sqlx-mysql` |
  | `rustls` | RUSTSEC-2026-0285, -0346, -0348 y -0349 | `hyper-rustls`, que viene de `reqwest` |
  | `rustls-webpki` | RUSTSEC-2026-0382 | `rustls` |

  Ninguno de los cuatro se compila:
  - `cargo tree -i <crate> --target all` no devuelve nada para ninguno: no están en el grafo de dependencias de ninguna plataforma.
  - Aparecen en `Cargo.lock` porque son dependencias opcionales. `tauri-plugin-sql` se usa solo con la feature `sqlite`, así que no se compilan los drivers de MySQL ni de PostgreSQL.
  - `reqwest` usa su TLS por defecto, que en Windows es `native-tls` sobre `schannel`, y no `rustls`.
- **Avisos no vulnerables de `cargo audit`:** son 15, de crates sin mantenimiento y uno *unsound* (`glib`).
  - En Windows solo se compilan los `unic-*` (vía `urlpattern`, de `tauri-utils`), que no tienen vulnerabilidades conocidas.
  - El resto (`zbus`, `zvariant`, `glib`, `derivative`, `instant`, `proc-macro-error`) se compila solo en Linux.
- **Licencias:**
  - Las dependencias directas, de npm y de Cargo, son MIT, Apache-2.0 o MIT/Apache-2.0.
  - En las dependencias transitivas de Cargo hay crates con MPL-2.0 (`cssparser`, `selectors`, `dtoa-short`, `option-ext`), que es copyleft débil por archivo.
- **Credenciales:** `.env` está en `.gitignore`. El hook `.githooks/pre-commit` frena commits con credenciales: usa `gitleaks` si está instalado y, si no, una lista propia de patrones. `npm ci` lo activa con el script `prepare`.
