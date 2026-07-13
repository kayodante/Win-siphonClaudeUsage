//! The small subset of `src/shared/i18n.js` the native side needs: tray labels,
//! quota suffixes, and the reset/expire/alert notification strings. The renderer
//! keeps the full dictionary in JS; this is only what the Rust process renders
//! itself (tooltips + toasts).

/// `t(key, lang)` — looks up `lang`, falls back to `en`, then to the key.
pub fn t(key: &str, lang: &str) -> String {
    let table = if lang == "pt-BR" { PT } else { EN };
    lookup(table, key)
        .or_else(|| lookup(EN, key))
        .unwrap_or(key)
        .to_string()
}

fn lookup(table: &[(&'static str, &'static str)], key: &str) -> Option<&'static str> {
    table.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

const EN: &[(&str, &str)] = &[
    ("tray.session", "Session"),
    ("tray.weekly", "Weekly"),
    ("tray.sessionReset", "Session reset"),
    ("tray.updated", "Updated"),
    ("tray.showApp", "Show app"),
    ("tray.widget", "Floating widget"),
    ("tray.settings", "Settings"),
    ("tray.restart", "Restart"),
    ("tray.quit", "Quit"),
    ("quota.suffix.used", "used"),
    ("quota.suffix.remaining", "left"),
    ("notification.resetTitle", "Claude session reset"),
    (
        "notification.resetBody",
        "Your Claude session limit should be available again.",
    ),
    ("notification.expireTitle", "Session expired"),
    (
        "notification.expireBody",
        "Your Claude session has reached its limit.",
    ),
    ("alert.highUsage.title", "High usage"),
    ("alert.highUsage.body", "Session has reached 70%."),
    ("alert.critical.title", "Critical usage"),
    ("alert.critical.body", "Session has reached 90%."),
];

const PT: &[(&str, &str)] = &[
    ("tray.session", "Sessão"),
    ("tray.weekly", "Semanal"),
    ("tray.sessionReset", "Reset da sessão"),
    ("tray.updated", "Atualizado"),
    ("tray.showApp", "Mostrar aplicativo"),
    ("tray.widget", "Widget flutuante"),
    ("tray.settings", "Configurações"),
    ("tray.restart", "Reiniciar"),
    ("tray.quit", "Sair"),
    ("quota.suffix.used", "usado"),
    ("quota.suffix.remaining", "restante"),
    ("notification.resetTitle", "Sessão do Claude reiniciada"),
    (
        "notification.resetBody",
        "Seu limite de sessão do Claude deve estar disponível novamente.",
    ),
    ("notification.expireTitle", "Sessão expirada"),
    (
        "notification.expireBody",
        "Sua sessão do Claude atingiu o limite.",
    ),
    ("alert.highUsage.title", "Uso elevado"),
    ("alert.highUsage.body", "Sessão atingiu 70%."),
    ("alert.critical.title", "Uso crítico"),
    ("alert.critical.body", "Sessão atingiu 90%."),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_menu_actions_are_localized() {
        assert_eq!(t("tray.showApp", "en"), "Show app");
        assert_eq!(t("tray.showApp", "pt-BR"), "Mostrar aplicativo");
        assert_eq!(t("tray.widget", "en"), "Floating widget");
        assert_eq!(t("tray.widget", "pt-BR"), "Widget flutuante");
        assert_eq!(t("tray.settings", "en"), "Settings");
        assert_eq!(t("tray.settings", "pt-BR"), "Configurações");
        assert_eq!(t("tray.restart", "en"), "Restart");
        assert_eq!(t("tray.restart", "pt-BR"), "Reiniciar");
        assert_eq!(t("tray.quit", "en"), "Quit");
        assert_eq!(t("tray.quit", "pt-BR"), "Sair");
    }

    #[test]
    fn resolves_lang_and_fallback() {
        assert_eq!(t("tray.session", "en"), "Session");
        assert_eq!(t("tray.session", "pt-BR"), "Sessão");
        // Unknown lang falls back to en.
        assert_eq!(t("tray.weekly", "fr"), "Weekly");
        // Unknown key returns the key itself.
        assert_eq!(t("does.not.exist", "en"), "does.not.exist");
    }
}
