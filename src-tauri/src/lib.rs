//! Tauri 2 desktop shell for AionUi + AionCore.
//!
//! Only one command is exposed to the frontend: `core_endpoint`, which blocks
//! until the prebuilt `aioncore` sidecar has passed `/health`. Everything else
//! goes over the backend's own HTTP REST / WebSocket API.

mod sidecar;

use std::process::Child;
use std::sync::{Arc, Condvar, Mutex};

use sidecar::{CoreEndpoint, SidecarError};
use tauri::{Manager, RunEvent, State};

/// `None` = still starting, `Some(Ok)` = ready, `Some(Err)` = failed.
#[derive(Default)]
struct CoreState {
    result: Mutex<Option<Result<CoreEndpoint, String>>>,
    ready: Condvar,
    child: Mutex<Option<Child>>,
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
    std::thread::spawn(move || {
        let outcome: Result<CoreEndpoint, String> = match data_dir {
            Ok(dir) => sidecar::start(&dir, &version)
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
        .manage(Arc::clone(&state))
        .invoke_handler(tauri::generate_handler![core_endpoint, close_main_window, get_data_dir])
        .setup({
            let state = Arc::clone(&state);
            move |app| {
                app.resources_table().add(CoreCleanup(Arc::clone(&state)));
                start_core(app.handle(), state);
                Ok(())
            }
        })
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(move |_, event| {
            if matches!(event, RunEvent::Exit) {
                stop_core(&state);
            }
        }),
        Err(e) => {
            log::error!("failed to build Tauri app: {e}");
            std::process::exit(1);
        }
    }
}
