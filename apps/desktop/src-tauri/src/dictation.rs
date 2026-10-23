//! Los comandos que la interfaz llama para convertir un clip en texto pegable.
//!
//! La transcripción sale directo a Deepgram desde Rust (`stt.rs`) y el formateo
//! a Groq (`polish.rs`). Las credenciales quedan en el llavero del sistema y
//! nunca entran al webview.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use tauri::AppHandle;

/// Si se puede dictar: hace falta la credencial de Deepgram.
pub fn puede_dictar(app: &AppHandle) -> bool {
    crate::keys::deepgram(app).is_some()
}

/// El resultado de un dictado, tal cual lo consume la interfaz.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dictado {
    pub texto: String,
    /// Con qué modelo se transcribió. **Lo informa quien transcribió**, no el cliente.
    pub modelo: String,
}

/// Audio a texto listo para pegar.
///
/// Transcribe y formatea en un solo comando. Si el formateo falla, `polish.rs`
/// devuelve el crudo, así que la interfaz no necesita un paso aparte para eso.
///
/// El audio viaja en base64 y no como arreglo de bytes: un `Uint8Array` cruzando el
/// puente de Tauri se serializa como una lista de números, que para un clip de medio
/// megabyte son varios millones de caracteres de JSON. Base64 agrega un tercio.
#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    audio: String,
    mime: String,
    language: String,
    keywords: Vec<String>,
) -> Result<Dictado, String> {
    let bytes = STANDARD
        .decode(audio.as_bytes())
        .map_err(|e| format!("el audio llegó mal codificado: {e}"))?;

    if !puede_dictar(&app) {
        return Err("Configurá tu API key de Deepgram en Ajustes para dictar.".to_string());
    }
    let crudo = crate::stt::transcribe(&app, bytes, &mime, &language, &keywords).await?;

    // El formateo nunca puede hacer fracasar un dictado: ante cualquier problema
    // devuelve el crudo.
    let texto = crate::polish::format(&app, &crudo).await;

    Ok(Dictado {
        texto,
        modelo: crate::stt::MODEL.to_string(),
    })
}

/// Qué credenciales hay, para que la interfaz sepa qué puede ofrecer.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeys {
    /// Sin esto no se puede dictar: es la credencial de Deepgram.
    pub transcription: bool,
    /// Sin esto se dicta igual, pero el texto sale sin formatear.
    pub formatting: bool,
}

/// Timeout de los chequeos de credencial del botón "guardar y probar".
const VERIFY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

fn verify_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(VERIFY_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// Chequeo del botón "guardar y probar" de la configuración, para Deepgram.
///
/// Pega un pedido barato —listar proyectos— sólo para ver si la credencial sirve. Va
/// por acá y no por el webview para no tener que sacar la key del proceso de Rust.
///
/// Deepgram autentica con `Authorization: Token <key>`, no con Bearer. Es la
/// diferencia que hace que copiar el chequeo de Groq no alcance.
#[tauri::command]
pub async fn verify_deepgram_key(key: String) -> Result<(), String> {
    let response = verify_client()?
        .get("https://api.deepgram.com/v1/projects")
        .header("Authorization", format!("Token {}", key.trim()))
        .send()
        .await
        .map_err(|_| {
            "Sin conexión con Deepgram. Revisá internet, el firewall o el proxy.".to_string()
        })?;

    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 => {
            Err("API key inválida o sin permisos. Revisala en console.deepgram.com.".to_string())
        }
        other => Err(format!("Deepgram rechazó el pedido (HTTP {other}).")),
    }
}

/// Lo mismo para Groq, que es la credencial del formateo.
#[tauri::command]
pub async fn verify_groq_key(key: String) -> Result<(), String> {
    let response = verify_client()?
        .get("https://api.groq.com/openai/v1/models")
        .bearer_auth(key.trim())
        .send()
        .await
        .map_err(|_| "Sin conexión con Groq. Revisá internet, el firewall o el proxy.".to_string())?;

    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err("API key inválida o sin permisos. Revisala en console.groq.com.".to_string()),
        other => Err(format!("Groq rechazó el pedido (HTTP {other}).")),
    }
}

#[tauri::command]
pub fn provider_keys(app: AppHandle) -> ProviderKeys {
    ProviderKeys {
        transcription: puede_dictar(&app),
        formatting: crate::keys::groq(&app).is_some(),
    }
}
