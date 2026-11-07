//! Lifecycle manager for the prebuilt `aioncore` sidecar.
//!
//! The backend binary is supplied as a GitHub Release artifact (v0.2.2), not
//! compiled from source. This module only resolves, spawns, health-checks and
//! terminates it.
//!
//! Verified against `aioncore 0.2.2 --help` (2026-11-07):
//!   --local --host --port --data-dir --work-dir --log-dir --app-version
//!   --log-level --parent-pid --managed-resources-mode
//!
//! Notes:
//! - `--parent-pid` is supported by v0.2.2 but NOT by v0.1.10. We pass it here
//!   because the pinned version is v0.2.2; see docs/BACKEND_BINARY.md.
//! - `--managed-resources-mode bundled` requires a `managed-resources/`
//!   directory next to the executable. When missing we fall back to `download`
//!   (a degraded-but-working mode; the backend logs a warning).

use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

const BINARY_BASE: &str = "aioncore";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreEndpoint {
    pub url: String,
    pub version: String,
    pub managed_resources_dir: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SidecarError {
    pub code: &'static str,
    pub detail: String,
}

impl std::fmt::Display for SidecarError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for SidecarError {}

fn err(code: &'static str, detail: impl std::fmt::Display) -> SidecarError {
    SidecarError { code, detail: detail.to_string() }
}

pub struct Sidecar {
    pub endpoint: CoreEndpoint,
    pub child: Child,
}

fn host_triple() -> &'static str {
    match (env::consts::OS, env::consts::ARCH) {
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        ("windows", "aarch64") => "aarch64-pc-windows-msvc",
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
        _ => "x86_64-unknown-linux-gnu",
    }
}

fn exe_name() -> String {
    if cfg!(windows) { format!("{BINARY_BASE}.exe") } else { BINARY_BASE.to_owned() }
}

/// Resolution order: `AIONUI_CORE_BIN` override → bundled (externalBin beside
/// the main executable) → dev-time `src-tauri/binaries/` → system PATH.
fn core_binary() -> Result<PathBuf, SidecarError> {
    if let Ok(p) = env::var("AIONUI_CORE_BIN") {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
        return Err(err("core.binary_not_found", format!("AIONUI_CORE_BIN={}", path.display())));
    }

    let exe = env::current_exe().map_err(|e| err("core.binary_not_found", e))?;
    if let Some(dir) = exe.parent() {
        let bundled = dir.join(format!("{BINARY_BASE}-{}{}", host_triple(), if cfg!(windows) { ".exe" } else { "" }));
        if bundled.exists() {
            return Ok(bundled);
        }
        let plain = dir.join(exe_name());
        if plain.exists() {
            return Ok(plain);
        }
    }

    // `cargo tauri dev` runs src-tauri/target/debug/<app>, so the prebuilt
    // binary is reachable relative to the manifest dir at compile time.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("{BINARY_BASE}-{}{}", host_triple(), if cfg!(windows) { ".exe" } else { "" }));
    if dev.exists() {
        return Ok(dev);
    }

    Err(err(
        "core.binary_not_found",
        "run `node scripts/adopt-aioncore.mjs` or set AIONUI_CORE_BIN",
    ))
}

fn free_port() -> Result<u16, SidecarError> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| err("core.no_port", e))?;
    listener.local_addr().map(|a| a.port()).map_err(|e| err("core.no_port", e))
}

/// Minimal HTTP/1.1 probe (no external HTTP client dependency).
fn healthy(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        Duration::from_millis(300),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut head = [0u8; 16];
    matches!(stream.read(&mut head), Ok(n) if n >= 12 && head.starts_with(b"HTTP/1.1 200"))
}

fn ensure_dir(p: &Path) -> Result<(), SidecarError> {
    std::fs::create_dir_all(p)
        .map_err(|e| err("core.dir_failed", format!("{}: {e}", p.display())))
}

/// Start aioncore and wait until `/health` returns 200 (30 s deadline).
pub fn start(data_dir: &Path, app_version: &str) -> Result<Sidecar, SidecarError> {
    let bin = core_binary()?;
    let port = free_port()?;
    let work_dir = data_dir.join("work");
    let log_dir = data_dir.join("logs");
    for d in [data_dir, &work_dir, &log_dir] {
        ensure_dir(d)?;
    }

    let managed_dir = bin.parent().map(|p| p.join("managed-resources"));
    let managed_ready = managed_dir.as_ref().is_some_and(|p| p.join("manifest.json").exists());

    let mut command = Command::new(&bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Avoid a visible console for the backend and its child CLI processes.
        if env::var("AIONUI_CORE_CONSOLE").as_deref() != Ok("1") {
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
    }

    let mut args: Vec<String> = vec![
        "--local".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "--data-dir".into(),
        data_dir.display().to_string(),
        "--work-dir".into(),
        work_dir.display().to_string(),
        "--log-dir".into(),
        log_dir.display().to_string(),
        "--app-version".into(),
        app_version.into(),
        "--log-level".into(),
        "info".into(),
        "--parent-pid".into(),
        std::process::id().to_string(),
    ];
    if managed_ready {
        args.push("--managed-resources-mode".into());
        args.push("bundled".into());
    }
    // Missing bundled resources: keep the backend default (`download`). It
    // degrades to a warning if nodejs.org is unreachable but /health still 200.

    log::info!("[aioncore] starting: {} {}", bin.display(), args.join(" "));
    let child = command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| err("core.spawn_failed", format!("{}: {e}", bin.display())))?;

    let mut sidecar = Sidecar {
        endpoint: CoreEndpoint {
            url: format!("http://127.0.0.1:{port}"),
            version: app_version.to_owned(),
            managed_resources_dir: if managed_ready {
                managed_dir.map(|p| p.display().to_string())
            } else {
                None
            },
        },
        child,
    };

    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Ok(Some(status)) = sidecar.child.try_wait() {
            let _ = sidecar.child.kill();
            return Err(err(
                "core.exited",
                format!("aioncore exited during startup ({status}); logs: {}", log_dir.display()),
            ));
        }
        if healthy(port) {
            log::info!("[aioncore] ready on port {port}");
            return Ok(sidecar);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    let _ = sidecar.child.kill();
    Err(err(
        "core.start_timeout",
        format!("aioncore did not become healthy within 30s; logs: {}", log_dir.display()),
    ))
}

pub fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}
