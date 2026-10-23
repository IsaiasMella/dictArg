//! Red de contención por si el webview oculto deja de responder.
//!
//! La máquina de estados del dictado —el micrófono, `MediaRecorder`, la decisión de
//! transcribir— vive en el webview de la ventana `main`, que durante el uso normal
//! está escondida en la bandeja. El corazón del producto depende de que un webview
//! invisible siga vivo, despierto y sin throttling, indefinidamente.
//!
//! Si WebView2 se cae, se suspende bajo presión de memoria, o el `AudioContext` queda
//! suspendido después de un *sleep*, pasa lo peor que puede pasar acá: **el hook de
//! teclado sigue funcionando y sigue tragándose la tecla**, el evento se emite al
//! vacío, y el usuario aprieta el atajo, habla, y se entera de que no grabó nada
//! cuando termina. Pierde lo que dijo y no hay ninguna señal.
//!
//! Esto lo convierte en una señal: cada toggle lleva un número de secuencia y el
//! webview tiene que devolverlo enseguida. Si no vuelve, se avisa y se recarga.
//!
//! La solución de fondo es mover la máquina de estados a Rust, diferida a
//! propósito: esto cubre el 90 % del riesgo por 1/30 del esfuerzo.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// Evento que la ventana principal escucha para alternar grabación.
pub const TOGGLE_EVENT: &str = "dictation-toggle";

/// Sonda que se manda sólo cuando un toggle no volvió, para confirmar antes de actuar.
pub const PING_EVENT: &str = "dictation-ping";

/// Cuánto se espera el ACK del toggle.
///
/// El webview contesta apenas recibe el evento, antes de tocar el micrófono: lo que
/// se mide es si está vivo, no si terminó el trabajo. 300 ms es holgadísimo para eso.
const ACK_TIMEOUT: Duration = Duration::from_millis(300);

/// Cuánto se espera la segunda sonda antes de dar al webview por caído.
///
/// **Existe para no recuperar de más.** Un pico de carga puede hacer que un webview
/// perfectamente vivo se pase de los 300 ms, y recargar la ventana en ese momento
/// mataría una grabación en curso: el remedio sería peor que la enfermedad. Recién
/// después de dos silencios seguidos, casi un segundo en total, se da por caído.
const PING_TIMEOUT: Duration = Duration::from_millis(700);

static NEXT_SEQ: AtomicU64 = AtomicU64::new(0);
static LAST_ACK: AtomicU64 = AtomicU64::new(0);

/// Si el webview contestó alguna vez.
///
/// Hasta que conteste una primera vez no se recupera nada: durante el arranque el
/// silencio es normal —la ventana todavía no montó React— y recargarla ahí sería
/// pelearse con el propio arranque en un bucle.
static EVER_ACKED: AtomicBool = AtomicBool::new(false);

/// Una recuperación por vez.
static RECOVERING: AtomicBool = AtomicBool::new(false);

/// Cuántas veces se disparó la recuperación en esta sesión.
///
/// Es el número que dice si hace falta mover la máquina de estados a Rust: si la
/// recuperación se dispara más de una vez por semana, esto ya no alcanza. Hoy sale
/// por `stderr` en cada recuperación.
///
/// No se expone como comando a propósito: no habría quién lo llamara, y un `invoke`
/// sin consumidor es superficie expuesta que no sirve para nada.
static RECOVERIES: AtomicU64 = AtomicU64::new(0);

/// Carga del evento de toggle.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toggle {
    /// `"toggle"`, `"start"` o `"stop"`.
    pub action: &'static str,
    /// Número de secuencia que el webview tiene que devolver.
    pub seq: u64,
}

/// Emite un toggle y arma el control de que haya llegado.
pub fn emit_toggle(app: &AppHandle, action: &'static str) {
    let seq = NEXT_SEQ.fetch_add(1, Ordering::SeqCst) + 1;

    if app.emit(TOGGLE_EVENT, Toggle { action, seq }).is_err() {
        return;
    }

    // Un hilo por pulsación. Son eventos que dispara una persona con los dedos, no
    // un bucle: la cuenta de hilos no es un problema y evita tener que mantener un
    // runtime propio para algo que duerme un segundo y termina.
    let app = app.clone();
    std::thread::spawn(move || watch(app, seq));
}

fn acked(seq: u64) -> bool {
    LAST_ACK.load(Ordering::SeqCst) >= seq
}

fn watch(app: AppHandle, seq: u64) {
    std::thread::sleep(ACK_TIMEOUT);
    if acked(seq) {
        return;
    }

    // Todavía no se da por caído: segunda sonda. Ver `PING_TIMEOUT`.
    if app.emit(PING_EVENT, seq).is_err() {
        return;
    }
    std::thread::sleep(PING_TIMEOUT);
    if acked(seq) {
        return;
    }

    if !EVER_ACKED.load(Ordering::SeqCst) {
        // Nunca contestó: es el arranque, no una caída.
        return;
    }

    recover(&app);
}

fn recover(app: &AppHandle) {
    // `swap` y no `load` + `store`: dos toggles seguidos sobre un webview caído
    // dispararían dos recuperaciones pisándose.
    if RECOVERING.swap(true, Ordering::SeqCst) {
        return;
    }

    let veces = RECOVERIES.fetch_add(1, Ordering::SeqCst) + 1;
    eprintln!("[voice] el webview no respondió al atajo; recargando (van {veces} en esta sesión)");

    // La notificación va por el sistema operativo y no por la pastilla a propósito:
    // si lo que se cayó es el proceso de WebView2, la pastilla también está muerta y
    // no puede mostrar nada.
    let _ = app
        .notification()
        .builder()
        .title("Dictarg no responde")
        .body("Se reinició la ventana. Volvé a apretar el atajo para dictar.")
        .show();

    // El dictado que la persona quiso empezar se perdió, y no hay forma de
    // recuperarlo: el audio nunca se llegó a capturar. Lo único honesto es que lo
    // sepa y vuelva a apretar.
    for etiqueta in ["main", "pill"] {
        restore(app, etiqueta);
    }

    // Una pastilla recreada nace centrada por Tauri y capturando el mouse: pierde la
    // posición de abajo de la pantalla y el `set_ignore_cursor_events`, sin el cual
    // taparía a la aplicación sobre la que se está dictando. `place_pill` pone las
    // dos cosas, y es la misma llamada del arranque.
    crate::place_pill(app);

    RECOVERING.store(false, Ordering::SeqCst);
}

/// Levanta una ventana de nuevo: primero recargarla, y si no, reconstruirla.
///
/// Los dos caminos hacen falta y cubren fallas distintas. `reload()` alcanza cuando
/// el webview está vivo pero colgado —el `AudioContext` suspendido después de un
/// *sleep*, JavaScript trabado— y es barato. Pero cuando el proceso de WebView2 murió
/// de verdad, verificado matándolo a mano, la ventana queda como un handle sin nada
/// atrás y `reload()` no tiene sobre qué actuar. Ahí hay que reconstruirla desde la
/// configuración, que es la misma que usó Tauri al arrancar: así la ventana nueva
/// nace con las mismas propiedades y no hay una segunda definición que mantener.
fn restore(app: &AppHandle, etiqueta: &str) {
    let existente = app.get_webview_window(etiqueta);

    if let Some(ventana) = &existente {
        if ventana.reload().is_ok() {
            return;
        }
    }

    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == etiqueta)
        .cloned()
    else {
        eprintln!("[voice] no hay configuración para la ventana {etiqueta}: no se puede recrear");
        return;
    };

    // Se destruye antes de recrear: dos ventanas con la misma etiqueta no pueden
    // convivir, y `build()` fallaría con la vieja todavía registrada.
    if let Some(ventana) = existente {
        let _ = ventana.destroy();
    }

    match tauri::WebviewWindowBuilder::from_config(app, &config) {
        Ok(builder) => {
            if let Err(e) = builder.build() {
                eprintln!("[voice] no se pudo recrear la ventana {etiqueta}: {e}");
            }
        }
        Err(e) => eprintln!("[voice] no se pudo preparar la ventana {etiqueta}: {e}"),
    }
}

/// El webview avisa que sigue vivo. Lo llama apenas recibe el toggle o el ping.
#[tauri::command]
pub fn dictation_ack(seq: u64) {
    LAST_ACK.fetch_max(seq, Ordering::SeqCst);
    EVER_ACKED.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El orden importa: `fetch_max` y no `store`, porque los ACK pueden llegar
    /// desordenados y un ACK viejo no puede pisar a uno nuevo.
    #[test]
    fn un_ack_viejo_no_pisa_a_uno_nuevo() {
        LAST_ACK.store(0, Ordering::SeqCst);

        dictation_ack(5);
        assert!(acked(5));

        dictation_ack(3);
        assert!(acked(5), "un ACK con secuencia menor no puede retroceder el estado");
    }

    #[test]
    fn una_secuencia_sin_ack_no_se_da_por_contestada() {
        LAST_ACK.store(0, Ordering::SeqCst);

        dictation_ack(2);
        assert!(acked(1), "las secuencias anteriores quedan cubiertas");
        assert!(acked(2));
        assert!(!acked(3));
    }
}
