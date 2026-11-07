fn main() {
    // tauri-build does NOT emit rerun-if-changed for bundle icons. Without
    // these lines, editing icons/icon.ico alone leaves the previous Windows
    // RT_ICON resource embedded in the exe (taskbar keeps showing the old
    // icon). Watch every icon file explicitly.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    tauri_build::build()
}
