//! Windows never holds the application open because a local API failed or hung.
use std::{sync::mpsc, thread, time::Duration};

pub(super) fn bounded_cleanup(
    timeout: Duration,
    cleanup: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || { let _ = sender.send(cleanup()); });
    receiver.recv_timeout(timeout)
        .map_err(|error| format!("清理未完成，应用仍将退出：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_api_does_not_prevent_exit() {
        assert!(bounded_cleanup(Duration::from_secs(1), || Err("503".into())).is_err());
    }

    #[test]
    fn hung_api_has_a_deadline() {
        let (release, blocked) = mpsc::channel();
        assert!(bounded_cleanup(Duration::from_millis(20), move || {
            let _ = blocked.recv();
            Ok(())
        }).is_err());
        let _ = release.send(());
    }
}
