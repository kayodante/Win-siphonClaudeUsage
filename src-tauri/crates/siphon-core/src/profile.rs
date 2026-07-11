//! Port of the pure parts of `src/main/profileService.js`: extracting a profile
//! from the API payload (with the `account` nesting fallback) and formatting the
//! local plan string from `~/.claude/.credentials.json`.

use serde_json::Value;

use crate::state::Profile;

/// Extract name/email/plan from the profile payload. Matches `extractProfile`.
pub fn extract_profile(payload: &Value) -> Profile {
    let account = payload.get("account").unwrap_or(payload);
    let s = |v: Option<&Value>| v.and_then(|x| x.as_str()).map(|x| x.to_string());

    let name = s(account.get("name"))
        .or_else(|| s(account.get("full_name")))
        .or_else(|| s(account.get("display_name")));
    let email = s(account.get("email"));
    let plan = s(payload.get("plan"))
        .or_else(|| s(payload.pointer("/subscription/tier")))
        .or_else(|| s(payload.pointer("/subscription/plan")))
        .or_else(|| s(account.get("plan")))
        .or_else(|| s(account.pointer("/subscription/tier")));

    Profile { name, email, plan }
}

/// Merge in local fallbacks for any missing field, matching `fetchProfile`'s
/// post-processing.
pub fn merge_local(mut profile: Profile, local: &Profile) -> Profile {
    if profile.plan.is_none() {
        profile.plan = local.plan.clone();
    }
    if profile.name.is_none() {
        profile.name = local.name.clone();
    }
    if profile.email.is_none() {
        profile.email = local.email.clone();
    }
    profile
}

/// Read `~/.claude/.credentials.json` for name/email/plan fallbacks. Matches
/// `readLocalProfile`.
pub fn read_local_profile(claude_credentials: &Value) -> Profile {
    let oauth = claude_credentials
        .get("claudeAiOauth")
        .cloned()
        .unwrap_or(Value::Null);
    let s = |obj: &Value, k: &str| obj.get(k).and_then(|v| v.as_str()).map(|v| v.to_string());
    Profile {
        name: s(&oauth, "accountName")
            .or_else(|| s(&oauth, "name"))
            .or_else(|| s(claude_credentials, "name")),
        email: s(&oauth, "accountEmail")
            .or_else(|| s(&oauth, "email"))
            .or_else(|| s(claude_credentials, "email")),
        plan: oauth
            .get("subscriptionType")
            .and_then(|v| v.as_str())
            .map(format_plan),
    }
}

/// `formatPlan`: strip a leading `claude_`, capitalize.
pub fn format_plan(plan_type: &str) -> String {
    let normalized = plan_type
        .to_ascii_lowercase()
        .strip_prefix("claude_")
        .map(|s| s.to_string())
        .unwrap_or_else(|| plan_type.to_ascii_lowercase());
    let mut chars = normalized.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_nested_account() {
        let payload = json!({
            "account": { "full_name": "Ada", "email": "ada@x.com" },
            "subscription": { "tier": "pro" }
        });
        let p = extract_profile(&payload);
        assert_eq!(p.name.as_deref(), Some("Ada"));
        assert_eq!(p.email.as_deref(), Some("ada@x.com"));
        assert_eq!(p.plan.as_deref(), Some("pro"));
    }

    #[test]
    fn reads_local_credentials() {
        let creds = json!({
            "claudeAiOauth": { "accountName": "Bob", "accountEmail": "b@x.com", "subscriptionType": "claude_max" }
        });
        let p = read_local_profile(&creds);
        assert_eq!(p.name.as_deref(), Some("Bob"));
        assert_eq!(p.plan.as_deref(), Some("Max"));
    }

    #[test]
    fn plan_formatting() {
        assert_eq!(format_plan("claude_pro"), "Pro");
        assert_eq!(format_plan("MAX"), "Max");
    }
}
