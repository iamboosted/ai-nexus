//! Focused native tests use production modules without the WebView runtime.
#[path = "../../src-tauri/src/config.rs"]
pub mod config;
#[path = "../../src-tauri/src/proc.rs"]
pub mod proc;
#[path = "../../src-tauri/src/launch.rs"]
pub mod launch;
#[path = "../../src-tauri/src/lifecycle.rs"]
pub mod lifecycle;
