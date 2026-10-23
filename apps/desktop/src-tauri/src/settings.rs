//! Preferencias no sensibles (atajo, idioma). La API key NO vive acá:
//! se guarda en el llavero del sistema, ver `secret.rs`.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Tope duro de retención del historial.
///
/// No hay opción de "para siempre" a propósito: sobre SQLite, un archivo que
/// nunca se poda crece sin límite en la máquina de alguien que no lo va a
/// revisar nunca. El tope se aplica acá y no sólo en la interfaz, para que
/// editar `settings.json` a mano tampoco lo saltee.
pub const MAX_RETENTION_DAYS: u32 = 365;
pub const MIN_RETENTION_DAYS: u32 = 7;

/// `#[serde(default)]` a nivel de struct: un `settings.json` escrito por una
/// versión anterior no tiene los campos nuevos, y sin esto la deserialización
/// entera fallaría y le resetearíamos la configuración al usuario en silencio.
/// Con el default, los campos que falten toman su valor por defecto y el resto
/// se conserva.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Acelerador tal cual lo pidió el usuario (puede no ser registrable).
    pub shortcut: String,
    pub language: String,
    /// Restaurar el contenido previo del portapapeles después de pegar.
    ///
    /// **Encendido por defecto.** Estuvo apagado mientras la restauración era a
    /// ciegas: se devolvía el contenido viejo al segundo, compitiendo con las
    /// aplicaciones que leen el portapapeles de forma diferida —todo lo basado
    /// en Chromium—, y el dictado podía terminar no pegándose.
    ///
    /// Ahora la devolución sólo ocurre si el portapapeles todavía tiene el
    /// dictado, así que no puede pisar nada que el usuario haya copiado
    /// mientras tanto, y el margen de un segundo se respeta igual. Con eso, el
    /// costo de tenerlo prendido desapareció y el beneficio es diario: se copia
    /// un link, se dicta, y el link sigue estando.
    pub restore_clipboard: bool,
    /// Mostrar la pastilla también cuando no pasa nada.
    pub show_pill_when_idle: bool,
    /// Micrófono elegido. `None` = el que el sistema tenga por defecto.
    pub mic_device_id: Option<String>,
    /// Días que se conservan los dictados. Acotado a [`MIN`, `MAX`]_RETENTION_DAYS.
    pub history_retention_days: u32,
    /// Cómo llamar al usuario en el saludo y en el informe de uso.
    pub user_name: String,
    /// `true` = grabar mientras el atajo está apretado; `false` = alternar.
    pub push_to_talk: bool,
    /// Un sonido corto al empezar y al terminar de grabar, para saber que Voice
    /// escuchó sin mirar la pantalla. Encendido por defecto; los sonidos viven en
    /// `sonidos.ts`, acá sólo se guarda la decisión.
    pub play_sounds: bool,
    /// Pasar el texto por el modelo de formateo antes de pegarlo.
    ///
    /// **Prendido por defecto** (ver `polish::DEFAULT_ENABLED`) y se cambia con el
    /// switch de Ajustes. Antes de tocar el formateo, leer `polish.rs`.
    pub formatting: bool,
    /// Que la persona apagó el arranque automático **a mano**.
    ///
    /// No es "está apagado": eso lo sabe el sistema operativo y lo contesta el plugin.
    /// Esto es la decisión, y existe para poder distinguirla de "todavía nadie lo
    /// prendió". Voice se registra solo en el arranque —para quien empieza el día
    /// dictando, una app que hay que abrir a mano es una app que no está cuando se la
    /// necesita— y este campo es lo único que lo frena. Ver `autostart::asegurar`.
    pub autostart_optout: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: crate::shortcut::DEFAULT_SHORTCUT.to_string(),
            language: "es".to_string(),
            restore_clipboard: true,
            show_pill_when_idle: true,
            mic_device_id: None,
            history_retention_days: 90,
            user_name: String::new(),
            push_to_talk: false,
            play_sounds: true,
            formatting: crate::polish::DEFAULT_ENABLED,
            autostart_optout: false,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no se pudo resolver el directorio de config: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("no se pudo crear {}: {e}", dir.display()))?;
    Ok(dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    let mut settings: Settings = settings_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default();

    settings.history_retention_days = settings
        .history_retention_days
        .clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
    settings
}

pub fn store(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("no se pudo serializar la configuración: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("no se pudo escribir {}: {e}", path.display()))
}

/// Lo que la UI necesita saber al arrancar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    #[serde(flatten)]
    pub settings: Settings,
    /// Atajo realmente registrado en el SO (puede diferir de `shortcut`).
    pub effective_shortcut: String,
    /// Qué credenciales hay, una por proveedor.
    ///
    /// Reemplaza al `has_api_key` viejo, que era un solo booleano e informaba la
    /// presencia de la key de **Groq** — la del formateo, que es opcional. La
    /// pantalla mostraba "configurada" mientras faltaba la única indispensable.
    pub keys: crate::dictation::ProviderKeys,
    /// Dónde quedó guardada cada una: "keyring" | "file" | "none".
    pub key_storage: KeyStorage,
    /// El modelo con el que realmente se transcribe.
    ///
    /// Va en la vista y no en `Settings` porque no es una preferencia: no hay
    /// interfaz para cambiarlo y nunca la hubo. Mientras vivió en `Settings` era un
    /// valor guardado en disco que nadie actualizaba, y la tarjeta de costo cotizaba
    /// contra él.
    pub model: &'static str,
}

/// Dónde quedó guardada la credencial de cada proveedor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStorage {
    pub transcription: String,
    pub formatting: String,
}

fn view_of(app: &AppHandle, settings: Settings) -> SettingsView {
    SettingsView {
        effective_shortcut: crate::shortcut::current(app),
        keys: crate::dictation::provider_keys(app.clone()),
        key_storage: KeyStorage {
            transcription: crate::secret::storage_kind(app, crate::keys::Provider::Deepgram),
            formatting: crate::secret::storage_kind(app, crate::keys::Provider::Groq),
        },
        model: crate::stt::MODEL,
        settings,
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> SettingsView {
    let settings = load(&app);
    view_of(&app, settings)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, mut settings: Settings) -> Result<SettingsView, String> {
    settings.history_retention_days = settings
        .history_retention_days
        .clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
    store(&app, &settings)?;
    // Re-registrar el atajo: si el pedido no es válido, `register` cae al default.
    // Un fallo acá no invalida el guardado; queda reflejado en `effectiveShortcut`,
    // que la UI compara contra lo pedido para avisar.
    if let Err(e) = crate::shortcut::register(&app, &settings.shortcut) {
        eprintln!("[voice] {e}");
    }
    Ok(view_of(&app, settings))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un `settings.json` de antes de los sonidos no trae el campo. Tiene que cargar
    /// igual —sin perder lo demás— y con los sonidos prendidos, que es el default.
    #[test]
    fn un_settings_viejo_carga_con_los_sonidos_prendidos() {
        let viejo = r#"{ "shortcut": "Ctrl+Shift+Space", "pushToTalk": true }"#;
        let settings: Settings = serde_json::from_str(viejo).expect("tiene que cargar");

        assert!(settings.play_sounds);
        assert!(settings.push_to_talk);
        assert_eq!(settings.shortcut, "Ctrl+Shift+Space");
    }

    #[test]
    fn apagarlos_se_respeta() {
        let settings: Settings =
            serde_json::from_str(r#"{ "playSounds": false }"#).expect("tiene que cargar");

        assert!(!settings.play_sounds);
    }
}
