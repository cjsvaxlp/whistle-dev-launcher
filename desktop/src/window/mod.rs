use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

use crate::services::{Status, PANEL_URL};

fn is_local(url: &Url) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(8899)
}

fn is_rules_page(url: &Url) -> bool {
    // WebKit can report the iframe request before applying its fragment.
    is_local(url)
        && url.path() == "/whistle/"
        && url.query().is_none()
        && matches!(url.fragment(), None | Some("rules"))
}

const TERMINAL_PATH: &str = "/plugin.cafe-projects/terminal.html";

fn terminal_project(url: &Url) -> Option<String> {
    if !is_local(url) || url.path() != TERMINAL_PATH {
        return None;
    }
    let project = url
        .query_pairs()
        .find(|(key, _)| key == "project")
        .map(|(_, value)| value.into_owned())?;
    if project.is_empty()
        || !project
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return None;
    }
    Some(project)
}

fn is_log_download(url: &Url) -> bool {
    is_local(url)
        && url.path().starts_with("/plugin.cafe-projects/api/logs/")
        && url
            .query_pairs()
            .any(|(key, value)| key == "download" && value == "1")
}

fn open_panel(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("panel") {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }

    let url = PANEL_URL.parse().expect("panel URL");
    WebviewWindowBuilder::new(app, "panel", WebviewUrl::External(url))
        .title("Cybercafe 本地调试")
        .inner_size(1100.0, 740.0)
        .min_inner_size(560.0, 400.0)
        .initialization_script(
            "if (location.origin === 'http://127.0.0.1:8899') { window.cafeDesktop = true; window.cafeDesktopTerminal = true; }",
        )
        .on_navigation(|url| {
            if terminal_project(url).is_some() {
                return true;
            }
            (is_local(url) && url.path() == "/plugin.cafe-projects/")
                || is_rules_page(url)
                || is_log_download(url)
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, event| match event {
            DownloadEvent::Requested { url, .. } => is_log_download(&url),
            _ => true,
        })
        .build()?
        .set_focus()
}

fn open_connection_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("connection") {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }

    WebviewWindowBuilder::new(app, "connection", WebviewUrl::App("index.html".into()))
        .title("Cybercafe 本地调试")
        .inner_size(520.0, 240.0)
        .resizable(false)
        .build()?
        .set_focus()
}

pub fn show_window(app: &AppHandle, status: &Status) -> tauri::Result<()> {
    app.show()?;
    if *status == Status::Ready {
        open_panel(app)?;
        if let Some(window) = app.get_webview_window("connection") {
            window.close()?;
        }
        return Ok(());
    }
    open_connection_window(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whistle_editor_allows_webkit_requests_with_or_without_fragment() {
        for url in [
            "http://127.0.0.1:8899/whistle/",
            "http://127.0.0.1:8899/whistle/#rules",
        ] {
            assert!(is_rules_page(&url.parse().unwrap()), "{url}");
        }
    }

    #[test]
    fn terminal_page_opens_only_for_valid_local_projects() {
        for (url, expected) in [
            (
                "http://127.0.0.1:8899/plugin.cafe-projects/terminal.html?project=store",
                Some("store"),
            ),
            (
                "http://127.0.0.1:8899/plugin.cafe-projects/terminal.html?project=web-client",
                Some("web-client"),
            ),
            (
                "http://127.0.0.1:8899/plugin.cafe-projects/terminal.html?project=../etc",
                None,
            ),
            (
                "http://127.0.0.1:8899/plugin.cafe-projects/terminal.html",
                None,
            ),
            (
                "http://127.0.0.1:8898/plugin.cafe-projects/terminal.html?project=store",
                None,
            ),
        ] {
            assert_eq!(
                terminal_project(&url.parse().unwrap()).as_deref(),
                expected,
                "{url}"
            );
        }
    }

    #[test]
    fn rules_and_log_navigation_stay_on_the_local_whistle_origin() {
        for url in [
            "https://127.0.0.1:8899/whistle/#rules",
            "http://localhost:8899/whistle/#rules",
            "http://127.0.0.1:8898/whistle/#rules",
            "http://127.0.0.1:8899/whistle/?other=1#rules",
        ] {
            assert!(!is_rules_page(&url.parse().unwrap()), "{url}");
        }
        let log = "http://127.0.0.1:8899/plugin.cafe-projects/api/logs/hub";
        assert!(is_log_download(
            &format!("{log}?download=1").parse().unwrap()
        ));
        assert!(!is_log_download(&log.parse().unwrap()));
    }
}
