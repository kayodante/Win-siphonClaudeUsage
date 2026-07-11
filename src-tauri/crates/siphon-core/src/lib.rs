//! siphon-core — pure, cross-platform business logic for Siphon.
//!
//! This crate is a faithful Rust port of the logic that used to live in the
//! Electron main process (`src/main/*.js` and the shared modules). It contains
//! no Tauri, no `reqwest`, and no `windows` dependency so it can be unit-tested
//! on any host with `cargo test -p siphon-core`.
//!
//! The binary crate (`src-tauri/src/*`) owns the side-effecting glue: the async
//! HTTP client, DPAPI credential encryption, the tray, windows and the IPC
//! command handlers. It calls into the pure functions exposed here.

pub mod alerts;
pub mod diagnostics;
pub mod format;
pub mod i18n;
pub mod json_store;
pub mod local_data;
pub mod oauth;
pub mod preferences;
pub mod pricing;
pub mod profile;
pub mod quota;
pub mod reset_scheduler;
pub mod security;
pub mod state;
pub mod token;
pub mod tray_status;
pub mod updater;

pub use state::AppState;
