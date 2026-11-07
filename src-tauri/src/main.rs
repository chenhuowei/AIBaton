// Release builds on Windows must not open a console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aibaton_lib::run();
}
