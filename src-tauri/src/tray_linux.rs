use ksni::{menu::StandardItem, Icon, MenuItem, Tray, TrayMethods};
use shore_swp_client::ConnCommand;
use std::io::Cursor;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tracing::warn;

use crate::AppState;

struct ShoreTray {
    app: AppHandle,
    icons: Vec<Icon>,
}

impl ShoreTray {
    /// Read the shared tray status (#36) and map it, or None if state isn't
    /// ready yet. Used by `title`/`menu` so they reflect the live unread count
    /// and last-message preview.
    fn with_status<T>(&self, f: impl FnOnce(&crate::TrayStatus) -> T) -> Option<T> {
        let state = self.app.try_state::<AppState>()?;
        let guard = state.tray.lock().ok()?;
        Some(f(&guard))
    }
}

/// The live ksni tray handle, retained so `refresh` can ask it to re-render
/// when the dynamic status (#36) changes. Set once, when the tray spawns.
static TRAY: OnceLock<ksni::Handle<ShoreTray>> = OnceLock::new();

impl Tray for ShoreTray {
    fn id(&self) -> String {
        "shore-gui".into()
    }

    fn title(&self) -> String {
        self.with_status(crate::tray_tooltip)
            .unwrap_or_else(|| "Shore".into())
    }

    fn icon_pixmap(&self) -> Vec<Icon> {
        self.icons.clone()
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        toggle_main_window(&self.app);
    }

    fn menu(&self) -> Vec<MenuItem<Self>> {
        // Informational, disabled row showing unread count + last preview (#36).
        let status_label = self
            .with_status(crate::tray_preview_label)
            .unwrap_or_else(|| "Shore".into());
        vec![
            StandardItem {
                label: status_label,
                enabled: false,
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "Show Shore".into(),
                activate: Box::new(|this: &mut Self| show_main_window(&this.app)),
                ..Default::default()
            }
            .into(),
            StandardItem {
                // True inline text entry isn't possible in an SNI tray menu, so
                // quick-reply surfaces + focuses the window on the composer.
                label: "Quick reply…".into(),
                activate: Box::new(|this: &mut Self| {
                    show_main_window(&this.app);
                    crate::emit(&this.app, "tray://quick-reply", ());
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Disconnect".into(),
                activate: Box::new(|this: &mut Self| disconnect(this.app.clone())),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "Quit".into(),
                activate: Box::new(|this: &mut Self| this.app.exit(0)),
                ..Default::default()
            }
            .into(),
        ]
    }
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn disconnect(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        let mut guard = state.connection.lock().await;
        if let Some(tx) = guard.take() {
            let _ = tx.send(ConnCommand::Shutdown).await;
        }
    });
}

pub fn spawn(app: AppHandle) {
    // ARGB32, network byte order — SNI spec. Source PNGs are 8-bit RGBA, so
    // decode_png_to_icon rotates each pixel one byte right to move A first.
    // Transparent, plate-less sigil so it blends into the panel instead of
    // showing a dark square (#48). The bundled app icon keeps its squircle.
    let icons: Vec<Icon> = [
        &include_bytes!("../icons/tray-32.png")[..],
        &include_bytes!("../icons/tray-128.png")[..],
    ]
    .into_iter()
    .filter_map(decode_png_to_icon)
    .collect();

    tauri::async_runtime::spawn(async move {
        match (ShoreTray { app, icons }).spawn().await {
            Ok(handle) => {
                // Retain the handle so refresh() can re-render on status change.
                let _ = TRAY.set(handle);
            }
            Err(e) => warn!(error = %e, "failed to spawn ksni tray"),
        }
    });
}

/// Ask the ksni tray to re-render so its title + menu pick up the latest
/// dynamic status (#36). No-op until the tray has spawned.
pub fn refresh(_app: &AppHandle) {
    if let Some(handle) = TRAY.get() {
        let handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            handle.update(|_tray: &mut ShoreTray| {}).await;
        });
    }
}

fn decode_png_to_icon(bytes: &[u8]) -> Option<Icon> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    for pixel in buf.chunks_exact_mut(4) {
        pixel.rotate_right(1);
    }
    Some(Icon {
        width: info.width as i32,
        height: info.height as i32,
        data: buf,
    })
}
