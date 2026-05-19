# shore-gui

Desktop GUI client for the [Silvershore](https://github.com/mythofmeat/silvershore)
chat daemon, built with [Tauri 2](https://tauri.app).

**Status:** work in progress. Not feature-complete; expect breakage and
unfinished surfaces. Pinned to no particular release cadence yet.

## Building

Requires:

- Rust stable
- [pnpm](https://pnpm.io/)
- Tauri's [system prerequisites](https://tauri.app/start/prerequisites/)
  for your OS (on Linux: `libwebkit2gtk-4.1`, `libgtk-3`, etc.)

```
pnpm install
pnpm tauri dev
```

## Related crates

- [`shore-protocol`](https://crates.io/crates/shore-protocol) — SWP wire types
- [`shore-swp-client`](https://crates.io/crates/shore-swp-client) — async SWP client
- [silvershore](https://github.com/mythofmeat/silvershore) — daemon and CLI

## License

Dual-licensed under either of:

- MIT license ([LICENSE-MIT](LICENSE-MIT))
- Apache License 2.0 ([LICENSE-APACHE-2.0](LICENSE-APACHE-2.0))

at your option.
