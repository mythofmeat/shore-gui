# Screenshot / demo harness

A dev-only harness for screenshotting the UI with **fake** conversations — no
daemon, no real data. It installs a minimal fake `window.__TAURI_INTERNALS__`
(see `tauriShim.ts`) so the real `useDaemon` reducer and every real component
render against canned fixtures exactly as they would in production.

## Use

```sh
bun dev
# then open, switching scenarios via the `?demo=` query param:
#   http://localhost:1420/?demo=all
#   http://localhost:1420/?demo=tools
```

A small switcher in the bottom-left corner flips between scenarios. Without
`?demo`, the app behaves normally (connects to a real daemon).

## Scenarios

`all` (everything mixed), `markdown`, `code`, `thinking`, `tools`, `images`,
`tokens`, `gaps` (time-gap dividers), `long-scroll`, `edge-cases`,
`multi-character`, `notices` (toasts/errors), `streaming` (a live, never-ending
stream — good for capturing the typing/phase state), `empty`.

## Files

- `tauriShim.ts` — fake Tauri IPC (`invoke` + event `listen`/emit). The only
  contract honored is what `@tauri-apps/api` actually calls.
- `fixtures.ts` — the fake conversations. Edit/extend the message groups here.
- `index.ts` — wires the shim to a scenario, answers `invoke` commands, drives
  scripted `server-message` frames, and mounts the corner switcher.

It is gated behind `import.meta.env.DEV` + `?demo` and dynamically imported, so
it is tree-shaken out of production builds (verified: absent from `dist`).
