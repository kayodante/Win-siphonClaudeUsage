//! The loopback OAuth callback listener. Binds an ephemeral port on
//! `127.0.0.1`, waits for the browser to hit `/callback`, and hands the request
//! line to the pure `siphon_core::oauth_callback` module. This is RFC 8252's
//! native-app flow — the same shape Claude Code uses against this client id.
//!
//! Binding and serving are separate because the caller needs the port to build
//! the authorize URL, and the authorize URL is what produces the `state` the
//! accept loop has to validate against.

use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use siphon_core::oauth_callback::{self, CallbackOutcome};

/// How long the listener stays up before giving up, so a browser the user
/// closed does not hold a socket open for the rest of the run.
const WAIT_TIMEOUT: Duration = Duration::from_secs(300);

/// Cap on the request line we will read. A real `GET /callback?…` is a few
/// hundred bytes; anything larger is not our callback and must not be buffered.
const MAX_REQUEST_LINE: u64 = 8 * 1024;

/// A bound-but-not-yet-serving listener. `port` is what goes into the redirect.
pub struct Pending {
    listener: TcpListener,
    pub port: u16,
}

/// A serving listener. Awaiting `task` yields the terminal outcome, or `None`
/// if `WAIT_TIMEOUT` elapsed first. Aborting `task` stops the listener.
pub struct Loopback {
    pub task: JoinHandle<Option<CallbackOutcome>>,
}

/// Bind an ephemeral port on the loopback interface. `Err` means the caller
/// should fall back to the manual paste flow.
pub async fn bind() -> std::io::Result<Pending> {
    // Loopback only, never 0.0.0.0: nothing outside this machine may reach it.
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    Ok(Pending { listener, port })
}

impl Pending {
    pub fn serve(self, expected_state: String) -> Loopback {
        let listener = self.listener;
        let task = tokio::spawn(async move {
            tokio::time::timeout(WAIT_TIMEOUT, accept_loop(listener, expected_state))
                .await
                .ok()
                .flatten()
        });
        Loopback { task }
    }
}

async fn accept_loop(listener: TcpListener, expected_state: String) -> Option<CallbackOutcome> {
    loop {
        let (mut stream, _peer) = listener.accept().await.ok()?;
        let (reader, mut writer) = stream.split();
        let mut line = String::new();
        if BufReader::new(reader.take(MAX_REQUEST_LINE))
            .read_line(&mut line)
            .await
            .is_err()
        {
            continue;
        }
        let outcome = oauth_callback::classify(&line, &expected_state);
        let _ = writer
            .write_all(oauth_callback::http_response(&outcome).as_bytes())
            .await;
        let _ = writer.flush().await;
        // A browser often asks for /favicon.ico around the real callback; those
        // are answered 404 and the loop keeps waiting for the one that counts.
        if outcome.is_terminal() {
            return Some(outcome);
        }
    }
}
