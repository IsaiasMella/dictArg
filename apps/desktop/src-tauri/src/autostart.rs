//! Arranque automático con el sistema.
//!
//! El plugin registra la ruta del ejecutable actual: en Windows como entrada del
//! registro (`Run`), en macOS como LaunchAgent y en Linux como `.desktop` en
//! `~/.config/autostart`. Se le pasa `--autostart` como argumento para poder
//! distinguir ese arranque de uno manual.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartStatus {
    pub enabled: bool,
    /// En `tauri dev` el ejecutable registrado es el binario de debug, que
    /// depende del servidor de Vite: al bootear solo abriría una ventana vacía.
    /// La UI lo avisa en vez de dejar que el usuario se coma la sorpresa.
    pub dev_build: bool,
}

fn status(app: &AppHandle) -> AutostartStatus {
    AutostartStatus {
        enabled: app.autolaunch().is_enabled().unwrap_or(false),
        dev_build: cfg!(debug_assertions),
    }
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> AutostartStatus {
    status(&app)
}

/// Deja registrado el arranque automático, salvo que lo hayan apagado a mano.
///
/// Corre en cada arranque y no una sola vez en el primero. El motivo es que el
/// registro se pierde sin que nadie lo toque: un instalador que reescribe la entrada,
/// una herramienta de "optimizar el inicio", una restauración del sistema. Verificar
/// cuesta una lectura del registro y evita un modo de falla que ya pasó —la app
/// simplemente no está cuando se prende la máquina—, que es el peor posible para
/// alguien que abre el día dictando.
///
/// **En `tauri dev` no hace nada.** Ahí el ejecutable que se registraría es el binario
/// de debug, que depende del servidor de Vite: al bootear abriría una ventana vacía.
pub fn asegurar(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    // La decisión de la persona gana siempre. Sin esto, apagar el toggle no serviría
    // de nada: el próximo arranque lo volvería a prender.
    if crate::settings::load(app).autostart_optout {
        return;
    }

    let manager = app.autolaunch();
    if manager.is_enabled().unwrap_or(false) {
        return;
    }

    // Un fallo acá no puede tumbar el arranque: que Voice no quede registrado es una
    // molestia, que no abra es el producto roto.
    if let Err(e) = manager.enable() {
        eprintln!("[dictarg] no se pudo registrar el arranque automático: {e}");
    }
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<AutostartStatus, String> {
    let manager = app.autolaunch();
    let outcome = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };

    outcome.map_err(|e| {
        let verb = if enabled { "activar" } else { "desactivar" };
        format!("No se pudo {verb} el inicio automático: {e}")
    })?;

    // Se guarda la **decisión**, no el estado: es lo que hace que `asegurar` no vuelva
    // a prenderlo en el próximo arranque. Un fallo al guardar no invalida el cambio,
    // que ya está aplicado en el sistema operativo.
    let mut prefs = crate::settings::load(&app);
    if prefs.autostart_optout == enabled {
        prefs.autostart_optout = !enabled;
        if let Err(e) = crate::settings::store(&app, &prefs) {
            eprintln!("[dictarg] {e}");
        }
    }

    Ok(status(&app))
}
