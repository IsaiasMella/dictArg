//! Cifrado del archivo de credenciales en Windows, con DPAPI.
//!
//! Este archivo sólo existe para el caso en que **no hay llavero disponible**
//! (`secret.rs` cae a `credentials.json`). En Windows ese caso es raro, pero cuando
//! ocurría la credencial quedaba en texto plano: los permisos `0600` de `secret.rs`
//! están bajo `#[cfg(unix)]`, así que en la plataforma principal del producto no se
//! aplicaba ninguno y el archivo heredaba los del directorio.
//!
//! `CryptProtectData` ata el cifrado a la cuenta de usuario de Windows: otro usuario
//! de la misma máquina no puede descifrarlo, y una copia del archivo llevada a otra
//! computadora tampoco sirve. No protege contra código corriendo como ese mismo
//! usuario —nada del lado del cliente puede— pero sí contra los casos que importan:
//! el zip, el backup y la copia del directorio.

/// Marca al principio del archivo cifrado.
///
/// Permite distinguir un `credentials.json` viejo, en texto plano, de uno cifrado, y
/// migrar el primero sin que el usuario tenga que volver a pegar su credencial.
const MAGIC: &[u8] = b"VOICEDPAPI1\n";

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CryptProtectData, CryptUnprotectData,
    };

    /// Envuelve un blob devuelto por DPAPI para liberarlo pase lo que pase.
    struct Blob(CRYPT_INTEGER_BLOB);

    impl Blob {
        fn bytes(&self) -> Vec<u8> {
            if self.0.pbData.is_null() {
                return Vec::new();
            }
            unsafe { std::slice::from_raw_parts(self.0.pbData, self.0.cbData as usize) }.to_vec()
        }
    }

    impl Drop for Blob {
        fn drop(&mut self) {
            if !self.0.pbData.is_null() {
                unsafe {
                    let _ = LocalFree(Some(HLOCAL(self.0.pbData as *mut _)));
                }
            }
        }
    }

    fn entrada(datos: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: datos.len() as u32,
            pbData: datos.as_ptr() as *mut u8,
        }
    }

    pub fn proteger(claro: &[u8]) -> Result<Vec<u8>, String> {
        let mut salida = Blob(CRYPT_INTEGER_BLOB::default());
        unsafe {
            CryptProtectData(
                &entrada(claro),
                None,
                None,
                None,
                None,
                0,
                &mut salida.0,
            )
        }
        .map_err(|e| format!("CryptProtectData falló: {e}"))?;

        Ok(salida.bytes())
    }

    pub fn desproteger(cifrado: &[u8]) -> Result<Vec<u8>, String> {
        let mut salida = Blob(CRYPT_INTEGER_BLOB::default());
        unsafe {
            CryptUnprotectData(
                &entrada(cifrado),
                None,
                None,
                None,
                None,
                0,
                &mut salida.0,
            )
        }
        .map_err(|e| format!("CryptUnprotectData falló: {e}"))?;

        Ok(salida.bytes())
    }
}

/// Fuera de Windows no hay DPAPI: la protección la dan los permisos `0600` de Unix,
/// que `secret.rs` ya aplica.
#[cfg(not(windows))]
mod imp {
    pub fn proteger(_claro: &[u8]) -> Result<Vec<u8>, String> {
        Err("DPAPI sólo existe en Windows".to_string())
    }

    pub fn desproteger(_cifrado: &[u8]) -> Result<Vec<u8>, String> {
        Err("DPAPI sólo existe en Windows".to_string())
    }
}

/// Cifra el contenido del archivo de credenciales, si la plataforma puede.
///
/// Devuelve `None` cuando no hay DPAPI —cualquier sistema que no sea Windows— para
/// que el llamador escriba en claro y confíe en los permisos del archivo.
pub fn cifrar(claro: &str) -> Option<Vec<u8>> {
    if !cfg!(windows) {
        return None;
    }

    match imp::proteger(claro.as_bytes()) {
        Ok(cifrado) => {
            let mut salida = MAGIC.to_vec();
            salida.extend_from_slice(&cifrado);
            Some(salida)
        }
        Err(e) => {
            // No es fatal: se cae a texto plano, que es como estaba antes. Peor sería
            // no poder guardar la credencial.
            eprintln!("[dictarg] no se pudo cifrar credentials.json, queda en claro: {e}");
            None
        }
    }
}

/// Descifra lo leído del archivo.
///
/// Un archivo sin la marca es uno viejo, en texto plano: se devuelve tal cual, así
/// una instalación que ya venía funcionando no pierde su credencial al actualizar.
pub fn descifrar(bruto: &[u8]) -> Option<String> {
    let Some(cifrado) = bruto.strip_prefix(MAGIC) else {
        return String::from_utf8(bruto.to_vec()).ok();
    };

    match imp::desproteger(cifrado) {
        Ok(claro) => String::from_utf8(claro).ok(),
        Err(e) => {
            eprintln!("[dictarg] no se pudo descifrar credentials.json: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_archivo_viejo_en_texto_plano_se_sigue_leyendo() {
        // Una instalación con el archivo viejo lo migra sin perder la credencial.
        let viejo = br#"{"groq-api-key":"secreto"}"#;
        assert_eq!(descifrar(viejo).as_deref(), Some(r#"{"groq-api-key":"secreto"}"#));
    }

    #[test]
    fn lo_cifrado_no_contiene_el_texto_en_claro() {
        let Some(cifrado) = cifrar(r#"{"deepgram-api-key":"abc123"}"#) else {
            // Sin DPAPI no hay nada que verificar acá.
            return;
        };

        assert!(cifrado.starts_with(MAGIC));
        let como_texto = String::from_utf8_lossy(&cifrado);
        assert!(!como_texto.contains("abc123"), "la credencial quedó legible");
    }

    #[test]
    fn ida_y_vuelta() {
        let original = r#"{"deepgram-api-key":"abc123","groq-api-key":"def456"}"#;
        let Some(cifrado) = cifrar(original) else { return };
        assert_eq!(descifrar(&cifrado).as_deref(), Some(original));
    }

    #[test]
    fn un_cifrado_corrupto_no_hace_pánico() {
        let mut roto = MAGIC.to_vec();
        roto.extend_from_slice(b"esto no es un blob de DPAPI");
        assert_eq!(descifrar(&roto), None);
    }
}
