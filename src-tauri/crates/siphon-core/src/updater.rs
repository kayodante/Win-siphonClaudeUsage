//! Pure parts of `src/main/updateService.js`: semver comparison and turning a
//! GitHub "latest release" payload into an `UpdateInfo`. The download, checksum
//! verification and winget spawn live in the binary crate.

use serde_json::Value;

pub const REPO: &str = "kayodante/Win-siphonClaudeUsage";
pub const WINGET_ID: &str = "kayodante.Siphon";

/// Everything the renderer needs to offer an update. Matches the object returned
/// by `checkForUpdate`.
#[derive(Debug, Clone, PartialEq)]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
    pub download_url: Option<String>,
    pub checksum_url: Option<String>,
}

fn semver(v: &str) -> (u64, u64, u64) {
    let v = v.strip_prefix('v').unwrap_or(v);
    let mut parts = v.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

/// `isNewer(tag, current)` — true when `tag` > `current` by semver.
pub fn is_newer(tag: &str, current: &str) -> bool {
    semver(tag) > semver(current)
}

/// Parse a GitHub release payload into `UpdateInfo` when it is a newer,
/// non-draft, non-prerelease build. Mirrors the asset-selection in
/// `checkForUpdate` (the `.exe` asset that is not the Portable one, plus its
/// `.sha256` sibling).
pub fn parse_release(release: &Value, current_version: &str) -> Option<UpdateInfo> {
    if release.get("draft").and_then(|v| v.as_bool()) == Some(true)
        || release.get("prerelease").and_then(|v| v.as_bool()) == Some(true)
    {
        return None;
    }
    let tag = release.get("tag_name").and_then(|v| v.as_str())?;
    if !is_newer(tag, current_version) {
        return None;
    }
    let assets = release.get("assets").and_then(|v| v.as_array());
    let asset = assets.and_then(|a| {
        a.iter().find(|asset| {
            let name = asset.get("name").and_then(|v| v.as_str()).unwrap_or("");
            name.ends_with(".exe") && !name.contains("Portable")
        })
    });
    let download_url = asset
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let checksum_url = match (asset, assets) {
        (Some(a), Some(list)) => {
            let asset_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let checksum_name = format!("{asset_name}.sha256");
            list.iter()
                .find(|x| x.get("name").and_then(|v| v.as_str()) == Some(checksum_name.as_str()))
                .and_then(|x| x.get("browser_download_url"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        }
        _ => None,
    };

    Some(UpdateInfo {
        version: tag.strip_prefix('v').unwrap_or(tag).to_string(),
        url: format!("https://github.com/{REPO}/releases/latest"),
        download_url,
        checksum_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn semver_comparison() {
        assert!(is_newer("1.6.1", "1.6.0"));
        assert!(is_newer("v2.0.0", "1.9.9"));
        assert!(!is_newer("1.6.0", "1.6.0"));
        assert!(!is_newer("1.5.0", "1.6.0"));
    }

    #[test]
    fn picks_installer_asset_and_checksum() {
        let release = json!({
            "tag_name": "v1.7.0",
            "assets": [
                { "name": "Siphon.Setup.1.7.0.exe", "browser_download_url": "https://github.com/x/Siphon.Setup.1.7.0.exe" },
                { "name": "Siphon.Setup.1.7.0.exe.sha256", "browser_download_url": "https://github.com/x/Siphon.Setup.1.7.0.exe.sha256" },
                { "name": "Siphon-Portable-1.7.0.exe", "browser_download_url": "https://github.com/x/portable.exe" }
            ]
        });
        let info = parse_release(&release, "1.6.0").unwrap();
        assert_eq!(info.version, "1.7.0");
        assert!(info
            .download_url
            .unwrap()
            .ends_with("Siphon.Setup.1.7.0.exe"));
        assert!(info.checksum_url.unwrap().ends_with(".sha256"));
    }

    #[test]
    fn ignores_drafts_and_older() {
        assert!(parse_release(&json!({ "tag_name": "v2.0.0", "draft": true }), "1.0.0").is_none());
        assert!(parse_release(&json!({ "tag_name": "v1.0.0" }), "1.6.0").is_none());
    }
}
