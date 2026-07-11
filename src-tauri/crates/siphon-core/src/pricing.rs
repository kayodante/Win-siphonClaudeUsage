//! Port of the pricing half of `src/main/localDataService.js`: the bundled
//! fallback table, `pricingKey`, `findPrice`, `tokenCost` and `roundCost`.

use serde_json::Value;

#[derive(Debug, Clone, Copy, Default)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Tokens {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

/// Bundled fallback pricing (USD per million tokens) used when
/// `readout-pricing.json` is absent. Keys match `pricing_key` output.
/// Verified against platform.claude.com/docs (2026-07-06).
pub const BUNDLED_PRICING: &[(&str, Price)] = &[
    (
        "fable-5",
        Price {
            input: 10.0,
            output: 50.0,
            cache_read: 1.00,
            cache_write: 12.50,
        },
    ),
    (
        "opus-4-8",
        Price {
            input: 5.0,
            output: 25.0,
            cache_read: 0.50,
            cache_write: 6.25,
        },
    ),
    (
        "opus-4-7",
        Price {
            input: 5.0,
            output: 25.0,
            cache_read: 0.50,
            cache_write: 6.25,
        },
    ),
    (
        "opus-4-6",
        Price {
            input: 5.0,
            output: 25.0,
            cache_read: 0.50,
            cache_write: 6.25,
        },
    ),
    (
        "opus-4-5",
        Price {
            input: 5.0,
            output: 25.0,
            cache_read: 0.50,
            cache_write: 6.25,
        },
    ),
    (
        "opus-4-1",
        Price {
            input: 15.0,
            output: 75.0,
            cache_read: 1.50,
            cache_write: 18.75,
        },
    ),
    (
        "opus-4",
        Price {
            input: 15.0,
            output: 75.0,
            cache_read: 1.50,
            cache_write: 18.75,
        },
    ),
    (
        "sonnet-5",
        Price {
            input: 3.0,
            output: 15.0,
            cache_read: 0.30,
            cache_write: 3.75,
        },
    ),
    (
        "sonnet-4-6",
        Price {
            input: 3.0,
            output: 15.0,
            cache_read: 0.30,
            cache_write: 3.75,
        },
    ),
    (
        "sonnet-4-5",
        Price {
            input: 3.0,
            output: 15.0,
            cache_read: 0.30,
            cache_write: 3.75,
        },
    ),
    (
        "sonnet-4",
        Price {
            input: 3.0,
            output: 15.0,
            cache_read: 0.30,
            cache_write: 3.75,
        },
    ),
    (
        "haiku-4-5",
        Price {
            input: 1.0,
            output: 5.0,
            cache_read: 0.10,
            cache_write: 1.25,
        },
    ),
    (
        "haiku-4",
        Price {
            input: 0.25,
            output: 1.25,
            cache_read: 0.03,
            cache_write: 0.30,
        },
    ),
];

/// `pricingKey`: lowercase, strip a leading `claude-` and a trailing 8-digit
/// date suffix.
pub fn pricing_key(model: &str) -> String {
    let lower = model.to_ascii_lowercase();
    let stripped = lower.strip_prefix("claude-").unwrap_or(&lower);
    strip_date_suffix(stripped)
}

fn strip_date_suffix(s: &str) -> String {
    // Remove a trailing `-YYYYMMDD` (8 digits) if present.
    if let Some(idx) = s.rfind('-') {
        let suffix = &s[idx + 1..];
        if suffix.len() == 8 && suffix.bytes().all(|b| b.is_ascii_digit()) {
            return s[..idx].to_string();
        }
    }
    s.to_string()
}

/// Short display name for a model. Matches `shortName`.
pub fn short_name(model: &str) -> String {
    let key = pricing_key(model);
    if key.contains("opus") {
        "Opus".to_string()
    } else if key.contains("sonnet") {
        "Sonnet".to_string()
    } else if key.contains("haiku") {
        "Haiku".to_string()
    } else {
        key
    }
}

/// Resolve a price for `model`, checking a user pricing file first (if provided)
/// then the bundled table. Mirrors `findPrice`'s key fallbacks.
pub fn find_price(pricing_file: Option<&Value>, model: &str) -> Option<Price> {
    let normalized = pricing_key(model);
    if let Some(file) = pricing_file {
        if let Some(models) = file.get("models").and_then(|m| m.as_object()) {
            for candidate in [
                normalized.clone(),
                format!("claude-{normalized}"),
                model.to_string(),
                model.to_ascii_lowercase(),
            ] {
                if let Some(entry) = models.get(&candidate) {
                    return Some(price_from_value(entry));
                }
            }
        }
    }
    BUNDLED_PRICING
        .iter()
        .find(|(k, _)| *k == normalized)
        .map(|(_, p)| *p)
}

fn price_from_value(v: &Value) -> Price {
    let num = |keys: &[&str]| -> f64 {
        for k in keys {
            if let Some(n) = v.get(*k).and_then(|x| x.as_f64()) {
                return n;
            }
        }
        0.0
    };
    Price {
        input: num(&["input"]),
        output: num(&["output"]),
        cache_read: num(&["cacheRead", "cache_read"]),
        cache_write: num(&["cacheWrite", "cache_write"]),
    }
}

/// `tokenCost`: dollars for `tokens` at `price`, rounded like `roundCost`.
pub fn token_cost(tokens: Tokens, price: Price) -> f64 {
    let million = 1_000_000.0;
    round_cost(
        (tokens.input / million) * price.input
            + (tokens.output / million) * price.output
            + (tokens.cache_read / million) * price.cache_read
            + (tokens.cache_write / million) * price.cache_write,
    )
}

/// `roundCost`: round to 8 decimal places.
pub fn round_cost(value: f64) -> f64 {
    (value * 100_000_000.0).round() / 100_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pricing_key_strips_prefix_and_date() {
        assert_eq!(pricing_key("claude-opus-4-8-20260101"), "opus-4-8");
        assert_eq!(pricing_key("claude-sonnet-5"), "sonnet-5");
        assert_eq!(pricing_key("Opus-4"), "opus-4");
    }

    #[test]
    fn short_names() {
        assert_eq!(short_name("claude-opus-4-8"), "Opus");
        assert_eq!(short_name("claude-sonnet-5"), "Sonnet");
        assert_eq!(short_name("claude-haiku-4-5"), "Haiku");
    }

    #[test]
    fn bundled_price_lookup() {
        let p = find_price(None, "claude-opus-4-8-20260101").unwrap();
        assert_eq!(p.input, 5.0);
        assert_eq!(p.output, 25.0);
    }

    #[test]
    fn cost_math() {
        let p = Price {
            input: 5.0,
            output: 25.0,
            cache_read: 0.5,
            cache_write: 6.25,
        };
        let t = Tokens {
            input: 1_000_000.0,
            output: 1_000_000.0,
            cache_read: 0.0,
            cache_write: 0.0,
        };
        assert_eq!(token_cost(t, p), 30.0);
    }
}
