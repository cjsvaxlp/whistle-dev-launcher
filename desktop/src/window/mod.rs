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

fn is_test_page(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("cloudgametest2.migufun.com")
        && url.port() == Some(18443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with("/cybercafe-")
}

fn open_test_page(url: &Url) {
    let url = url.as_str().to_owned();
    std::thread::spawn(move || {
        if let Err(error) = crate::services::open_browser_url(&url) {
            eprintln!("打开测试页面失败：{error}");
        }
    });
}

fn open_panel(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("panel") {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }

    let url = PANEL_URL.parse().expect("panel URL");
    let handle = app.clone();
    let builder = WebviewWindowBuilder::new(app, "panel", WebviewUrl::External(url));
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        // Wry uses a titlebar inset, rather than the button's top coordinate.
        .traffic_light_position(tauri::LogicalPosition::new(14.0, 21.0));
    #[cfg(target_os = "windows")]
    let builder = builder.decorations(false);
    let window = builder
        .title("Cybercafe 本地调试")
        .inner_size(1100.0, 740.0)
        .min_inner_size(560.0, 400.0)
        .initialization_script(format!(
            "if (location.origin === 'http://127.0.0.1:8899') {{ window.cafeDesktop = true; window.cafeDesktopTerminal = true; if (window.top === window.self) document.addEventListener('DOMContentLoaded', () => {{ document.documentElement.dataset.desktopPlatform = '{}'; }}); }}",
            if cfg!(target_os = "macos") { "macos" } else { "windows" },
        ))
        .on_navigation(|url| {
            if is_test_page(url) {
                open_test_page(url);
                return false;
            }
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
        .build()?;
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            crate::lifecycle::request_exit(&handle);
        }
    });
    window.set_focus()
}

fn is_tauri_asset(url: &Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}

fn is_start_proxy_action(url: &Url) -> bool {
    is_tauri_asset(url)
        && url.path() == "/start-proxy"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn open_connection_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("connection") {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }

    let handle = app.clone();
    WebviewWindowBuilder::new(app, "connection", WebviewUrl::App("index.html".into()))
        .title("Cybercafe 本地调试")
        .inner_size(520.0, 264.0)
        .min_inner_size(440.0, 250.0)
        .on_navigation(move |url| {
            if is_start_proxy_action(url) {
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || crate::menu::run_action(&app, "start"));
                return false;
            }
            is_tauri_asset(url) && matches!(url.path(), "/" | "/index.html" | "/start-proxy")
        })
        .build()?
        .set_focus()
}

pub fn show_window(app: &AppHandle, status: &Status) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
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
    fn start_proxy_action_only_accepts_the_local_connection_route() {
        assert!(is_start_proxy_action(
            &"tauri://localhost/start-proxy".parse().unwrap()
        ));
        assert!(is_start_proxy_action(
            &"http://tauri.localhost/start-proxy".parse().unwrap()
        ));
        assert!(!is_start_proxy_action(
            &"http://localhost/start-proxy".parse().unwrap()
        ));
        assert!(!is_start_proxy_action(
            &"tauri://localhost/start-proxy?extra=1".parse().unwrap()
        ));
    }

    #[test]
    fn direct_browser_navigation_is_limited_to_the_test_project_origin() {
        for (url, allowed) in [
            (
                "https://cloudgametest2.migufun.com:18443/cybercafe-power/#/amsportal",
                true,
            ),
            (
                "http://cloudgametest2.migufun.com:18443/cybercafe-power/",
                false,
            ),
            ("https://cloudgametest2.migufun.com/cybercafe-power/", false),
            ("https://cloudgametest2.migufun.com:18443/admin/", false),
            ("https://somewhere.example:18443/cybercafe-power/", false),
        ] {
            assert_eq!(is_test_page(&url.parse().unwrap()), allowed, "{url}");
        }
    }

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
