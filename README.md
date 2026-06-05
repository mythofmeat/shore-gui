# shore-gui

Desktop GUI client for the [Shore](https://github.com/mythofmeat/shore-core)
chat daemon, built with [Tauri 2](https://tauri.app).

**Status:** work in progress. Not feature-complete; expect breakage and
unfinished surfaces. Pinned to no particular release cadence yet.

## Building

Requires:

- Rust stable
- [Bun](https://bun.sh/)
- Tauri's [system prerequisites](https://tauri.app/start/prerequisites/)
  for your OS (on Linux: `libwebkit2gtk-4.1`, `libgtk-3`, etc.)

```
bun install
bun tauri dev
```

## Related crates

- [`shore-protocol`](https://crates.io/crates/shore-protocol) — SWP wire types
- [`shore-swp-client`](https://crates.io/crates/shore-swp-client) — async SWP client
- [`shore-core`](https://github.com/mythofmeat/shore-core) — daemon and CLI

## License

Dual-licensed under either of:

- MIT license ([LICENSE-MIT](LICENSE-MIT))
- Apache License 2.0 ([LICENSE-APACHE-2.0](LICENSE-APACHE-2.0))

at your option.
