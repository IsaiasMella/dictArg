//! Atajo global por hook de teclado de bajo nivel (Windows).
//!
//! Reemplaza a `RegisterHotKey`, que tiene dos límites que para este producto no
//! son negociables:
//!
//! 1. **Exige una tecla final.** Combinaciones de solo modificadores —`Ctrl+Win`,
//!    la que usa Wispr Flow— no se pueden expresar.
//! 2. **Deja pasar los modificadores a la aplicación de adelante.** Con `Alt` eso
//!    hace que Windows le abra el menú y el foco se vaya del campo de texto.
//!
//! Un `WH_KEYBOARD_LL` ve cada tecla antes que el resto del sistema y decide si
//! la deja pasar. Con eso el atajo del usuario le gana a Windows y a cualquier
//! programa, que es lo que se espera de un atajo que el usuario configuró.
//!
//! El hook vive en su propio hilo con su bomba de mensajes: Windows exige que la
//! función se atienda desde el hilo que la instaló, y si tarda demasiado el
//! sistema la desengancha sola. Por eso el trabajo real —emitir el evento— se
//! delega y la función retorna enseguida.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;

/// Combinación que dispara el dictado.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Combo {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub win: bool,
    /// Tecla final. `None` = la combinación es solo de modificadores.
    pub key: Option<u32>,
}

impl Combo {
    /// Cuántos modificadores pide.
    fn modifier_count(&self) -> usize {
        [self.ctrl, self.alt, self.shift, self.win]
            .iter()
            .filter(|on| **on)
            .count()
    }

    /// Una combinación de un solo modificador suelto haría inusable el teclado.
    pub fn is_usable(&self) -> bool {
        if self.key.is_some() {
            self.modifier_count() >= 1
        } else {
            self.modifier_count() >= 2
        }
    }
}

/// Traduce un acelerador (`"Ctrl+Super"`, `"Ctrl+Alt+Space"`) a una combinación.
pub fn parse(accelerator: &str) -> Option<Combo> {
    let mut combo = Combo::default();

    for raw in accelerator.split('+') {
        match raw.trim().to_ascii_uppercase().as_str() {
            "" => return None,
            "CTRL" | "CONTROL" => combo.ctrl = true,
            "ALT" | "OPTION" => combo.alt = true,
            "SHIFT" => combo.shift = true,
            "SUPER" | "WIN" | "META" | "CMD" | "COMMAND" => combo.win = true,
            token => {
                if combo.key.is_some() {
                    return None;
                }
                combo.key = Some(virtual_key(token)?);
            }
        }
    }

    combo.is_usable().then_some(combo)
}

/// Nombre de tecla -> código virtual de Windows.
fn virtual_key(token: &str) -> Option<u32> {
    if let Some(letter) = token.strip_prefix("KEY") {
        return single_char(letter);
    }
    if token.len() == 1 {
        return single_char(token);
    }
    if let Some(number) = token.strip_prefix('F') {
        if let Ok(index) = number.parse::<u32>() {
            if (1..=24).contains(&index) {
                return Some(0x70 + index - 1); // VK_F1 = 0x70
            }
        }
    }

    Some(match token {
        "SPACE" => 0x20,
        "ENTER" | "RETURN" => 0x0D,
        "TAB" => 0x09,
        "BACKSPACE" => 0x08,
        "ESCAPE" | "ESC" => 0x1B,
        "INSERT" => 0x2D,
        "DELETE" => 0x2E,
        "HOME" => 0x24,
        "END" => 0x23,
        "PAGEUP" => 0x21,
        "PAGEDOWN" => 0x22,
        "UP" => 0x26,
        "DOWN" => 0x28,
        "LEFT" => 0x25,
        "RIGHT" => 0x27,
        "BACKQUOTE" => 0xC0,
        "MINUS" => 0xBD,
        "EQUAL" => 0xBB,
        "BRACKETLEFT" => 0xDB,
        "BRACKETRIGHT" => 0xDD,
        "SEMICOLON" => 0xBA,
        "QUOTE" => 0xDE,
        "COMMA" => 0xBC,
        "PERIOD" => 0xBE,
        "SLASH" => 0xBF,
        "BACKSLASH" => 0xDC,
        _ => return None,
    })
}

fn single_char(token: &str) -> Option<u32> {
    let ch = token.chars().next()?.to_ascii_uppercase();
    match ch {
        'A'..='Z' => Some(ch as u32),
        '0'..='9' => Some(ch as u32),
        _ => None,
    }
}

// ── Estado compartido con el hook ───────────────────────────────

static APP: OnceLock<AppHandle> = OnceLock::new();
static COMBO: Mutex<Option<Combo>> = Mutex::new(None);
static PRESSED: Mutex<Pressed> = Mutex::new(Pressed::new());
/// `true` = mantener apretado para hablar; `false` = alternar.
static PUSH_TO_TALK: AtomicBool = AtomicBool::new(false);

pub fn set_push_to_talk(enabled: bool) {
    PUSH_TO_TALK.store(enabled, Ordering::Relaxed);
}

#[derive(Default)]
struct Pressed {
    ctrl: bool,
    alt: bool,
    shift: bool,
    win: bool,
    /// La combinación ya disparó y todavía no se soltó: evita que mantenerla
    /// apretada dispare una y otra vez.
    fired: bool,
}

impl Pressed {
    const fn new() -> Self {
        Self {
            ctrl: false,
            alt: false,
            shift: false,
            win: false,
            fired: false,
        }
    }

    /// Los modificadores coinciden exactamente: ni de menos ni de más. Sin la
    /// exigencia de "ni de más", `Ctrl+Win` se dispararía también al hacer
    /// `Ctrl+Win+Alt`, que puede ser otro atajo distinto.
    fn matches(&self, combo: &Combo) -> bool {
        self.ctrl == combo.ctrl
            && self.alt == combo.alt
            && self.shift == combo.shift
            && self.win == combo.win
    }

    /// Hay al menos un modificador apretado en este momento.
    fn any_modifier(&self) -> bool {
        self.ctrl || self.alt || self.shift || self.win
    }
}

/// Cambia la combinación activa. Devuelve `false` si el acelerador no sirve.
pub fn set_combo(accelerator: &str) -> bool {
    match parse(accelerator) {
        Some(combo) => {
            if let Ok(mut slot) = COMBO.lock() {
                *slot = Some(combo);
            }
            if let Ok(mut pressed) = PRESSED.lock() {
                *pressed = Pressed::new();
            }
            true
        }
        None => false,
    }
}

pub fn clear_combo() {
    if let Ok(mut slot) = COMBO.lock() {
        *slot = None;
    }
}

/// Qué modificador es este código virtual, si es alguno.
fn modifier_of(vk: u32) -> Option<Modifier> {
    Some(match vk {
        0x11 | 0xA2 | 0xA3 => Modifier::Ctrl,  // VK_CONTROL, L, R
        0x12 | 0xA4 | 0xA5 => Modifier::Alt,   // VK_MENU, L, R
        0x10 | 0xA0 | 0xA1 => Modifier::Shift, // VK_SHIFT, L, R
        0x5B | 0x5C => Modifier::Win,          // VK_LWIN, VK_RWIN
        _ => return None,
    })
}

enum Modifier {
    Ctrl,
    Alt,
    Shift,
    Win,
}

/// Procesa una tecla. Devuelve `true` si hay que tragársela.
fn handle_key(vk: u32, down: bool) -> bool {
    let Ok(combo_slot) = COMBO.lock() else {
        return false;
    };
    let Some(combo) = combo_slot.clone() else {
        return false;
    };
    drop(combo_slot);

    let Ok(mut pressed) = PRESSED.lock() else {
        return false;
    };

    if let Some(modifier) = modifier_of(vk) {
        match modifier {
            Modifier::Ctrl => pressed.ctrl = down,
            Modifier::Alt => pressed.alt = down,
            Modifier::Shift => pressed.shift = down,
            Modifier::Win => pressed.win = down,
        }

        // Soltar un modificador rearma la combinación, y en modo mantener
        // apretado es además la señal de que hay que frenar.
        if !down {
            let was_firing = pressed.fired;
            pressed.fired = false;
            drop(pressed);
            if was_firing {
                release();
            }
            return false;
        }

        // Solo-modificadores: dispara al completarse el conjunto.
        if combo.key.is_none() && pressed.matches(&combo) && !pressed.fired {
            pressed.fired = true;
            drop(pressed);
            fire(&combo);
        }
        return false;
    }

    // Tecla normal. Con una combinación de solo modificadores, cualquier otra
    // tecla la cancela: el usuario está escribiendo, no invocando el atajo.
    //
    // Sólo cuenta como cancelación si hay un modificador apretado, o sea si la
    // tecla forma parte de un acorde (`Ctrl+C`). Escribir texto suelto no tiene
    // nada que ver con el atajo, y marcarlo igual dejaba la marca encendida:
    // como sólo se apaga al soltar un modificador, y al escribir no hay ninguno
    // apretado, la primera pulsación del atajo después de tipear se perdía
    // entera y había que repetirla.
    if combo.key.is_none() {
        if down && pressed.any_modifier() {
            pressed.fired = true;
        }
        return false;
    }

    if Some(vk) != combo.key || !pressed.matches(&combo) {
        return false;
    }

    if down {
        if !pressed.fired {
            pressed.fired = true;
            drop(pressed);
            fire(&combo);
        }
    } else {
        let was_firing = pressed.fired;
        pressed.fired = false;
        drop(pressed);
        if was_firing {
            release();
        }
        return true;
    }

    // Se traga la tecla final en ambos sentidos: es lo que impide que el
    // espacio se escriba en el documento y que Windows la interprete.
    true
}

/// Lo que hay que avisarle a la ventana principal, ya fuera del hook.
struct Action {
    /// Carga del evento: `"toggle"`, `"start"` o `"stop"`.
    name: &'static str,
    /// Hay que neutralizar el modo menú de la aplicación de adelante.
    neutralize: bool,
}

/// Cola hacia el hilo que emite los eventos.
///
/// Antes `fire` y `release` abrían un hilo cada uno. Dos hilos recién creados no
/// tienen ningún orden garantizado entre sí, y en una pulsación corta —apretar y
/// soltar casi al mismo tiempo, que es lo normal manteniendo apretado para
/// hablar— el `stop` podía llegar **antes** que el `start`: el `stop` se
/// descartaba por llegar con el dictado todavía en reposo y el `start` dejaba
/// grabando algo que ya nadie iba a frenar. Un único hilo consumidor conserva el
/// orden en que ocurrieron las teclas.
static ACTIONS: Mutex<Option<std::sync::mpsc::Sender<Action>>> = Mutex::new(None);

fn start_dispatcher() {
    let (sender, receiver) = std::sync::mpsc::channel::<Action>();

    match ACTIONS.lock() {
        Ok(mut slot) if slot.is_none() => *slot = Some(sender),
        _ => return,
    }

    std::thread::spawn(move || {
        for action in receiver {
            if action.neutralize {
                crate::inject::neutralize_alt_menu();
            }
            if let Some(app) = APP.get() {
                // Por `heartbeat` y no por `emit` directo: cada pulsación lleva un
                // número de secuencia y se controla que el webview lo devuelva. Si
                // no vuelve, el hook seguiría tragándose la tecla mientras no pasa
                // nada, que es el peor modo de falla del producto.
                crate::heartbeat::emit_toggle(app, action.name);
            }
        }
    });
}

fn queue(action: Action) {
    if let Ok(slot) = ACTIONS.lock() {
        if let Some(sender) = slot.as_ref() {
            let _ = sender.send(action);
        }
    }
}

/// Dispara el dictado.
///
/// Corre dentro del hook, así que tiene que devolver en microsegundos: Windows
/// atiende **todo** el teclado del sistema a través de esta función, y si tarda
/// se nota como lentitud general al escribir. Por eso acá solo queda la llamada
/// que sí o sí tiene que ser sincrónica —anotar la ventana con foco, antes de
/// que cambie— y el resto se delega al hilo emisor.
fn fire(combo: &Combo) {
    crate::focus::remember();

    queue(Action {
        name: if PUSH_TO_TALK.load(Ordering::Relaxed) {
            "start"
        } else {
            "toggle"
        },
        // Alt sin Ctrl deja que la aplicación de adelante entre en modo menú.
        neutralize: combo.alt && !combo.ctrl,
    });
}

/// Se soltó la combinación. Solo importa cuando se graba manteniendo apretado.
fn release() {
    if !PUSH_TO_TALK.load(Ordering::Relaxed) {
        return;
    }
    queue(Action {
        name: "stop",
        neutralize: false,
    });
}

// ── El hook ─────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub fn install(app: AppHandle) {
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
        HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
        WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    unsafe extern "system" fn proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };

            // Las teclas que inyectamos nosotros al pegar no deben re-disparar
            // el atajo ni ser tragadas.
            let injected = info.flags.0 & LLKHF_INJECTED.0 != 0;

            if !injected {
                let message = wparam.0 as u32;
                let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                let up = message == WM_KEYUP || message == WM_SYSKEYUP;

                if (down || up) && handle_key(info.vkCode, down) {
                    return LRESULT(1);
                }
            }
        }

        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    let _ = APP.set(app);
    start_dispatcher();

    std::thread::spawn(|| unsafe {
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(proc), None, 0);
        if hook.is_err() {
            eprintln!("[dictarg] no se pudo instalar el hook de teclado");
            return;
        }

        // El hook solo recibe eventos si su hilo bombea mensajes.
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn install(app: AppHandle) {
    let _ = APP.set(app);
    start_dispatcher();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El default del producto. Si `parse` deja de aceptarlo, Voice se queda sin su
    /// única forma de invocarse — y el síntoma es que el atajo "no anda", sin más
    /// información. Por eso es el primer test del archivo.
    #[test]
    fn acepta_el_atajo_por_defecto() {
        let combo = parse(crate::shortcut::DEFAULT_SHORTCUT).expect("Ctrl+Super tiene que parsear");
        assert!(combo.ctrl);
        assert!(combo.win);
        assert!(!combo.alt);
        assert!(!combo.shift);
        assert_eq!(combo.key, None);
    }

    #[test]
    fn acepta_dos_modificadores_sin_tecla() {
        assert!(parse("Ctrl+Alt").is_some());
        assert!(parse("Alt+Shift").is_some());
    }

    #[test]
    fn rechaza_un_modificador_suelto() {
        // Un solo modificador sin tecla se tragaría esa tecla siempre: el teclado
        // quedaría inusable.
        assert_eq!(parse("Ctrl"), None);
        assert_eq!(parse("Alt"), None);
        assert_eq!(parse("Super"), None);
    }

    #[test]
    fn rechaza_una_tecla_sin_modificador() {
        assert_eq!(parse("Space"), None);
        assert_eq!(parse("F5"), None);
        assert_eq!(parse("A"), None);
    }

    #[test]
    fn acepta_un_modificador_mas_tecla() {
        let combo = parse("Ctrl+Alt+Space").expect("tiene que parsear");
        assert!(combo.ctrl && combo.alt);
        assert_eq!(combo.key, Some(0x20));
    }

    #[test]
    fn los_alias_de_cada_modificador_son_equivalentes() {
        // La interfaz escribe "Super", la documentación dice "Win" y los usuarios de
        // Mac escriben "Cmd". Los tres tienen que dar la misma combinación.
        let esperado = parse("Ctrl+Super");
        assert_eq!(parse("Ctrl+Win"), esperado);
        assert_eq!(parse("Ctrl+Meta"), esperado);
        assert_eq!(parse("Ctrl+Cmd"), esperado);
        assert_eq!(parse("Control+Command"), esperado);
        assert_eq!(parse("Alt+Space"), parse("Option+Space"));
    }

    #[test]
    fn no_distingue_mayusculas_ni_espacios() {
        assert_eq!(parse("ctrl+super"), parse("CTRL+SUPER"));
        assert_eq!(parse(" Ctrl + Super "), parse("Ctrl+Super"));
    }

    #[test]
    fn rechaza_dos_teclas_finales() {
        // "Ctrl+A+B" no es una combinación: es un error de tipeo, y aceptarlo
        // silenciosamente registraría algo que el usuario no pidió.
        assert_eq!(parse("Ctrl+A+B"), None);
        assert_eq!(parse("Ctrl+Space+Enter"), None);
    }

    #[test]
    fn rechaza_lo_vacio_y_lo_malformado() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("+"), None);
        assert_eq!(parse("Ctrl+"), None);
        assert_eq!(parse("Ctrl+NoExiste"), None);
    }

    #[test]
    fn las_teclas_de_funcion_van_de_f1_a_f24() {
        assert_eq!(parse("Ctrl+F1").and_then(|c| c.key), Some(0x70));
        assert_eq!(parse("Ctrl+F24").and_then(|c| c.key), Some(0x70 + 23));
        // F25 no existe: no hay que tomarlo como si fuera otra cosa.
        assert_eq!(parse("Ctrl+F25"), None);
        assert_eq!(parse("Ctrl+F0"), None);
    }

    #[test]
    fn is_usable_pide_dos_modificadores_solo_cuando_no_hay_tecla() {
        let solo_ctrl = Combo { ctrl: true, ..Default::default() };
        assert!(!solo_ctrl.is_usable());

        let ctrl_win = Combo { ctrl: true, win: true, ..Default::default() };
        assert!(ctrl_win.is_usable());

        let ctrl_space = Combo { ctrl: true, key: Some(0x20), ..Default::default() };
        assert!(ctrl_space.is_usable());

        let solo_tecla = Combo { key: Some(0x20), ..Default::default() };
        assert!(!solo_tecla.is_usable());
    }
}
