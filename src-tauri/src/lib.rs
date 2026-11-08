//! Tauri 2 desktop shell for AionUi + AionCore.
//!
//! Only one command is exposed to the frontend: `core_endpoint`, which blocks
//! until the prebuilt `aioncore` sidecar has passed `/health`. Everything else
//! goes over the backend's own HTTP REST / WebSocket API.

mod sidecar;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{Arc, Condvar, Mutex};

use sidecar::{CoreEndpoint, SidecarError, SystemInfoConfig};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_notification::NotificationExt;

/// `None` = still starting, `Some(Ok)` = ready, `Some(Err)` = failed.
#[derive(Default)]
struct CoreState {
    result: Mutex<Option<Result<CoreEndpoint, String>>>,
    ready: Condvar,
    child: Mutex<Option<Child>>,
}

/// Whether the main window should hide to the tray on close instead of
/// quitting. Mirrors the upstream Electron behaviour: the renderer persists
/// the toggle, and the native shell owns the close interception + tray icon.
#[derive(Default)]
struct CloseToTrayState(std::sync::atomic::AtomicBool);

impl CloseToTrayState {
    fn set(&self, enabled: bool) {
        self.0.store(enabled, std::sync::atomic::Ordering::Relaxed);
    }
    fn get(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// Explicit quit paths (tray menu “退出”) set this so the close interceptor
/// lets the window through instead of hiding it. Same pattern as Electron's
/// `isQuitting` guard.
struct QuittingState(std::sync::atomic::AtomicBool);

impl Default for QuittingState {
    fn default() -> Self {
        Self(std::sync::atomic::AtomicBool::new(false))
    }
}

impl QuittingState {
    fn set(&self, v: bool) {
        self.0.store(v, std::sync::atomic::Ordering::Relaxed);
    }
    fn get(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// Frontend awaits this before making any HTTP/WS request.
#[tauri::command]
async fn core_endpoint(state: State<'_, Arc<CoreState>>) -> Result<CoreEndpoint, String> {
    let st = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = st.result.lock().map_err(|_| "core.state_poisoned".to_owned())?;
        while guard.is_none() {
            guard = st.ready.wait(guard).map_err(|_| "core.state_poisoned".to_owned())?;
        }
        guard.clone().unwrap_or_else(|| Err("core.state_missing".to_owned()))
    })
    .await
    .map_err(|e| format!("core.join_failed: {e}"))?
}

fn start_core(app: &tauri::AppHandle, state: Arc<CoreState>) {
    let data_dir = app.path().app_data_dir();
    let version = app.package_info().version.to_string();
    let system_info = data_dir.as_ref().map(|d| read_system_info_config(d)).unwrap_or_default();
    std::thread::spawn(move || {
        let outcome: Result<CoreEndpoint, String> = match data_dir {
            Ok(dir) => sidecar::start(&dir, &version, &system_info)
                .map(|sc| {
                    if let Ok(mut c) = state.child.lock() {
                        *c = Some(sc.child);
                    }
                    sc.endpoint
                })
                .map_err(|e: SidecarError| e.to_string()),
            Err(e) => Err(format!("core.no_data_dir: {e}")),
        };
        if let Err(e) = &outcome {
            log::error!("[aioncore] failed to start: {e}");
        }
        if let Ok(mut r) = state.result.lock() {
            *r = Some(outcome);
        }
        state.ready.notify_all();
    });
}

fn stop_core(state: &CoreState) {
    if let Ok(mut c) = state.child.lock() {
        if let Some(child) = c.as_mut() {
            sidecar::stop(child);
        }
        *c = None;
    }
}

/// Registered as a Tauri resource so Drop runs before the app exits (and
/// before an updater could try to replace the sidecar binary).
struct CoreCleanup(Arc<CoreState>);
impl tauri::Resource for CoreCleanup {}
impl Drop for CoreCleanup {
    fn drop(&mut self) {
        stop_core(&self.0);
    }
}

#[tauri::command]
fn close_main_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_owned())?
        .close()
        .map_err(|e| e.to_string())
}

/// Absolute path of the application data directory (SQLite DB, logs, work
/// dir and the downloaded Node.js runtime live here). Shown in About page.
#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

fn system_info_path(data_dir: &Path) -> PathBuf {
    data_dir.join("system-info.json")
}

fn read_system_info_config(data_dir: &Path) -> SystemInfoConfig {
    let path = system_info_path(data_dir);
    if !path.exists() {
        return SystemInfoConfig::default();
    }
    match fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<sidecar::SystemInfoConfig>(&s).ok())
    {
        Some(cfg) => cfg,
        None => SystemInfoConfig::default(),
    }
}

fn write_system_info_config(data_dir: &Path, cfg: &sidecar::SystemInfoConfig) -> Result<(), String> {
    let path = system_info_path(data_dir);
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Update persisted system directory overrides. Called from the system
/// settings page when the user changes work/log directories.
#[tauri::command]
fn update_system_info(
    app: tauri::AppHandle,
    cache_dir: String,
    work_dir: String,
    log_dir: Option<String>,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cfg = sidecar::SystemInfoConfig {
        cache_dir: Some(cache_dir),
        work_dir: Some(work_dir),
        log_dir,
    };
    write_system_info_config(&data_dir, &cfg)
}

/// Restart the application. Used after system directory changes.
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// The renderer persists the close-to-tray toggle to the backend DB; the
/// native shell reads it at boot and keeps the live value updated through
/// this command so the close interceptor follows the switch immediately.
#[tauri::command]
fn set_close_to_tray(state: State<'_, Arc<CloseToTrayState>>, enabled: bool) {
    state.set(enabled);
}

#[tauri::command]
fn get_close_to_tray(state: State<'_, Arc<CloseToTrayState>>) -> bool {
    state.get()
}

/// Build the system tray icon with 显示/退出 menu. Returns the tray handle
/// so the caller can keep it alive for the app lifetime.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示 Aibaton", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Aibaton", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Aibaton")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                // manage() stores the Arc<QuittingState> under the type key
                // `Arc<QuittingState>`, so try_state must request the Arc type
                // — a bare `try_state::<QuittingState>()` returns None and the
                // close interceptor would hide the window instead of quitting.
                if let Some(q) = app.try_state::<Arc<QuittingState>>() {
                    q.set(true);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left click toggles window visibility (Electron parity).
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let visible = w.is_visible().unwrap_or(false);
                    let minimized = w.is_minimized().unwrap_or(false);
                    if visible && !minimized {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                }
            }
        });
    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let state = Arc::new(CoreState::default());
    let builder = tauri::Builder::default();

    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Arc::clone(&state))
        .manage(Arc::new(CloseToTrayState::default()))
        .manage(Arc::new(QuittingState::default()))
        .invoke_handler(tauri::generate_handler![
            core_endpoint,
            close_main_window,
            get_data_dir,
            update_system_info,
            restart_app,
            set_close_to_tray,
            get_close_to_tray
        ])
        .on_window_event(|window, event| {
            // Close interception: hide to tray instead of quitting when the
            // user enabled “关闭到托盘”. Mirrors Electron's `close` handler
            // with `preventDefault()` + `hide()`.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let handle = window.app_handle();
                // Same Arc type-key rule as the quit branch above.
                let quitting = handle
                    .try_state::<Arc<QuittingState>>()
                    .map(|q| q.get())
                    .unwrap_or(false);
                let close_to_tray = handle
                    .try_state::<Arc<CloseToTrayState>>()
                    .map(|s| s.get())
                    .unwrap_or(false);
                if close_to_tray && !quitting {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup({
            let state = Arc::clone(&state);
            move |app| {
                app.resources_table().add(CoreCleanup(Arc::clone(&state)));
                start_core(app.handle(), state);
                // System tray (显示 / 退出 + left-click toggle). Built after the
                // window exists so icon/menu events can resolve "main".
                if let Err(e) = build_tray(app.handle()) {
                    log::warn!("[tray] failed to build tray icon: {e}");
                }
                // aionui:// deep links — same scheme Electron registered. Forward
                // every URL to the renderer through the bridge's realtime
                // emitter so useDeepLink receives identical payloads. The
                // handler captures an AppHandle clone (Send + Sync), not the
                // setup closure's `&mut App`, to satisfy the plugin's bounds.
                let deep_link_handle = app.handle().clone();
                let notif_handle = deep_link_handle.clone();
                // Rust-side click handler: registered at boot, before any toast
                // can exist. The JS `onAction` path is kept as a belt-and-braces
                // second channel, but on Windows the toast activation event is
                // delivered on the WinRT thread and the JS dispatch chain has
                // proven unreliable; this handler reads conversation_id from
                // the toast's stored extra payload and evaluates directly in
                // the webview, same transport as the deep-link forwarder.
                let _ = app.notification().on_action(move |performed| {
                    if performed.action_id() != "tap" {
                        return;
                    }
                    let cid = performed
                        .notification()
                        .and_then(|n| n.extra().get("conversation_id"))
                        .and_then(|v| v.as_str())
                        .map(str::to_owned);
                    if let Some(conversation_id) = cid {
                        log::info!("[notification] toast tapped, jump to {}", conversation_id);
                        if let Some(w) = notif_handle.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let escaped = conversation_id.replace('\\', "\\\\").replace('\'', "\\'");
                            let _ = w.eval(&format!(
                                "window.__bridgeEmitter && window.__bridgeEmitter.emit('notification.clicked', {{ conversation_id: '{escaped}' }})",
                            ));
                        }
                    }
                });
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let raw = url.to_string();
                        log::info!("[deep-link] {}", raw);
                        // Toast launch argument: aibaton://notification?conversation_id=…
                        // → bridge emitter so useNotificationClick can jump to the
                        // conversation. Emitted via webview eval on the realtime
                        // bridge emitter, same transport as the deep-link payload.
                        if raw.starts_with("aibaton://notification") {
                            let cid = url.query_pairs().find(|(k, _)| k == "conversation_id").map(|(_, v)| v.to_string());
                            if let (Some(w), Some(conversation_id)) = (deep_link_handle.get_webview_window("main"), cid) {
                                let _ = w.show();
                                let _ = w.set_focus();
                                let escaped = conversation_id.replace('\\', "\\\\").replace('\'', "\\'");
                                let _ = w.eval(&format!(
                                    "window.__bridgeEmitter && window.__bridgeEmitter.emit('notification.clicked', {{ conversation_id: '{escaped}' }})",
                                ));
                            }
                            continue;
                        }
                        if let Some(w) = deep_link_handle.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let escaped = raw.replace('\\', "\\\\").replace('\'', "\\'");
                            let _ = w.eval(&format!(
                                "window.__bridgeEmitter && window.__bridgeEmitter.emit('deep-link.received', {{ url: '{escaped}' }})",
                            ));
                        }
                    }
                });
                Ok(())
            }
        })
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(move |app_handle, event| {
            // Stop the backend when the last window closes or the app quits.
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                stop_core(&state);
            }
            // Keep the reference used by the closure matcher below.
            let _ = app_handle;
            if let RunEvent::WindowEvent { .. } = event {
                // handled by on_window_event above
            }
        }),
        Err(e) => {
            log::error!("failed to build Tauri app: {e}");
            std::process::exit(1);
        }
    }
}
