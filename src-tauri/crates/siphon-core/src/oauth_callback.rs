//! Parsing and classification for the loopback OAuth callback. Pure: the socket
//! lives in the binary crate (`src-tauri/src/oauth_server.rs`); this decides
//! what a request line means and what to write back to the browser.

use crate::oauth::url_decode;

/// Where the browser is sent once the code is captured. This is the page Claude
/// Code redirects to, which is why the `app=claude-code` marker stays — it is
/// what makes the page render the signed-in state.
pub const SUCCESS_URL: &str = "https://platform.claude.com/oauth/code/success?app=claude-code";

/// The only path the loopback listener answers.
pub const CALLBACK_PATH: &str = "/callback";

/// What a single request to the loopback listener turned out to be.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallbackOutcome {
    /// The authorization code, with `state` already verified.
    Code(String),
    /// `state` was absent or did not match the one this process generated.
    StateMismatch,
    /// The authorization server reported a failure instead of a code.
    Provider {
        error: String,
        description: Option<String>,
    },
    /// Right path, no usable `code` and no `error`.
    NoCode,
    /// Some other path — typically the browser asking for `/favicon.ico`.
    NotFound,
    /// Not a request line we can read.
    Malformed,
}

impl CallbackOutcome {
    /// Should an unauthenticated stranger be able to end this sign-in?
    ///
    /// This is a security control, not a parse-result convenience. While the
    /// listener is up it answers whoever connects, and the port is guessable:
    /// a web page can sweep the dynamic range in seconds with no-cors fetches.
    /// The same-origin policy stops such a page *reading* the reply, not
    /// *sending* the request. So only the outcomes that can plausibly come from
    /// the authorization server's own redirect end the accept loop — a `code`
    /// that matched the `state` this process generated, and a provider error.
    /// Everything else (wrong or missing `state`, no code, garbage, an
    /// unrelated path) is answered with the fixed reply and ignored, so a probe
    /// cannot close the socket out from under the browser's real redirect.
    ///
    /// The trade is deliberate: a genuine `state` mismatch essentially never
    /// happens in a working flow, while hostile probes are free to mount.
    /// Classification still happens — the caller logs it — only the
    /// loop-ending consequence is withheld.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            CallbackOutcome::Code(_) | CallbackOutcome::Provider { .. }
        )
    }
}

/// Classify one HTTP request line, e.g. `GET /callback?code=…&state=… HTTP/1.1`.
pub fn classify(request_line: &str, expected_state: &str) -> CallbackOutcome {
    let mut parts = request_line.split_whitespace();
    let (Some(_method), Some(target)) = (parts.next(), parts.next()) else {
        return CallbackOutcome::Malformed;
    };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return CallbackOutcome::NotFound;
    }
    // An error takes precedence: the server sends it *instead of* a code.
    if let Some(error) = query_param(query, "error") {
        return CallbackOutcome::Provider {
            error,
            description: query_param(query, "error_description"),
        };
    }
    let Some(code) = query_param(query, "code").filter(|c| !c.is_empty()) else {
        return CallbackOutcome::NoCode;
    };
    // Plain equality is enough: `state` is compared once, in-process, against a
    // value generated moments ago. There is no remote timing channel to exploit.
    if query_param(query, "state").as_deref() != Some(expected_state) {
        return CallbackOutcome::StateMismatch;
    }
    CallbackOutcome::Code(code)
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| url_decode(v))
}

/// The raw HTTP response to write back for an outcome.
pub fn http_response(outcome: &CallbackOutcome) -> String {
    match outcome {
        CallbackOutcome::Code(_) => format!(
            "HTTP/1.1 302 Found\r\nLocation: {SUCCESS_URL}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ),
        CallbackOutcome::NotFound => text_response("404 Not Found", "Not found"),
        // Fixed copy on purpose: the provider's `error_description` is
        // attacker-influenced text and is never echoed back into the browser.
        _ => text_response(
            "400 Bad Request",
            "Sign-in could not be completed. Return to Siphon and try again.",
        ),
    }
}

fn text_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = "expected-state-value";

    #[test]
    fn extracts_code_when_state_matches() {
        let line = format!("GET /callback?code=ABC123&state={STATE} HTTP/1.1");
        assert_eq!(
            classify(&line, STATE),
            CallbackOutcome::Code("ABC123".to_string())
        );
    }

    #[test]
    fn percent_decodes_the_code() {
        let line = format!("GET /callback?code=A%2FB%2BC&state={STATE} HTTP/1.1");
        assert_eq!(
            classify(&line, STATE),
            CallbackOutcome::Code("A/B+C".to_string())
        );
    }

    #[test]
    fn rejects_a_mismatched_state() {
        let line = "GET /callback?code=ABC123&state=forged HTTP/1.1";
        assert_eq!(classify(line, STATE), CallbackOutcome::StateMismatch);
    }

    #[test]
    fn rejects_a_missing_state() {
        let line = "GET /callback?code=ABC123 HTTP/1.1";
        assert_eq!(classify(line, STATE), CallbackOutcome::StateMismatch);
    }

    #[test]
    fn reports_a_provider_error_before_looking_for_a_code() {
        let line = "GET /callback?error=access_denied&error_description=User%20said%20no HTTP/1.1";
        assert_eq!(
            classify(line, STATE),
            CallbackOutcome::Provider {
                error: "access_denied".to_string(),
                description: Some("User said no".to_string()),
            }
        );
    }

    #[test]
    fn reports_no_code_when_the_query_has_none() {
        assert_eq!(classify("GET /callback HTTP/1.1", STATE), CallbackOutcome::NoCode);
        assert_eq!(
            classify("GET /callback?code= HTTP/1.1", STATE),
            CallbackOutcome::NoCode
        );
    }

    #[test]
    fn another_path_is_not_found() {
        // A browser will ask for this before or after the real callback.
        assert_eq!(
            classify("GET /favicon.ico HTTP/1.1", STATE),
            CallbackOutcome::NotFound
        );
        let line = format!("GET /other?code=ABC123&state={STATE} HTTP/1.1");
        assert_eq!(classify(&line, STATE), CallbackOutcome::NotFound);
    }

    #[test]
    fn garbage_is_malformed() {
        assert_eq!(classify("", STATE), CallbackOutcome::Malformed);
        assert_eq!(classify("GET", STATE), CallbackOutcome::Malformed);
    }

    #[test]
    fn only_the_authorization_servers_own_redirect_ends_the_listener() {
        // These two are the only shapes the real redirect can take.
        assert!(CallbackOutcome::Code("x".to_string()).is_terminal());
        assert!(CallbackOutcome::Provider {
            error: "e".to_string(),
            description: None
        }
        .is_terminal());

        // Anything a stranger can send at the guessable ephemeral port must not
        // be able to end the sign-in: the listener answers and keeps waiting.
        assert!(!CallbackOutcome::NotFound.is_terminal());
        assert!(!CallbackOutcome::StateMismatch.is_terminal());
        assert!(!CallbackOutcome::NoCode.is_terminal());
        assert!(!CallbackOutcome::Malformed.is_terminal());
    }

    #[test]
    fn a_forged_request_is_still_classified_even_though_it_is_not_terminal() {
        // The classification is what the caller logs; only the loop-ending
        // consequence was withheld. Losing either would be a regression.
        assert_eq!(
            classify("GET /callback?code=ABC123&state=forged HTTP/1.1", STATE),
            CallbackOutcome::StateMismatch
        );
        assert_eq!(classify("GET /callback HTTP/1.1", STATE), CallbackOutcome::NoCode);
        assert_eq!(classify("GET", STATE), CallbackOutcome::Malformed);
        assert_eq!(
            classify("GET /favicon.ico HTTP/1.1", STATE),
            CallbackOutcome::NotFound
        );
    }

    #[test]
    fn a_code_redirects_the_browser_to_the_success_page() {
        let response = http_response(&CallbackOutcome::Code("ABC123".to_string()));
        assert!(response.starts_with("HTTP/1.1 302 Found\r\n"));
        assert!(response.contains(&format!("Location: {SUCCESS_URL}\r\n")));
        assert!(response.ends_with("\r\n\r\n"));
    }

    #[test]
    fn an_unknown_path_answers_404() {
        assert!(http_response(&CallbackOutcome::NotFound).starts_with("HTTP/1.1 404 Not Found\r\n"));
    }

    #[test]
    fn failures_answer_400_without_echoing_provider_text() {
        let outcome = CallbackOutcome::Provider {
            error: "access_denied".to_string(),
            description: Some("<script>alert(1)</script>".to_string()),
        };
        let response = http_response(&outcome);
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        // The provider's text is attacker-influenced and is never reflected.
        assert!(!response.contains("script"));
        assert!(!response.contains("access_denied"));
        assert!(response.contains("Content-Type: text/plain; charset=utf-8"));
    }

    #[test]
    fn every_response_declares_its_length_and_closes() {
        for outcome in [
            CallbackOutcome::Code("x".to_string()),
            CallbackOutcome::NotFound,
            CallbackOutcome::StateMismatch,
        ] {
            let response = http_response(&outcome);
            assert!(response.contains("Content-Length: "), "{response}");
            assert!(response.contains("Connection: close"), "{response}");
        }
    }

    #[test]
    fn hostile_multibyte_input_does_not_panic() {
        // Regression: `%` followed by multi-byte UTF-8 chars (e.g. Euro sign)
        // must not panic. The outcome should be valid (StateMismatch, since no
        // valid code and state won't match).
        let line = "GET /callback?code=%€&state=mismatch HTTP/1.1";
        let outcome = classify(line, STATE);
        // The hostile code value decodes to "%€" literally (% followed by Euro),
        // so the state cannot match — classified, not terminal.
        assert_eq!(outcome, CallbackOutcome::StateMismatch);
        assert!(!outcome.is_terminal());
    }

    #[test]
    fn percent_in_query_near_multibyte_chars() {
        // Another hostile pattern: raw multi-byte bytes in different positions.
        let line = format!("GET /callback?code=test%2F%€&state={STATE} HTTP/1.1");
        let outcome = classify(&line, STATE);
        assert!(outcome.is_terminal());
        // The %2F decodes to /, the %€ is literal, so code = "test/%€".
        assert_eq!(outcome, CallbackOutcome::Code("test/%€".to_string()));
    }
}
