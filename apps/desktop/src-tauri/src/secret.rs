//! Guardado de las API keys de los proveedores.
//!
//! Primero intenta el llavero del SO (Credential Manager en Windows, Keychain en
//! macOS, Secret Service en Linux). Si no hay llavero disponible —caso típico de
//! un Linux headless o sin `gnome-keyring`— cae a un archivo en el directorio de
//! config de la app, con permisos restringidos en Unix. La UI muestra cuál de los
//! dos está en uso para que la degradación no sea silenciosa.
//!
//! **Todo acá es por cuenta.** Hubo una versión en la que la única función que
//! escribía tenía la cuenta de Groq clavada adentro: la interfaz podía guardar la
//! credencial del formateo —que es opcional— y no la de la transcripción, que es
//! la que hace falta para dictar.

use std::fs;
use std::path::PathBuf;

use keyring::Entry;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.isaias.voice";

/// Nombre viejo del campo de Groq en el archivo de fallback.
///
/// Se sigue leyendo para que una instalación que ya venía funcionando no pierda su
/// credencial porque cambió el nombre del campo. No se escribe nunca más.
const LEGACY_GROQ_FIELD: &str = "groqApiKey";

fn entry_for(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("llavero no disponible: {e}"))
}

fn fallback_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no se pudo resolver el directorio de config: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("no se pudo crear {}: {e}", dir.display()))?;
    Ok(dir.join("credentials.json"))
}

/// El contenido del archivo de fallback, o un objeto vacío si no hay o está roto.
///
/// Se lee como bytes y no como texto porque en Windows el archivo está cifrado con
/// DPAPI. Un archivo viejo, en texto plano, se sigue leyendo igual. Ver `dpapi.rs`.
fn read_fallback_file(app: &AppHandle) -> Map<String, Value> {
    fallback_path(app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|bruto| crate::dpapi::descifrar(&bruto))
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

/// Escribe el archivo, cifrado donde se pueda.
///
/// En Windows va por DPAPI, atado a la cuenta de usuario. En el resto va en claro con
/// permisos `0600`, que es lo que corresponde ahí.
fn write_fallback_file(path: &PathBuf, contenido: &str) -> Result<(), String> {
    let bytes = crate::dpapi::cifrar(contenido)
        .unwrap_or_else(|| contenido.as_bytes().to_vec());

    fs::write(path, bytes).map_err(|e| format!("no se pudo escribir {}: {e}", path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn read_fallback_for(app: &AppHandle, account: &str) -> Option<String> {
    let file = read_fallback_file(app);

    let mut candidatos = vec![account];
    if account == crate::keys::GROQ_ACCOUNT {
        candidatos.push(LEGACY_GROQ_FIELD);
    }

    candidatos
        .into_iter()
        .find_map(|campo| file.get(campo).and_then(Value::as_str).map(str::to_string))
        .filter(|s| !s.is_empty())
}

/// Escribe una credencial en el archivo, **conservando las de los otros proveedores**.
///
/// Antes se reescribía el archivo entero con un solo campo. Con un solo proveedor eso
/// no se notaba; con dos, guardar la key de uno borraba silenciosamente la del otro.
fn write_fallback(app: &AppHandle, account: &str, key: &str) -> Result<(), String> {
    let path = fallback_path(app)?;

    let mut file = read_fallback_file(app);
    file.insert(account.to_string(), Value::String(key.to_string()));

    write_fallback_file(&path, &Value::Object(file).to_string())
}

fn delete_fallback_for(app: &AppHandle, account: &str) -> Result<(), String> {
    let path = fallback_path(app)?;

    let mut file = read_fallback_file(app);
    file.remove(account);
    if account == crate::keys::GROQ_ACCOUNT {
        file.remove(LEGACY_GROQ_FIELD);
    }

    // Si no queda ninguna credencial, se borra el archivo en vez de dejar un `{}`
    // dando vueltas en el directorio de configuración.
    if file.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }

    write_fallback_file(&path, &Value::Object(file).to_string())
}

/// Lee la credencial de `account` desde donde esté disponible.
pub fn read_account(app: &AppHandle, account: &str) -> Option<String> {
    if let Ok(e) = entry_for(account) {
        if let Ok(key) = e.get_password() {
            if !key.is_empty() {
                return Some(key);
            }
        }
    }
    read_fallback_for(app, account)
}

/// Dónde está la credencial de este proveedor: "env" | "keyring" | "file" | "none".
///
/// El orden replica el de `keys::of`, así que lo que informa es de dónde va a salir
/// realmente la credencial cuando se dicte. "env" existe para que en desarrollo la
/// pantalla no diga "no hay credencial" mientras el `.env` la está proveyendo.
pub fn storage_kind(app: &AppHandle, provider: crate::keys::Provider) -> String {
    if std::env::var(provider.env())
        .ok()
        .is_some_and(|v| !v.trim().is_empty())
    {
        return "env".to_string();
    }

    let account = provider.account();

    let en_llavero = entry_for(account)
        .and_then(|e| e.get_password().map_err(|e| e.to_string()))
        .is_ok_and(|key| !key.is_empty());

    if en_llavero {
        return "keyring".to_string();
    }
    if read_fallback_for(app, account).is_some() {
        return "file".to_string();
    }
    "none".to_string()
}

/// Guarda un secreto en una cuenta del llavero. Devuelve dónde quedó.
///
/// Es la primitiva que usa `set_api_key`. Todos los secretos del cliente pasan por
/// acá, que es lo que hace que "dónde vive un secreto" sea una sola decisión.
pub fn guardar_en_cuenta(app: &AppHandle, account: &str, valor: &str) -> Result<String, String> {
    let valor = valor.trim();
    if valor.is_empty() {
        return Err("El valor está vacío.".to_string());
    }

    match entry_for(account).and_then(|e| e.set_password(valor).map_err(|e| e.to_string())) {
        Ok(()) => Ok("keyring".to_string()),
        Err(keyring_err) => {
            write_fallback(app, account, valor).map_err(|file_err| {
                format!("no se pudo guardar (llavero: {keyring_err}; archivo: {file_err})")
            })?;
            Ok("file".to_string())
        }
    }
}

/// Borra el secreto de una cuenta, sin tocar los de las otras.
pub fn borrar_cuenta(app: &AppHandle, account: &str) -> Result<(), String> {
    if let Ok(e) = entry_for(account) {
        let _ = e.delete_password();
    }
    delete_fallback_for(app, account)
}

/// Guarda la credencial de un proveedor. Devuelve dónde quedó: "keyring" o "file".
#[tauri::command]
pub fn set_api_key(
    app: AppHandle,
    provider: crate::keys::Provider,
    key: String,
) -> Result<String, String> {
    guardar_en_cuenta(&app, provider.account(), &key)
        .map_err(|e| if e.contains("vacío") { "La API key está vacía.".to_string() } else { e })
}

/// Borra la credencial de un proveedor, sin tocar la del otro.
#[tauri::command]
pub fn delete_api_key(app: AppHandle, provider: crate::keys::Provider) -> Result<(), String> {
    borrar_cuenta(&app, provider.account())
}
