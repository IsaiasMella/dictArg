//! De dónde salen las credenciales de los proveedores.
//!
//! Orden de búsqueda, siempre el mismo:
//!
//! 1. **Variable de entorno** — `DEEPGRAM_API_KEY` y `GROQ_API_KEY`. En
//!    desarrollo las carga `.env` al arrancar (ver `lib.rs`).
//! 2. **Llavero del sistema** — lo que el usuario haya guardado desde la app.
//!
//! Nunca hay una credencial escrita en el código, y ninguna de las dos llega al
//! webview: los pedidos salen desde Rust.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub const DEEPGRAM_ENV: &str = "DEEPGRAM_API_KEY";
pub const GROQ_ENV: &str = "GROQ_API_KEY";

/// Cuenta en el llavero del sistema, una por proveedor.
pub const DEEPGRAM_ACCOUNT: &str = "deepgram-api-key";
pub const GROQ_ACCOUNT: &str = "groq-api-key";

/// Cuál de los dos proveedores, para los comandos que la interfaz llama por nombre.
///
/// Es un enum y no un `&str` suelto para que un typo del lado de TypeScript sea un
/// error de deserialización acá y no una credencial guardada en una cuenta del
/// llavero que después nadie lee. Que es, exactamente, lo que pasaba: la interfaz
/// escribía siempre en la cuenta de Groq porque el nombre estaba clavado en el
/// código, y la de Deepgram —la única indispensable— no la escribía nadie.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Deepgram,
    Groq,
}

impl Provider {
    pub fn account(self) -> &'static str {
        match self {
            Provider::Deepgram => DEEPGRAM_ACCOUNT,
            Provider::Groq => GROQ_ACCOUNT,
        }
    }

    pub fn env(self) -> &'static str {
        match self {
            Provider::Deepgram => DEEPGRAM_ENV,
            Provider::Groq => GROQ_ENV,
        }
    }
}

fn from_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// La credencial de un proveedor, buscada en el orden de siempre.
pub fn of(app: &AppHandle, provider: Provider) -> Option<String> {
    from_env(provider.env()).or_else(|| crate::secret::read_account(app, provider.account()))
}

/// La key con la que se transcribe. Sin ésta no hay dictado.
pub fn deepgram(app: &AppHandle) -> Option<String> {
    of(app, Provider::Deepgram)
}

/// La key con la que se formatea. Sin ésta el dictado igual funciona: el texto
/// se pega tal cual salió de la transcripción.
pub fn groq(app: &AppHandle) -> Option<String> {
    of(app, Provider::Groq)
}
