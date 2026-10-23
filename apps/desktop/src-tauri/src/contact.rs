//! Los links de contacto de la pantalla de Ayuda.
//!
//! Se abren desde Rust con el navegador del sistema. El webview no tiene permiso
//! para abrir URLs: sólo puede pedir uno de estos destinos por nombre, así que un
//! script inyectado en la interfaz no podría mandar a la persona a cualquier lado.

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Los Issues del repositorio.
const ISSUES_URL: &str = "https://github.com/IsaiasMella/dictArg/issues";

/// El LinkedIn del autor.
const LINKEDIN_URL: &str = "https://www.linkedin.com/in/isaias-mella/";

/// Cuál de los links. Tiene que coincidir con `ContactLink` en `bridge.ts`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Link {
    Issues,
    Linkedin,
}

impl Link {
    /// La URL a abrir. Mientras siga un placeholder, avisa en vez de abrir algo que
    /// no es una URL.
    fn url(self) -> Result<&'static str, String> {
        let url = match self {
            Link::Issues => ISSUES_URL,
            Link::Linkedin => LINKEDIN_URL,
        };
        if !url.starts_with("https://") {
            return Err("Este link todavía no está configurado.".to_string());
        }
        Ok(url)
    }
}

#[tauri::command]
pub fn open_contact(app: AppHandle, link: Link) -> Result<(), String> {
    app.opener()
        .open_url(link.url()?, None::<&str>)
        .map_err(|e| format!("No se pudo abrir el navegador: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linkedin_abre_el_perfil() {
        assert_eq!(Link::Linkedin.url(), Ok("https://www.linkedin.com/in/isaias-mella/"));
    }

    #[test]
    fn github_abre_los_issues_del_repo() {
        assert_eq!(Link::Issues.url(), Ok("https://github.com/IsaiasMella/dictArg/issues"));
    }

    #[test]
    fn los_dos_links_son_https() {
        for link in [Link::Issues, Link::Linkedin] {
            assert!(link.url().is_ok_and(|url| url.starts_with("https://")), "{link:?}");
        }
    }
}
