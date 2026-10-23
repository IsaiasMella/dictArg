//! Recuerda dónde estaba escribiendo el usuario y devuelve el foco ahí antes de
//! pegar.
//!
//! Sin esto el pegado va a parar a donde haya quedado el foco, que no siempre es
//! donde el usuario hizo clic: cualquier cosa que ocurra entre que apretás el
//! atajo y que llega el texto —el sistema operativo interpretando un modificador
//! como acceso al menú, una notificación, otro programa— se lleva el cursor y el
//! `Ctrl+V` termina en el vacío.
//!
//! La ventana se anota al empezar a grabar y se restaura justo antes de pegar.

use std::sync::Mutex;

/// Ventana que tenía el foco cuando arrancó la grabación.
///
/// Se guarda como `isize` y no como `HWND` a propósito: el handle no es `Send`,
/// y esto viaja entre el hilo del atajo y el hilo que pega.
static TARGET: Mutex<Option<isize>> = Mutex::new(None);

/// Anota la ventana de adelante. Se llama al empezar a grabar.
pub fn remember() {
    let handle = current_foreground();
    if let Ok(mut slot) = TARGET.lock() {
        *slot = handle;
    }
}

/// Devuelve el foco a la ventana anotada. Se llama justo antes de pegar.
pub fn restore() {
    let target = TARGET.lock().ok().and_then(|slot| *slot);
    if let Some(handle) = target {
        focus_window(handle);
    }
}

#[cfg(target_os = "windows")]
fn current_foreground() -> Option<isize> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let handle = unsafe { GetForegroundWindow() };
    if handle.0.is_null() {
        None
    } else {
        Some(handle.0 as isize)
    }
}

/// Trae al frente la ventana indicada.
///
/// `SetForegroundWindow` a secas falla salvo que el proceso que llama sea ya el
/// de adelante: Windows lo bloquea para que ningún programa robe el foco. El
/// rodeo estándar es `AttachThreadInput`, que engancha nuestra cola de entrada a
/// la de la ventana destino durante el tiempo mínimo, hace el cambio, y se
/// desengancha.
#[cfg(target_os = "windows")]
fn focus_window(handle: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{SetActiveWindow, SetFocus};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
    };

    let target = HWND(handle as *mut core::ffi::c_void);

    unsafe {
        // La ventana pudo haberse cerrado mientras dictaba.
        if !IsWindow(Some(target)).as_bool() {
            return;
        }

        let foreground = GetForegroundWindow();
        let target_thread = GetWindowThreadProcessId(target, None);
        let foreground_thread = if foreground.0.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground, None)
        };
        let own_thread = GetCurrentThreadId();

        let attached_foreground =
            foreground_thread != 0 && foreground_thread != own_thread &&
            AttachThreadInput(own_thread, foreground_thread, true).as_bool();
        let attached_target =
            target_thread != 0 && target_thread != own_thread && target_thread != foreground_thread
                && AttachThreadInput(own_thread, target_thread, true).as_bool();

        let _ = SetForegroundWindow(target);
        let _ = SetActiveWindow(target);
        let _ = SetFocus(Some(target));

        if attached_target {
            let _ = AttachThreadInput(own_thread, target_thread, false);
        }
        if attached_foreground {
            let _ = AttachThreadInput(own_thread, foreground_thread, false);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn current_foreground() -> Option<isize> {
    // En macOS y Linux el foco no se pierde por este motivo: el atajo global no
    // deja pasar modificadores sueltos a la aplicación de adelante.
    None
}

#[cfg(not(target_os = "windows"))]
fn focus_window(_handle: isize) {}
