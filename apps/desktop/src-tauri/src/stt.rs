//! Transcripción: audio en bytes, texto de vuelta.
//!
//! **La interfaz es [`transcribe`] y el proveedor es un detalle de este
//! archivo.** Hoy adentro hay Deepgram Nova-3; cambiarlo por otro es reescribir
//! lo de acá abajo sin tocar a nadie más.
//!
//! El pedido sale desde Rust y no desde el webview por dos razones, y las dos
//! importan: Deepgram rechaza por CORS los pedidos REST hechos desde un
//! navegador, y así la credencial nunca entra al proceso que dibuja la interfaz.

use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

const ENDPOINT: &str = "https://api.deepgram.com/v1/listen";
/// El modelo con el que se transcribe. **Única definición en todo el proyecto.**
///
/// Estuvo declarado en tres lugares —acá, en `settings.rs` y en `transcription.ts`—
/// y dos estaban desactualizados. El de `settings.rs` decía `whisper-large-v3` y era
/// el que usaba la tarjeta de costo de Inicio para cotizar, así que mostraba menos de
/// la mitad del gasto real.
///
/// La UI y el informe lo reciben a través de `SettingsView::model`, que lo lee de acá.
pub const MODEL: &str = "nova-3";

/// Tope de espera del pedido.
///
/// Sin esto, una conexión que se corta a mitad de camino deja el dictado colgado
/// en "Transcribiendo" para siempre. Un minuto es holgado: un clip de dictado se
/// transcribe en segundos.
const TIMEOUT: Duration = Duration::from_secs(60);

// La respuesta trae mucho más (tiempos por palabra, confianza, metadatos); acá
// sólo se declara lo que se usa y serde ignora el resto.
#[derive(Deserialize)]
struct Response {
    results: Option<Results>,
}

#[derive(Deserialize)]
struct Results {
    channels: Vec<Channel>,
}

#[derive(Deserialize)]
struct Channel {
    alternatives: Vec<Alternative>,
}

#[derive(Deserialize)]
struct Alternative {
    transcript: String,
}

/// Audio a texto.
///
/// Devuelve la cadena vacía cuando el audio no tenía voz: Deepgram no inventa
/// nada ante el silencio, simplemente no transcribe. Quien llama decide qué
/// hacer con eso.
pub async fn transcribe(
    app: &AppHandle,
    audio: Vec<u8>,
    mime: &str,
    language: &str,
    keywords: &[String],
) -> Result<String, String> {
    let key = crate::keys::deepgram(app).ok_or_else(|| {
        let place = app
            .path()
            .app_config_dir()
            .map(|dir| dir.join(".env").display().to_string())
            .unwrap_or_else(|_| ".env".to_string());
        format!(
            "Falta la credencial de Deepgram. Poné {}=... en {}",
            crate::keys::DEEPGRAM_ENV,
            place
        )
    })?;

    if audio.is_empty() {
        return Err("El audio llegó vacío.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("no se pudo preparar el cliente HTTP: {e}"))?;

    // Sin `smart_format` a propósito: convierte números y ordinales a cifras sin
    // mirar el contexto ("primero hace una cosa" salía "1º hace una cosa"). Esa
    // decisión la toma el formateo de `polish.rs`, que sí ve la frase entera.
    let mut query: Vec<(&str, &str)> = vec![("model", MODEL), ("punctuate", "true")];
    if !language.is_empty() {
        query.push(("language", language));
    }
    for keyword in keywords.iter().take(100) {
        if !keyword.trim().is_empty() {
            query.push(("keyterm", keyword));
        }
    }

    let response = client
        .post(ENDPOINT)
        .query(&query)
        .header("Authorization", format!("Token {key}"))
        .header("Content-Type", if mime.is_empty() { "audio/webm" } else { mime })
        .body(audio)
        .send()
        .await
        .map_err(describe_network_error)?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("no se pudo leer la respuesta de Deepgram: {e}"))?;

    if !status.is_success() {
        return Err(describe_http_error(status.as_u16(), &body));
    }

    let parsed: Response = serde_json::from_str(&body)
        .map_err(|e| format!("Deepgram devolvió algo inesperado: {e}"))?;

    let transcript = parsed
        .results
        .and_then(|results| results.channels.into_iter().next())
        .and_then(|channel| channel.alternatives.into_iter().next())
        .map(|alternative| alternative.transcript)
        .unwrap_or_default();

    Ok(transcript.trim().to_string())
}

fn describe_network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "La transcripción tardó demasiado. Revisá la conexión.".to_string();
    }
    format!("Sin conexión con Deepgram. Revisá internet, el firewall o el proxy. Detalle: {error}")
}

fn describe_http_error(status: u16, body: &str) -> String {
    let detail = error_message(body);

    match status {
        400 => format!(
            "Deepgram rechazó el audio. {}",
            detail.unwrap_or_else(|| "Puede ser un formato que no acepta.".to_string())
        ),
        401 | 403 => "Credencial de Deepgram inválida o sin permisos. Revisala en console.deepgram.com.".to_string(),
        402 => "La cuenta de Deepgram se quedó sin crédito.".to_string(),
        413 => "El audio es demasiado largo para la API. Dictá en tramos más cortos.".to_string(),
        429 => "Deepgram rechazó el pedido por límite de uso. Esperá unos segundos.".to_string(),
        500..=599 => "Deepgram tuvo un error interno. Volvé a intentar en un momento.".to_string(),
        other => format!(
            "Deepgram rechazó el pedido (HTTP {other}). {}",
            detail.unwrap_or_default()
        ),
    }
}

/// Saca el mensaje de error del cuerpo, que puede venir en JSON o en texto.
fn error_message(body: &str) -> Option<String> {
    if body.is_empty() {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(body).ok()?;
    let message = parsed
        .get("err_msg")
        .or_else(|| parsed.get("message"))
        .or_else(|| parsed.get("error"))?
        .as_str()?;
    Some(message.to_string())
}
