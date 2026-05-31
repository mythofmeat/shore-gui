# Custom titlebar (replace GTK CSD)

## Context

On KDE Plasma + Wayland, Tauri renders through webkit2gtk (GTK3). GTK3 on
Wayland always draws its own **client-side decoration** and ignores KDE's
`xdg-decoration` (server-side) protocol — so Shore gets a tall GTK header bar
that doesn't match the native Breeze theme. The user wants to stay fully
Wayland-native (no XWayland), so the fix is to disable window decorations
entirely and draw our own slim, themed titlebar in React. Bonus: this makes
Shore's chrome identical across Linux/macOS/Windows.

Chosen layout: **one integrated bar** — sigil + "Shore" on the left, the
existing notices bell + settings gear folded in on the right, then the
window controls (minimize / maximize / close, KDE order).

## Changes

### 1. Turn off native decorations
- `src-tauri/tauri.conf.json` → main window object: add `"decorations": false`.
- `src-tauri/src/lib.rs` `open_window` (~line 339): add `.decorations(false)`
  to the `WebviewWindowBuilder` chain so pop-out panes match.

### 2. Grant window-control permissions
`src-tauri/capabilities/default.json` — add to `permissions`:
`core:window:allow-minimize`, `core:window:allow-toggle-maximize`,
`core:window:allow-unmaximize`, `core:window:allow-close`,
`core:window:allow-start-dragging`, `core:window:allow-start-resize-dragging`,
`core:window:allow-internal-toggle-maximize`, `core:window:allow-is-maximized`.
(Covers both the main and `popout-*` windows already listed.)

### 3. New `src/components/Titlebar.tsx`
A flex-row bar, first child of `#root`. Uses `getCurrentWindow()` from
`@tauri-apps/api/window`.
- **Left brand**: reuse `.sigil` styling + "Shore" text.
- **Drag**: bar + flexible spacer carry `data-tauri-drag-region`; Tauri handles
  click-drag move and double-click-to-maximize natively. Interactive children
  (buttons, the gear) deliberately omit the attribute so clicks register.
- **Right cluster (in order)**: notices bell button (moved from App.tsx),
  `<SettingsMenu />` (moved from App.tsx), a thin divider, then window controls.
- **Window controls**: minimize → `win.minimize()`; maximize/restore →
  `win.toggleMaximize()`; close → `win.close()`. Track maximized state via
  `win.isMaximized()` on mount + a `win.onResized(...)` listener to swap the
  maximize/restore glyph. SVG icons styled like the existing `.notices-trigger`.
- Props: `notices: number`, `onOpenNotices: () => void` (so the bell keeps its
  unread badge + opens the NoticesPanel exactly as today).

### 4. Edge resize handles (borderless Wayland loses native resize)
In `Titlebar.tsx` (or a small sibling rendered in the App root), add 8 thin,
invisible, `position:fixed` handles (4 edges + 4 corners). Each calls
`getCurrentWindow().startResizeDragging(ResizeDirection.X)` on mousedown
(`ResizeDirection` imported from `@tauri-apps/api/window`). Without these a
decoration-less Wayland window can only be resized via Meta+drag — not
discoverable. Handles sit above content (`z-index` over the bar) but are ~4px
and transparent.

### 5. Wire into `src/App.tsx`
- Render `<Titlebar notices={notices.length} onOpenNotices={() => setNoticesOpen(true)} />`
  as the first element inside the top-level fragment (line ~624).
- **Remove** the inline notices `<button className="notices-trigger">` block
  (~lines 642–667) and the standalone `<SettingsMenu />` (~line 641) — both now
  live inside Titlebar.

### 6. CSS — repurpose `src/styles/window-controls.css`
This file is currently dead (its `.window-new` class is imported nowhere), so
replace its contents and `import "../styles/window-controls.css"` from
`Titlebar.tsx`. Add:
- `--titlebar-h` (~34px) on `:root` in `index.css`.
- `.titlebar` (flex row, height `--titlebar-h`, `background: var(--bg)`, bottom
  `1px solid var(--rule)`, `-webkit-user-select:none`), `.titlebar-brand`,
  `.titlebar-spacer` (flex:1, drag region), `.titlebar-divider`.
- `.win-btn` (28px, transparent, `color: var(--ink-mute)`, hover →
  `var(--ember)` / `var(--bg-elev)`), `.win-btn.close:hover` → red.
- `.titlebar-resize` edge/corner handles with per-direction cursors.
- In `index.css`: drop `position:fixed; top; right` from `.settings-menu` and
  `.notices-trigger` (they now flow inside the bar — make `.settings-menu`
  `position:relative` so its absolute `.settings-panel` still anchors). Keep
  panel/dropdown rules as-is.

All colors use existing palette vars (`--bg`, `--bg-elev`, `--ink-mute`,
`--ember`, `--rule`) so the bar follows light/dark + ember theme automatically.

## Verification
- `pnpm tauri dev`. Confirm: slim themed bar replaces the fat GTK titlebar; no
  native KDE decoration appears.
- Drag the bar to move; double-click bar to maximize/restore (glyph swaps).
- Minimize / maximize / close buttons work.
- Resize by dragging each window edge + corner.
- Notices bell still shows the unread badge and opens the panel; gear dropdown
  still opens and toggles view settings.
- Toggle OS light/dark — bar recolors with the palette.
- Open a pop-out (multi-window) — it's borderless with the same titlebar.
- `cargo check` in `src-tauri` (decorations + builder change compile).
