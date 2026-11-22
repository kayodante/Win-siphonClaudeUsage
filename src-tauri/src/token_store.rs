//! Credential store with DPAPI encryption on Windows, ported from
//! `src/main/tokenStore.js`. The on-disk format markers and legacy migration
//! come from `siphon_core::token`; the cipher itself is here because
//! `CryptProtectData`/`CryptUnprotectData` are Windows-only.

use std::path::PathBuf;

use serde_json::Value;
use siphon_core::json_store::{config_dir, set_owner_only};
use siphon_core::token::{
    decode_plaintext, encode_plaintext, Credentials, MARKER_DPAPI, MARKER_LEGACY, MARKER_PLAIN,
};

pub struct TokenStore {
    path: PathBuf,
}

impl TokenStore {
    pub fn new() -> Self {
        TokenStore {
            path: config_dir().join("credentials.json"),
        }
    }

    /// Load credentials, migrating a legacy plaintext-JSON file on first read
    /// (marker `0x7b` = '{'). Matches `TokenStore.load`.
    pub fn load(&self) -> std::io::Result<Option<Credentials>> {
        let buf = match std::fs::read(&self.path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        if buf.is_empty() {
            return Ok(None);
        }
        if buf[0] == MARKER_LEGACY {
            // Legacy plaintext JSON — parse, then re-save in the current format.
            let creds: Credentials = match serde_json::from_slice(&buf) {
                Ok(c) => c,
                Err(_) => return Ok(None),
            };
            let _ = self.save(&creds); // best-effort migration
            return Ok(Some(creds));
        }
        if buf[0] != MARKER_DPAPI && buf[0] != MARKER_PLAIN {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("tokenStore: unknown format marker 0x{:02x}", buf[0]),
            ));
        }
        let json = decrypt(&buf)?;
        let creds = serde_json::from_str(&json)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        Ok(Some(creds))
    }

    /// Encrypt + write atomically (tmp + rename, mode 0600). Matches `save`.
    pub fn save(&self, credentials: &Credentials) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string(credentials)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let buf = encrypt(&json);
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, &buf)?;
        set_owner_only(&tmp)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    pub fn clear(&self) -> std::io::Result<()> {
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }
}

impl Default for TokenStore {
    fn default() -> Self {
        Self::new()
    }
}

/// Reading `~/.claude/.credentials.json` for the profile fallback (not encrypted;
/// this is Claude Code's own file).
pub fn read_claude_credentials() -> Option<Value> {
    let path = siphon_core::json_store::default_claude_dir().join(".credentials.json");
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

#[cfg(windows)]
fn encrypt(json: &str) -> Vec<u8> {
    match dpapi::protect(json.as_bytes()) {
        Ok(cipher) => {
            let mut out = Vec::with_capacity(cipher.len() + 1);
            out.push(MARKER_DPAPI);
            out.extend_from_slice(&cipher);
            out
        }
        Err(_) => encode_plaintext(json),
    }
}

#[cfg(not(windows))]
fn encrypt(json: &str) -> Vec<u8> {
    encode_plaintext(json)
}

#[cfg(windows)]
fn decrypt(buf: &[u8]) -> std::io::Result<String> {
    if buf[0] == MARKER_PLAIN {
        return Ok(decode_plaintext(buf));
    }
    let plain = dpapi::unprotect(&buf[1..])
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(String::from_utf8_lossy(&plain).into_owned())
}

#[cfg(not(windows))]
fn decrypt(buf: &[u8]) -> std::io::Result<String> {
    Ok(decode_plaintext(buf))
}

#[cfg(windows)]
mod dpapi {
    //! Thin wrapper over DPAPI (`CryptProtectData` per-user).

    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB::default();
            CryptProtectData(&input, None, None, None, None, 0, &mut output)
                .map_err(|e| e.to_string())?;
            let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
            Ok(out)
        }
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB::default();
            CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
                .map_err(|e| e.to_string())?;
            let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
            Ok(out)
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dpapi_protect_unprotect_roundtrip() {
        let original_json =
            r#"{"access_token":"sk-ant-test","expires_at":"2026-09-10T15:00:00.000Z"}"#;

        let encrypted = encrypt(original_json);
        assert_eq!(encrypted[0], MARKER_DPAPI, "Marker must be MARKER_DPAPI");
        assert_ne!(
            &encrypted[1..],
            original_json.as_bytes(),
            "Payload must be encrypted ciphertext"
        );

        let decrypted = decrypt(&encrypted).expect("DPAPI decryption must succeed");
        assert_eq!(
            decrypted, original_json,
            "Decrypted text must match original payload"
        );
    }
}
