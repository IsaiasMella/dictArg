mod autostart;
mod contact;
mod db;
mod dictation;
mod dpapi;
mod focus;
mod heartbeat;
mod hotkey;
mod inject;
mod keys;
mod polish;
mod secret;
mod settings;
mod shortcut;
mod stt;
mod tray;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent};

/// Separación entre la pastilla y el borde inferior del área de trabajo, en px
/// lógicos. El área de trabajo ya excluye la barra de tareas, así que esto es
/// literalmente "cuánto respira la pastilla por encima de la barra".
const PILL_BOTTOM_MARGIN: f64 = 6.0;

pub fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings(&app);
}

#[tauri::command]
fn hide_settings_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Centra la pastilla abajo del monitor principal y la vuelve transparente al
/// mouse: si capturara clics taparía la app sobre la que el usuario está
/// dictando.
pub(crate) fn place_pill(app: &AppHandle) {
    let Some(pill) = app.get_webview_window("pill") else {
        return;
    };
    let _ = pill.set_ignore_cursor_events(true);

    let Ok(Some(monitor)) = pill.current_monitor() else {
        return;
    };
    let Ok(size) = pill.outer_size() else {
        return;
    };

    // `work_area` en vez de `size`: descuenta la barra de tareas sola, sin
    // importar su alto, su escala ni de qué lado del monitor esté. Contra el
    // tamaño crudo de la pantalla habría que adivinar ese alto.
    let area = monitor.work_area();
    let margin = (PILL_BOTTOM_MARGIN * monitor.scale_factor()).round() as i32;

    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - margin;
    let _ = pill.set_position(PhysicalPosition::new(x, y));
}

/// Reubica la pastilla, a pedido de la ventana principal.
///
/// La llama el controlador al empezar cada grabación. Es barato —dos consultas al
/// monitor y un `set_position`— y cubre el caso que ningún evento avisa: desconectar
/// el monitor donde estaba la pastilla.
#[tauri::command]
fn place_pill_command(app: AppHandle) {
    place_pill(&app);
}

/// Carga el `.env` desde los tres lugares donde puede estar, en orden.
///
/// `dotenvy::dotenv()` busca desde el directorio de trabajo hacia arriba, y eso
/// alcanza en desarrollo —donde el proceso arranca dentro del proyecto— pero no
/// en la aplicación instalada, que arranca desde cualquier lado y no encuentra
/// nada. De ahí que hasta ahora anduviera con `tauri dev` y no después del
/// build.
///
/// Ninguna carga pisa una variable que ya exista: gana la primera que la define.
fn load_env(app: &AppHandle) {
    if dotenvy::dotenv().is_ok() {
        eprintln!("[voice] credenciales: .env del proyecto");
        return;
    }

    // Al lado del ejecutable. Cómodo para una copia suelta, pero si la app está
    // instalada en Archivos de Programa hace falta ser administrador para
    // escribir ahí.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dotenvy::from_path(dir.join(".env")).is_ok() {
                eprintln!("[voice] credenciales: .env junto al ejecutable");
                return;
            }
        }
    }

    // El lugar recomendado para una instalación: no pide permisos de
    // administrador, sobrevive a las actualizaciones y es el mismo directorio
    // donde ya viven los ajustes.
    if let Ok(dir) = app.path().app_config_dir() {
        if dotenvy::from_path(dir.join(".env")).is_ok() {
            eprintln!("[voice] credenciales: .env en {}", dir.display());
            return;
        }
    }

    eprintln!("[voice] no se encontró ningún .env; las credenciales tienen que salir del llavero");
}

pub fn run() {
    tauri::Builder::default()
        // Debe ir primero: intercepta el arranque duplicado antes que nada más.
        // Una app que se prende sola con la compu se relanza a mano sin querer;
        // sin esto quedarían dos iconos en la bandeja y el segundo proceso no
        // podria registrar el atajo global (ya lo tiene el primero).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_settings(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(shortcut::ActiveShortcut::default())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            secret::set_api_key,
            secret::delete_api_key,
            inject::inject_text,
            inject::copy_text,
            dictation::transcribe_audio,
            dictation::provider_keys,
            heartbeat::dictation_ack,
            place_pill_command,
            dictation::verify_deepgram_key,
            dictation::verify_groq_key,
            autostart::get_autostart,
            autostart::set_autostart,
            open_settings_window,
            hide_settings_window,
            contact::open_contact,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Antes que nada: sin credenciales no se puede transcribir, y el
            // chequeo de más abajo decide si se abre la ventana por eso mismo.
            load_env(&handle);

            tray::create(&handle)?;
            place_pill(&handle);

            // Que Voice esté cuando se prende la máquina. Para un abogado o un
            // psicólogo que arranca el día dictando, una app que hay que abrir a mano
            // es una app que no está. Respeta el toggle de Ajustes.
            autostart::asegurar(&handle);

            // El hook tiene que estar andando antes de pedirle una combinación.
            hotkey::install(handle.clone());

            let prefs = settings::load(&handle);
            if let Err(e) = shortcut::register(&handle, &prefs.shortcut) {
                // No es fatal: la app sigue viva y la UI puede mostrar el problema.
                eprintln!("[voice] {e}");
                let _ = handle.emit("dictation-shortcut-error", e);
            }

            // Primer arranque: sin la credencial con la que se transcribe no hay
            // nada que hacer, así que abrimos la configuración en vez de
            // esconderse en la bandeja.
            if !dictation::puede_dictar(&handle) {
                show_settings(&handle);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar la ventana principal no cierra la app: se esconde en la bandeja.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }

            // Cambió la escala o el monitor: la pastilla tiene que volver a su lugar.
            //
            // `place_pill` corría una sola vez, en el arranque. Después de conectar un
            // monitor, cambiar la resolución, mover la barra de tareas o enchufar una
            // pantalla con otro DPI, la pastilla se quedaba donde estaba —a veces
            // fuera del área visible— hasta reiniciar la app.
            //
            // Sólo `ScaleFactorChanged`. Escuchar también `Moved` sería un bucle:
            // `place_pill` llama a `set_position`, que emite `Moved`.
            if matches!(event, WindowEvent::ScaleFactorChanged { .. }) && window.label() == "pill" {
                crate::place_pill(&window.app_handle().clone());
            }
        })
        .build(tauri::generate_context!())
        .expect("error al iniciar Dictarg")
        .run(|_app, event| {
            // Sin esto la app terminaría al esconder la última ventana visible.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
