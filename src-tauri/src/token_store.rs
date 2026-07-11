//! Credential store with DPAPI encryption on Windows, ported from
//! `src/main/tokenStore.js`. The on-disk format markers and legacy migration
//! come from `siphon_core::token`; the cipher itself is here because
//! `CryptProtectData`/`CryptUnprotectData` are Windows-only.

use std::path::PathBuf;

use serde_json::Value;
use siphon_core::json_store::{config_dir, set_owner_only};
use siphon_core::token::{
    Cipher, Credentials, PlaintextCipher, MARKER_DPAPI, MARKER_LEGACY, MARKER_PLAIN,
};

pub struct TokenStore {
    path: PathBuf,
    cipher: Box<dyn Cipher + Send + Sync>,
}

impl TokenStore {
    pub fn new() -> Self {
        TokenStore {
            path: config_dir().join("credentials.json"),
            cipher: default_cipher(),
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
        let json = self.cipher.decrypt(&buf)?;
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
        let buf = self.cipher.encrypt(&json)?;
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

fn default_cipher() -> Box<dyn Cipher + Send + Sync> {
    #[cfg(windows)]
    {
        Box::new(dpapi::DpapiCipher)
    }
    #[cfg(not(windows))]
    {
        Box::new(PlaintextCipher)
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
mod dpapi {
    //! Thin wrapper over DPAPI. Encrypts with `CryptProtectData` (per-user), the
    //! same protection Electron's `safeStorage` used. If DPAPI is unavailable we
    //! fall back to the plaintext marker, matching `SafeStorageCrypto`.

    use siphon_core::token::{Cipher, MARKER_DPAPI, MARKER_PLAIN};
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    pub struct DpapiCipher;

    impl Cipher for DpapiCipher {
        fn encrypt(&self, json: &str) -> std::io::Result<Vec<u8>> {
            match protect(json.as_bytes()) {
                Ok(cipher) => {
                    let mut out = Vec::with_capacity(cipher.len() + 1);
                    out.push(MARKER_DPAPI);
                    out.extend_from_slice(&cipher);
                    Ok(out)
                }
                Err(_) => {
                    // DPAPI unavailable — store as plaintext, like the JS fallback.
                    let mut out = Vec::with_capacity(json.len() + 1);
                    out.push(MARKER_PLAIN);
                    out.extend_from_slice(json.as_bytes());
                    Ok(out)
                }
            }
        }

        fn decrypt(&self, buf: &[u8]) -> std::io::Result<String> {
            if buf[0] == MARKER_PLAIN {
                return Ok(String::from_utf8_lossy(&buf[1..]).into_owned());
            }
            let plain = unprotect(&buf[1..])
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            Ok(String::from_utf8_lossy(&plain).into_owned())
        }
    }

    fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut input = CRYPT_INTEGER_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB::default();
            CryptProtectData(&mut input, None, None, None, None, 0, &mut output)
                .map_err(|e| e.to_string())?;
            let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            let _ = LocalFree(HLOCAL(output.pbData as *mut _));
            Ok(out)
        }
    }

    fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut input = CRYPT_INTEGER_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB::default();
            CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
                .map_err(|e| e.to_string())?;
            let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            let _ = LocalFree(HLOCAL(output.pbData as *mut _));
            Ok(out)
        }
    }
}

// Keep the import used on all platforms.
#[cfg(not(windows))]
#[allow(unused_imports)]
use siphon_core::token::PlaintextCipher as _PlaintextCipher;
