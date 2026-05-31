#[cfg(target_os = "linux")]
mod tray_linux;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use shore_protocol::client_msg::{
    Cancel, ClientMessage, ClientMessageBody, Command, ImageUpload, Regen,
};
use shore_swp_client::{spawn_connection, ConnCommand, ConnEvent};
#[cfg(not(target_os = "linux"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
#[cfg(target_os = "macos")]
use tauri::menu::AboutMetadata;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, warn};

const CLIENT_TYPE: &str = "gui";
const CLIENT_NAME: &str = "shore-gui";
static RID_SEQ: AtomicU64 = AtomicU64::new(1);
// Monotonic suffix for auto-generated pop-out window labels (#31).
static WINDOW_SEQ: AtomicU64 = AtomicU64::new(1);

/// Dynamic tray state (#36): the unread count and last-message preview the tray
/// reflects in its tooltip/title and an informational menu item. Shared (std
/// Mutex, since both trays touch it from sync contexts) so `set_tray_status`
/// and the platform tray implementations read the same value.
#[derive(Clone, Default)]
pub(crate) struct TrayStatus {
    pub(crate) unread: u32,
    pub(crate) preview: Option<String>,
}

pub(crate) struct AppState {
    pub(crate) connection: Mutex<Option<mpsc::Sender<ConnCommand>>>,
    /// The address of the live connection, so `connect` can stay idempotent
    /// across a second window mounting (#31) and only re-spawn when the target
    /// address actually changed.
    pub(crate) addr: Mutex<Option<String>>,
    pub(crate) tray: Arc<std::sync::Mutex<TrayStatus>>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ConnectionStatus {
    Connected {
        server_name: String,
        characters: Vec<shore_protocol::types::CharacterInfo>,
        selected_character: Option<String>,
        history: Vec<shore_protocol::types::Message>,
        config: serde_json::Value,
        active_start: usize,
    },
    Disconnected {
        reason: String,
    },
}

/// Normalize an optional address into the form the connection layer expects:
/// `None` (its default) when empty/blank, `Some(trimmed)` otherwise.
fn normalize_addr(addr: Option<String>) -> Option<String> {
    addr.map(|a| a.trim().to_string()).filter(|a| !a.is_empty())
}

#[tauri::command]
async fn connect(
    addr: Option<String>,
    character: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let target = normalize_addr(addr);

    // Idempotent (#31): a second window's React app also calls `connect` on
    // mount. Don't tear down a healthy connection to the same address — only
    // (re)connect when nothing is live or the target address changed. Events
    // broadcast app-global, so both windows share the one connection.
    {
        let conn = state.connection.lock().await;
        let current_addr = state.addr.lock().await;
        if conn.is_some() && *current_addr == target {
            debug!(addr = ?target, "connect: reusing existing connection");
            return Ok(());
        }
    }

    let mut guard = state.connection.lock().await;
    if let Some(old_tx) = guard.take() {
        let _ = old_tx.send(ConnCommand::Shutdown).await;
    }

    let (cmd_tx, mut event_rx) = spawn_connection(
        target.clone(),
        None,
        CLIENT_TYPE,
        CLIENT_NAME,
        character,
    );
    *guard = Some(cmd_tx);
    drop(guard);
    *state.addr.lock().await = target;

    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            match event {
                ConnEvent::Connected {
                    server_name,
                    characters,
                    history,
                    active_start,
                    config,
                    selected_character,
                } => {
                    debug!(%server_name, chars = characters.len(), history = history.len(), "connected");
                    emit(
                        &app,
                        "connection-status",
                        ConnectionStatus::Connected {
                            server_name,
                            characters,
                            selected_character,
                            history,
                            config,
                            active_start,
                        },
                    );
                }
                ConnEvent::Message(msg) => {
                    emit(&app, "server-message", msg);
                }
                ConnEvent::Disconnected(reason) => {
                    debug!(%reason, "disconnected");
                    emit(
                        &app,
                        "connection-status",
                        ConnectionStatus::Disconnected { reason },
                    );
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn send_message(
    text: String,
    image_data: Option<Vec<ImageUpload>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let guard = state.connection.lock().await;
    let tx = guard.as_ref().ok_or("not connected")?;
    let rid = make_rid("msg");

    let msg = ClientMessage::Message(ClientMessageBody {
        rid: Some(rid.clone()),
        text,
        stream: true,
        images: vec![],
        image_data: image_data.unwrap_or_default(),
        absence_seconds: None,
        overrides: None,
    });

    tx.send(ConnCommand::Send(msg))
        .await
        .map_err(|e| e.to_string())?;

    Ok(rid)
}

#[tauri::command]
async fn send_command(
    name: String,
    args: Option<serde_json::Value>,
    rid: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let command_name = name.trim();
    if command_name.is_empty() {
        return Err("command name is required".into());
    }

    let guard = state.connection.lock().await;
    let tx = guard.as_ref().ok_or("not connected")?;
    let rid = rid
        .filter(|rid| !rid.trim().is_empty())
        .unwrap_or_else(|| make_rid("cmd"));

    let msg = ClientMessage::Command(Command {
        rid: Some(rid.clone()),
        name: command_name.to_string(),
        args: args.unwrap_or_else(|| serde_json::json!({})),
    });

    tx.send(ConnCommand::Send(msg))
        .await
        .map_err(|e| e.to_string())?;

    Ok(rid)
}

#[tauri::command]
async fn regen(
    guidance: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let guard = state.connection.lock().await;
    let tx = guard.as_ref().ok_or("not connected")?;
    let rid = make_rid("regen");

    let msg = ClientMessage::Regen(Regen {
        rid: Some(rid.clone()),
        stream: true,
        guidance: guidance.filter(|g| !g.trim().is_empty()),
    });

    tx.send(ConnCommand::Send(msg))
        .await
        .map_err(|e| e.to_string())?;

    Ok(rid)
}

#[tauri::command]
async fn cancel(state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.connection.lock().await;
    let tx = guard.as_ref().ok_or("not connected")?;
    tx.send(ConnCommand::Send(ClientMessage::Cancel(Cancel {})))
        .await
        .map_err(|e| e.to_string())
}

/// An image read from disk for attachment (#17): the base name plus its
/// base64-encoded bytes, ready to become a shore_protocol ImageUpload.
#[derive(Serialize, Clone)]
struct ReadImage {
    filename: String,
    data: String,
}

/// Read an image file the user picked via the dialog plugin and return its
/// base64-encoded bytes. Done in Rust so we don't need an fs-scope capability
/// or a JS filesystem plugin just to slurp a single user-selected file.
#[tauri::command]
async fn read_image_file(path: String) -> Result<ReadImage, String> {
    use base64::Engine as _;

    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("failed to read image: {e}"))?;
    let filename = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image")
        .to_string();
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(ReadImage { filename, data })
}

/// Save inline image bytes to a user-chosen path (#33, drag-out image save).
/// Opens the native save dialog seeded with `suggested_name`, decodes the
/// base64 payload, and writes it. Returns the path written, or `None` when the
/// user cancels the dialog.
#[tauri::command]
async fn save_image_bytes(
    data_base64: String,
    suggested_name: String,
    app: AppHandle,
) -> Result<Option<String>, String> {
    use base64::Engine as _;
    use tauri_plugin_dialog::DialogExt;

    // Tolerate a `data:` URI prefix so callers can pass an image src directly.
    let b64 = data_base64
        .split_once("base64,")
        .map(|(_, rest)| rest)
        .unwrap_or(&data_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("invalid base64 image data: {e}"))?;

    let name = if suggested_name.trim().is_empty() {
        "image.png".to_string()
    } else {
        suggested_name
    };

    // FileDialogBuilder::save_file is callback-based; bridge it to async.
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let Some(path) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None); // user cancelled
    };

    let path_buf = path
        .into_path()
        .map_err(|e| format!("invalid save path: {e}"))?;
    tokio::fs::write(&path_buf, &bytes)
        .await
        .map_err(|e| format!("failed to write image: {e}"))?;

    let saved = path_buf.to_string_lossy().to_string();
    debug!(path = %saved, bytes = bytes.len(), "saved image to disk");
    Ok(Some(saved))
}

/// Open a new application window (#31, multi-pane / pop-out). Loads the same
/// `index.html`; its React app reuses the existing daemon connection because
/// `connect` is idempotent and events broadcast app-global. A `label` may be
/// supplied to address a specific window; otherwise one is generated.
#[tauri::command]
async fn open_window(label: Option<String>, app: AppHandle) -> Result<String, String> {
    let label = label
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .unwrap_or_else(|| format!("popout-{}", WINDOW_SEQ.fetch_add(1, Ordering::Relaxed)));

    // If a window with this label already exists, just focus it.
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(label);
    }

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Shore")
        .inner_size(1100.0, 750.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    debug!(%label, "opened pop-out window");
    Ok(label)
}

/// Update the dynamic tray state (#36): unread count and an optional last
/// message preview. Reflected in the tray tooltip/title and an informational
/// menu item on both Linux (ksni) and the native tray.
#[tauri::command]
async fn set_tray_status(
    unread: u32,
    preview: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let preview = preview
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .map(|p| truncate_preview(&p));

    {
        let mut tray = state.tray.lock().map_err(|e| e.to_string())?;
        tray.unread = unread;
        tray.preview = preview;
    }

    refresh_tray(&app);
    Ok(())
}

/// Trim a preview string to a tray-friendly length on a char boundary.
fn truncate_preview(s: &str) -> String {
    const MAX: usize = 80;
    if s.chars().count() <= MAX {
        return s.to_string();
    }
    let mut out: String = s.chars().take(MAX).collect();
    out.push('…');
    out
}

/// A scraped link preview (#40). Every field except `url` is best-effort.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}

/// Fetch and lightly scrape a link's OpenGraph/Twitter/<title>/<meta> head
/// (#40, link unfurl). PRIVACY-SENSITIVE: this performs a server-side request
/// to an arbitrary URL, so the frontend MUST gate it behind an opt-in setting
/// and only call it then. Defensive by construction: only http(s), a short
/// timeout, a hard response-size cap, a sane User-Agent, and a bounded redirect
/// policy (reqwest's default of up to 10).
#[tauri::command]
async fn fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    // Reject anything that isn't an absolute http(s) URL up front.
    let parsed = reqwest::Url::parse(url.trim()).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("unsupported url scheme: {other}")),
    }

    const MAX_BYTES: usize = 512 * 1024; // 512 KB cap on the HTML we read.
    let client = reqwest::Client::builder()
        .user_agent(format!("{CLIENT_NAME}/0.1 (+link-preview)"))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    debug!(%url, "fetching link preview");
    let resp = client
        .get(parsed.clone())
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("upstream returned {}", resp.status()));
    }

    // Only bother parsing HTML; skip images/binaries we can't scrape.
    let is_html = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.contains("html") || ct.contains("xml"))
        .unwrap_or(true);
    if !is_html {
        return Ok(LinkPreview {
            url: parsed.to_string(),
            ..Default::default()
        });
    }

    // Stream the body so we can stop at the size cap instead of buffering an
    // arbitrarily large page into memory.
    let mut body = Vec::new();
    let mut stream = resp;
    while let Some(chunk) = stream.chunk().await.map_err(|e| e.to_string())? {
        body.extend_from_slice(&chunk);
        if body.len() >= MAX_BYTES {
            body.truncate(MAX_BYTES);
            break;
        }
    }
    let html = String::from_utf8_lossy(&body);

    Ok(scrape_link_preview(&html, parsed.as_str()))
}

/// Minimal, dependency-free head scraper. Walks the HTML for `<meta>` tags
/// (OpenGraph `og:*`, Twitter `twitter:*`, `name="description"`) and the
/// `<title>`. Deliberately lightweight: a real parser (html5ever/scraper) would
/// dwarf the rest of the binary, and we only need a handful of head fields.
fn scrape_link_preview(html: &str, url: &str) -> LinkPreview {
    let mut preview = LinkPreview {
        url: url.to_string(),
        ..Default::default()
    };

    // <title> — first occurrence only.
    if let Some(title) = extract_between(html, "<title", "</title>") {
        // Strip any attributes on the opening tag, then the leading '>'.
        if let Some(idx) = title.find('>') {
            let text = decode_entities(title[idx + 1..].trim());
            if !text.is_empty() {
                preview.title = Some(text);
            }
        }
    }

    for tag in iter_meta_tags(html) {
        let property = attr(&tag, "property").or_else(|| attr(&tag, "name"));
        let Some(property) = property else { continue };
        let Some(content) = attr(&tag, "content") else {
            continue;
        };
        let content = decode_entities(content.trim());
        if content.is_empty() {
            continue;
        }
        match property.to_ascii_lowercase().as_str() {
            "og:title" | "twitter:title" => {
                // OpenGraph title wins over the bare <title>.
                preview.title = Some(content);
            }
            "og:description" | "twitter:description" | "description" => {
                if preview.description.is_none() {
                    preview.description = Some(content);
                }
            }
            "og:image" | "og:image:url" | "twitter:image" | "twitter:image:src" => {
                if preview.image.is_none() {
                    preview.image = Some(resolve_url(url, &content));
                }
            }
            "og:site_name" => {
                preview.site_name = Some(content);
            }
            _ => {}
        }
    }

    preview
}

/// Yield each `<meta ...>` tag's inner text (between `<meta` and the closing
/// `>`), scanning only the document head region for efficiency.
fn iter_meta_tags(html: &str) -> Vec<String> {
    let head_end = html
        .find("</head>")
        .or_else(|| html.find("</HEAD>"))
        .unwrap_or_else(|| html.len().min(64 * 1024));
    let head = &html[..head_end];

    let mut tags = Vec::new();
    let bytes = head.as_bytes();
    let lower = head.to_ascii_lowercase();
    let mut from = 0;
    while let Some(rel) = lower[from..].find("<meta") {
        let start = from + rel;
        // Find the end of this tag.
        if let Some(end_rel) = head[start..].find('>') {
            let end = start + end_rel;
            tags.push(head[start..end].to_string());
            from = end + 1;
        } else {
            break;
        }
        let _ = bytes; // keep the byte view for clarity; not strictly needed.
    }
    tags
}

/// Extract the substring after `open` and before the next `close`, if both are
/// present (case-insensitively for the open marker).
fn extract_between<'a>(haystack: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let lower = haystack.to_ascii_lowercase();
    let start = lower.find(&open.to_ascii_lowercase())?;
    let rest = &haystack[start + open.len()..];
    let rest_lower = lower[start + open.len()..].to_string();
    let end = rest_lower.find(&close.to_ascii_lowercase())?;
    Some(&rest[..end])
}

/// Read an HTML attribute value (single- or double-quoted) from a tag string.
fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut search = 0;
    loop {
        let idx = lower[search..].find(&name.to_ascii_lowercase())? + search;
        // Ensure it's a standalone attribute (preceded by whitespace/tag start).
        let preceded_ok = idx == 0
            || tag[..idx]
                .chars()
                .last()
                .map(|c| c.is_whitespace())
                .unwrap_or(true);
        let after = &tag[idx + name.len()..];
        let after_trimmed = after.trim_start();
        if preceded_ok && after_trimmed.starts_with('=') {
            let val = after_trimmed[1..].trim_start();
            let quote = val.chars().next()?;
            if quote == '"' || quote == '\'' {
                let end = val[1..].find(quote)?;
                return Some(val[1..1 + end].to_string());
            }
            // Unquoted value: read up to whitespace or tag end.
            let end = val
                .find(|c: char| c.is_whitespace() || c == '>')
                .unwrap_or(val.len());
            return Some(val[..end].to_string());
        }
        search = idx + name.len();
    }
}

/// Resolve a possibly-relative URL against the page URL (best-effort).
fn resolve_url(base: &str, value: &str) -> String {
    if value.starts_with("http://") || value.starts_with("https://") {
        return value.to_string();
    }
    match reqwest::Url::parse(base).and_then(|b| b.join(value)) {
        Ok(joined) => joined.to_string(),
        Err(_) => value.to_string(),
    }
}

/// Decode the handful of HTML entities common in meta content.
fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.connection.lock().await;
    if let Some(tx) = guard.take() {
        let _ = tx.send(ConnCommand::Shutdown).await;
    }
    *state.addr.lock().await = None;
    Ok(())
}

fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(e) = app.emit(event, payload) {
        warn!(%event, error = %e, "failed to emit Tauri event");
    }
}

fn make_rid(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let seq = RID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}_{nanos}_{seq}")
}

/// Compose the tray tooltip text from the current dynamic status (#36).
fn tray_tooltip(status: &TrayStatus) -> String {
    let mut out = String::from("Shore");
    if status.unread > 0 {
        out.push_str(&format!(" — {} unread", status.unread));
    }
    if let Some(preview) = &status.preview {
        out.push_str(&format!("\n{preview}"));
    }
    out
}

/// Label for the disabled, informational preview menu item (#36).
fn tray_preview_label(status: &TrayStatus) -> String {
    match &status.preview {
        Some(p) if status.unread > 0 => format!("{}× {}", status.unread, p),
        Some(p) => p.clone(),
        None if status.unread > 0 => format!("{} unread", status.unread),
        None => "No new messages".to_string(),
    }
}

/// Push the current tray status into the platform tray. On Linux this asks ksni
/// to re-render; on the native tray it rebuilds the tooltip/menu in place.
fn refresh_tray(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    tray_linux::refresh(app);
    #[cfg(not(target_os = "linux"))]
    native_tray::refresh(app);
}

// --- Native menu (#37) -----------------------------------------------------
//
// A standard app menu with File / Edit / View / Conversation / Window / Help.
// Custom items emit a Tauri event `menu://<id>` the frontend listens to; Edit
// uses Tauri's predefined copy/paste/select-all roles where available. On macOS
// the leading app menu gets the conventional About/Services/Hide/Quit roles.

fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;

    // macOS app menu (the bold app-name menu). Only present on macOS.
    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            CLIENT_NAME,
            true,
            &[
                &PredefinedMenuItem::about(app, Some("Shore"), Some(AboutMetadata::default()))?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "preferences", "Preferences…", true, Some("Cmd+,"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        menu.append(&app_menu)?;
    }

    // File
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+N"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "close-window",
                "Close Window",
                true,
                Some("CmdOrCtrl+W"),
            )?,
        ],
    )?;
    menu.append(&file)?;

    // Edit — native roles plus a Find entry that drives in-app search.
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "search", "Find…", true, Some("CmdOrCtrl+F"))?,
        ],
    )?;
    menu.append(&edit)?;

    // View
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(
                app,
                "toggle-thinking",
                "Toggle Thinking",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "command-palette",
                "Command Palette…",
                true,
                Some("CmdOrCtrl+K"),
            )?,
        ],
    )?;
    menu.append(&view)?;

    // Conversation
    let conversation = Submenu::with_items(
        app,
        "Conversation",
        true,
        &[
            &MenuItem::with_id(app, "regen", "Regenerate", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "compact", "Compact History", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?,
        ],
    )?;
    menu.append(&conversation)?;

    // Window — predefined minimize/zoom plus our New Window.
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    menu.append(&window)?;

    // Help
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&MenuItem::with_id(
            app,
            "about",
            "About Shore",
            true,
            None::<&str>,
        )?],
    )?;
    menu.append(&help)?;

    Ok(menu)
}

/// Handle a click on one of our custom (non-role) menu items by emitting a
/// `menu://<id>` event. A few items also have a native effect here.
fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "new-window" => {
            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = open_window(None, app_for_task).await {
                    warn!(error = %e, "menu new-window failed");
                }
            });
            // Also notify the frontend in case it wants to react.
            emit(app, "menu://new-window", ());
        }
        "close-window" => {
            if let Some((_, w)) = app
                .webview_windows()
                .into_iter()
                .find(|(_, w)| w.is_focused().unwrap_or(false))
            {
                let _ = w.close();
            }
        }
        "disconnect" => {
            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = app_for_task.try_state::<AppState>() {
                    let mut guard = state.connection.lock().await;
                    if let Some(tx) = guard.take() {
                        let _ = tx.send(ConnCommand::Shutdown).await;
                    }
                    *state.addr.lock().await = None;
                }
            });
            emit(app, "menu://disconnect", ());
        }
        // The rest are pure frontend signals: search, preferences, regen,
        // compact, toggle-thinking, command-palette, about, …
        other => emit(app, &format!("menu://{other}"), ()),
    }
}

// --- Native (non-Linux) tray (#36) -----------------------------------------

#[cfg(not(target_os = "linux"))]
mod native_tray {
    use super::*;
    use tauri::menu::Menu;
    use tauri::tray::TrayIconBuilder;

    pub(super) fn build(app: &AppHandle) -> tauri::Result<()> {
        let menu = build_menu(app, &TrayStatus::default())?;

        let icon = app
            .default_window_icon()
            .cloned()
            .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

        TrayIconBuilder::with_id("main")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .icon(icon)
            .tooltip("Shore")
            .on_menu_event(|app, event| match event.id.as_ref() {
                "show" => show_main_window(app),
                "quick-reply" => {
                    show_main_window(app);
                    emit(app, "tray://quick-reply", ());
                }
                "disconnect" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(state) = app.try_state::<AppState>() {
                            let mut guard = state.connection.lock().await;
                            if let Some(tx) = guard.take() {
                                let _ = tx.send(ConnCommand::Shutdown).await;
                            }
                            *state.addr.lock().await = None;
                        }
                    });
                }
                "quit" => app.exit(0),
                // The preview item is informational/disabled; ignore clicks.
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            show_main_window(app);
                        }
                    }
                }
            })
            .build(app)?;

        Ok(())
    }

    /// Rebuild the tray menu + tooltip from the current dynamic status (#36).
    pub(super) fn refresh(app: &AppHandle) {
        let status = match app.try_state::<AppState>() {
            Some(state) => state.tray.lock().map(|s| s.clone()).unwrap_or_default(),
            None => TrayStatus::default(),
        };
        if let Some(tray) = app.tray_by_id("main") {
            if let Ok(menu) = build_menu(app, &status) {
                let _ = tray.set_menu(Some(menu));
            }
            let _ = tray.set_tooltip(Some(&tray_tooltip(&status)));
        }
    }

    fn build_menu(app: &AppHandle, status: &TrayStatus) -> tauri::Result<Menu<tauri::Wry>> {
        // A disabled, informational preview item that reflects unread/preview.
        let preview = MenuItem::with_id(
            app,
            "preview",
            tray_preview_label(status),
            false,
            None::<&str>,
        )?;
        let show = MenuItem::with_id(app, "show", "Show Shore", true, None::<&str>)?;
        let quick = MenuItem::with_id(app, "quick-reply", "Quick reply…", true, None::<&str>)?;
        let disconnect_item =
            MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?;
        let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        Menu::with_items(
            app,
            &[
                &preview,
                &PredefinedMenuItem::separator(app)?,
                &show,
                &quick,
                &disconnect_item,
                &PredefinedMenuItem::separator(app)?,
                &quit_item,
            ],
        )
    }

    pub(super) fn show_main_window(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,shore_gui_lib=debug")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Global hotkey (#35): the JS side registers/unregisters the actual
        // accelerator (suggested default CmdOrCtrl+Shift+Space) via the plugin.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            app.manage(AppState {
                connection: Mutex::new(None),
                addr: Mutex::new(None),
                tray: Arc::new(std::sync::Mutex::new(TrayStatus::default())),
            });

            // Native OS menubar (#37). Items emit `menu://<id>` events.
            let menu = build_app_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| handle_menu_event(app, event.id.as_ref()));

            #[cfg(target_os = "linux")]
            tray_linux::spawn(app.handle().clone());
            #[cfg(not(target_os = "linux"))]
            native_tray::build(app.handle())?;

            // CloseRequested → hide, but only for the main window (#31). Pop-out
            // windows actually close so the multi-pane workflow feels native.
            if let Some(window) = app.get_webview_window("main") {
                let handle = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = handle.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            send_message,
            send_command,
            read_image_file,
            save_image_bytes,
            open_window,
            set_tray_status,
            fetch_link_preview,
            regen,
            cancel,
            disconnect,
            quit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
