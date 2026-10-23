//! Atajo global: qué combinación está activa y cómo se cambia.
//!
//! La detección real la hace `hotkey.rs` con un hook de teclado de bajo nivel.
//! Este módulo solo decide qué combinación se le pide, guarda cuál quedó activa
//! y expone eso a la interfaz.
//!
//! El default es `Ctrl+Super` —Ctrl y la tecla Windows juntas—: dos teclas, sin
//! tecla final que escribir, y ninguna de las dos tiene acción propia en esa
//! combinación. Es la misma que usa Wispr Flow, por las mismas razones.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

pub const DEFAULT_SHORTCUT: &str = "Ctrl+Super";
pub const FALLBACK_SHORTCUT: &str = "Ctrl+Alt+Space";

#[derive(Default)]
pub struct ActiveShortcut {
    pub accelerator: Mutex<String>,
}

/// Atajo actualmente activo.
pub fn current(app: &AppHandle) -> String {
    app.state::<ActiveShortcut>()
        .accelerator
        .lock()
        .map(|slot| slot.clone())
        .unwrap_or_default()
}

/// Activa `desired`; si no sirve prueba el default y después el de reserva.
/// Devuelve el acelerador que quedó activo.
pub fn register(app: &AppHandle, desired: &str) -> Result<String, String> {
    // El modo viaja con el atajo: los dos los decide la misma pantalla.
    crate::hotkey::set_push_to_talk(crate::settings::load(app).push_to_talk);

    let desired = desired.trim();
    let mut attempted: Vec<&str> = Vec::new();

    for candidate in [desired, DEFAULT_SHORTCUT, FALLBACK_SHORTCUT] {
        if candidate.is_empty() || attempted.contains(&candidate) {
            continue;
        }
        attempted.push(candidate);

        if crate::hotkey::set_combo(candidate) {
            if let Ok(mut slot) = app.state::<ActiveShortcut>().accelerator.lock() {
                *slot = candidate.to_string();
            }
            return Ok(candidate.to_string());
        }
    }

    crate::hotkey::clear_combo();
    if let Ok(mut slot) = app.state::<ActiveShortcut>().accelerator.lock() {
        slot.clear();
    }

    Err(format!(
        "Ninguna combinación sirvió. Intentos: {}. Necesita dos modificadores, \
         o un modificador más una tecla.",
        attempted.join(", ")
    ))
}

