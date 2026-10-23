//! Inyección del texto transcripto en la app que tenía el foco.
//!
//! Estrategia: portapapeles + `Ctrl+V` simulado, en vez de tipear carácter por
//! carácter. Pegar es instantáneo y no se rompe con tildes, ñ, autocompletado ni
//! layouts de teclado distintos.

use std::thread;
use std::time::Duration;

use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};

/// Margen para que la app destino vea el portapapeles ya actualizado.
const BEFORE_PASTE: Duration = Duration::from_millis(120);

/// Margen antes de devolver el portapapeles anterior.
///
/// Las apps basadas en Chromium —Electron y los navegadores— no leen el
/// portapapeles en el momento de recibir el Ctrl+V: mandan el evento al proceso
/// de render y lo resuelven después. Con un margen corto le devolvíamos el
/// contenido viejo antes de que alcanzaran a leer el nuestro, y no se pegaba
/// nada. Un segundo cubre a las lentas sin que se note.
const AFTER_PASTE: Duration = Duration::from_millis(1000);

/// Lo que había en el portapapeles antes de que lo usáramos para pegar.
enum Snapshot {
    Text(String),
    Image(arboard::ImageData<'static>),
    /// Estaba vacío, o tenía algo que no sabemos reproducir: archivos copiados
    /// del explorador, formatos propios de otra aplicación. En ese caso no se
    /// toca nada y queda el dictado, que es menos malo que dejarlo vacío.
    Untouchable,
}

/// Se queda con lo que haya, para poder devolverlo después.
///
/// Texto primero porque es el caso real —un link, una ruta, algo que se copió
/// para pegar en otro lado—, e imagen después porque una captura recién sacada
/// es igual de fácil de perder y bastante más cara de rehacer.
fn snapshot() -> Snapshot {
    let Ok(mut clipboard) = Clipboard::new() else {
        return Snapshot::Untouchable;
    };

    if let Ok(text) = clipboard.get_text() {
        return Snapshot::Text(text);
    }
    if let Ok(image) = clipboard.get_image() {
        return Snapshot::Image(image);
    }
    Snapshot::Untouchable
}

/// Devuelve el portapapeles a como estaba, si sigue teniendo sentido hacerlo.
///
/// La condición importa: si mientras esperábamos el usuario copió otra cosa, esa
/// es la que quiere. Devolver lo viejo encima le borraría lo que acaba de
/// copiar, que es exactamente el problema que esta función viene a resolver.
fn restore_previous(previous: Snapshot, ours: &str) {
    thread::sleep(AFTER_PASTE);

    let Ok(mut clipboard) = Clipboard::new() else {
        return;
    };

    match clipboard.get_text() {
        Ok(current) if current == ours => {}
        _ => return,
    }

    match previous {
        Snapshot::Text(text) => {
            let _ = clipboard.set_text(text);
        }
        Snapshot::Image(image) => {
            let _ = clipboard.set_image(image);
        }
        Snapshot::Untouchable => {}
    }
}

/// Intentos para dejar el texto en el portapapeles.
///
/// En Windows el portapapeles es un recurso global que se abre en exclusiva:
/// cualquier otra aplicación puede tenerlo tomado justo en ese instante y la
/// escritura no queda, incluso devolviendo Ok.
const CLIPBOARD_ATTEMPTS: u32 = 6;

#[tauri::command]
pub async fn inject_text(text: String, restore_clipboard: bool) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || paste(&text, restore_clipboard))
        .await
        .map_err(|e| format!("fallo interno al inyectar el texto: {e}"))?
}

fn paste(text: &str, restore_clipboard: bool) -> Result<(), String> {
    let previous = restore_clipboard.then(snapshot);

    // El `Clipboard` se mantiene vivo hasta después de pegar: en X11 el proceso
    // que copia tiene que seguir sirviendo la selección hasta que la app destino
    // la lea.
    let _clipboard = put_on_clipboard(text)?;

    // Devolver el foco es lo que garantiza que el texto caiga donde el usuario
    // hizo clic, sin importar qué se lo haya llevado mientras tanto.
    crate::focus::restore();
    thread::sleep(BEFORE_PASTE);
    send_paste()?;

    // La restauración va en un hilo aparte: el comando vuelve enseguida y la
    // pastilla puede pasar a "listo" sin esperar el segundo de margen.
    if let Some(previous) = previous {
        let ours = text.to_string();
        thread::spawn(move || restore_previous(previous, &ours));
    }

    Ok(())
}

/// Deja el texto en el portapapeles y **verifica releyéndolo**.
///
/// `set_text` puede devolver Ok sin que el contenido haya quedado: si otra
/// aplicación tiene el portapapeles abierto, la escritura se pierde. Sin releer,
/// mandaríamos el Ctrl+V a ciegas y el usuario no vería ni el texto ni un error
/// —solo que "no funciona"—. Reintenta con espera creciente y, si no lo logra,
/// falla con un mensaje que la pastilla puede mostrar.
fn put_on_clipboard(text: &str) -> Result<Clipboard, String> {
    let mut last_error = String::from("motivo desconocido");

    for attempt in 0..CLIPBOARD_ATTEMPTS {
        if attempt > 0 {
            thread::sleep(Duration::from_millis(40 * u64::from(attempt)));
        }

        let mut clipboard = match Clipboard::new() {
            Ok(clipboard) => clipboard,
            Err(e) => {
                last_error = format!("no se pudo abrir el portapapeles: {e}");
                continue;
            }
        };

        if let Err(e) = clipboard.set_text(text.to_string()) {
            last_error = format!("no se pudo escribir en el portapapeles: {e}");
            continue;
        }

        match clipboard.get_text() {
            Ok(actual) if actual == text => return Ok(clipboard),
            Ok(_) => last_error = "otra aplicación pisó el portapapeles".to_string(),
            Err(e) => last_error = format!("no se pudo releer el portapapeles: {e}"),
        }
    }

    Err(format!(
        "No se pudo dejar el texto en el portapapeles ({last_error}). \
         Suele ser otra aplicación reteniéndolo; probá de nuevo."
    ))
}

fn send_paste() -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default())
        .map_err(|e| format!("no se pudo tomar el control del teclado: {e}"))?;

    // El usuario venía de apretar el atajo global; si todavía tiene algún
    // modificador hundido, el Ctrl+V sintético se convertiría en otra cosa.
    for stray in stray_modifiers() {
        let _ = enigo.key(stray, Direction::Release);
    }

    let modifier = paste_modifier();
    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| format!("no se pudo simular el pegado: {e}"))?;
    let pressed = enigo.key(Key::Unicode('v'), Direction::Click);
    let _ = enigo.key(modifier, Direction::Release);

    pressed.map_err(|e| format!("no se pudo simular el pegado: {e}"))
}

#[cfg(target_os = "macos")]
fn paste_modifier() -> Key {
    Key::Meta
}

#[cfg(not(target_os = "macos"))]
fn paste_modifier() -> Key {
    Key::Control
}

#[cfg(target_os = "macos")]
fn stray_modifiers() -> [Key; 3] {
    [Key::Alt, Key::Shift, Key::Control]
}

#[cfg(not(target_os = "macos"))]
fn stray_modifiers() -> [Key; 3] {
    [Key::Alt, Key::Shift, Key::Meta]
}

/// Copia sin pegar, para el botón del historial.
///
/// Va por Rust y no por `navigator.clipboard` para no depender de que el webview
/// considere seguro su propio origen ni de la política de permisos del motor:
/// arboard ya está acá para la inyección y funciona igual en los tres sistemas.
#[tauri::command]
pub async fn copy_text(text: String) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || put_on_clipboard(&text).map(|_| ()))
    .await
    .map_err(|e| format!("fallo interno al copiar: {e}"))?
}


/// Le da a la aplicación de adelante una tecla intermedia mientras Alt sigue
/// apretado.
///
/// Hace falta solo cuando el atajo lleva Alt sin Ctrl: el hook se traga la tecla
/// final, pero el Alt sí llega, y la aplicación lo lee como "Alt suelto" —el
/// gesto que abre la barra de menú y se lleva el foco—. Con Ctrl en la
/// combinación esto no pasa, y por eso no se dispara.
///
/// `VK_NONAME` (0xFC) es una tecla que Windows reserva y ninguna aplicación
/// interpreta. Al ser un evento inyectado, nuestro propio hook lo ignora.
#[cfg(target_os = "windows")]
pub fn neutralize_alt_menu() {
    const VK_NONAME: u32 = 0xFC;

    std::thread::spawn(|| {
        if let Ok(mut enigo) = Enigo::new(&EnigoSettings::default()) {
            let _ = enigo.key(Key::Other(VK_NONAME), Direction::Click);
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn neutralize_alt_menu() {}
