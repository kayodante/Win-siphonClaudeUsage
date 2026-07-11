//! Port of `src/main/security.js` plus the updater host allow-list from
//! `main.js`. Pure URL validation, no I/O.

/// Hosts we will open in the user's browser via `shell:open-external`.
const TRUSTED_EXTERNAL_HOSTS: &[&str] = &["claude.ai", "github.com"];

/// Hosts we will download an installer from (`update:download`).
pub const TRUSTED_DOWNLOAD_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "github-releases.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

fn host_of(url: &str) -> Option<(String, String)> {
    // Returns (scheme, host) for a well-formed absolute URL. Deliberately small;
    // we only need scheme + host, not a full URL parser.
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // Strip userinfo and port.
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host);
    if host.is_empty() {
        return None;
    }
    Some((scheme.to_ascii_lowercase(), host.to_ascii_lowercase()))
}

/// Matches `isSafeExternalUrl`: https + host in the external allow-list.
pub fn is_safe_external_url(url: &str) -> bool {
    match host_of(url) {
        Some((scheme, host)) => {
            scheme == "https" && TRUSTED_EXTERNAL_HOSTS.contains(&host.as_str())
        }
        None => false,
    }
}

/// Matches the `isTrustedHost` check in `registerUpdateIpc`.
pub fn is_trusted_download_url(url: &str) -> bool {
    match host_of(url) {
        Some((scheme, host)) => {
            scheme == "https" && TRUSTED_DOWNLOAD_HOSTS.contains(&host.as_str())
        }
        None => false,
    }
}

/// A version string is only accepted if it is exactly `d.d.d` (matches the
/// `/^\d+\.\d+\.\d+$/` guard before a download is allowed).
pub fn is_valid_version(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_urls() {
        assert!(is_safe_external_url("https://claude.ai/settings/usage"));
        assert!(is_safe_external_url("https://github.com/x/y"));
        assert!(!is_safe_external_url("http://claude.ai"));
        assert!(!is_safe_external_url("https://evil.com"));
        assert!(!is_safe_external_url("not a url"));
        assert!(!is_safe_external_url("https://claude.ai.evil.com"));
    }

    #[test]
    fn download_urls() {
        assert!(is_trusted_download_url(
            "https://objects.githubusercontent.com/a/b"
        ));
        assert!(!is_trusted_download_url("https://cdn.example.com/x"));
        assert!(!is_trusted_download_url("http://github.com/x"));
    }

    #[test]
    fn versions() {
        assert!(is_valid_version("1.6.0"));
        assert!(is_valid_version("10.20.30"));
        assert!(!is_valid_version("1.6"));
        assert!(!is_valid_version("1.6.0-beta"));
        assert!(!is_valid_version("v1.6.0"));
    }
}
