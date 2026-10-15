//! Window-close policy shared by native events and focused tests.
pub fn on_close(label: &str, shutdown: impl FnOnce()) {
    if label == "main" {
        shutdown();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closing_settings_keeps_main_and_owned_processes() {
        let mut owned = vec!["main", "inference", "webui", "tts", "stt"];
        on_close("settings", || owned.clear());
        assert_eq!(owned.len(), 5);
    }
    #[test]
    fn closing_main_invokes_owned_shutdown() {
        let mut called = false;
        on_close("main", || called = true);
        assert!(called);
    }
}
