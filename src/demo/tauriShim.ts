// Demo-only Tauri IPC shim.
//
// shore-gui drives its entire UI from two Tauri events (`connection-status`,
// `server-message`) plus a handful of `invoke()` commands. In a plain browser
// (`bun dev`) there is no Tauri runtime, so `@tauri-apps/api` calls fail. This
// shim installs a minimal `window.__TAURI_INTERNALS__` that implements just the
// contract the API actually uses (verified against @tauri-apps/api@2.11):
//
//   - core.invoke(cmd, args)        -> window.__TAURI_INTERNALS__.invoke
//   - core.transformCallback(fn)    -> window.__TAURI_INTERNALS__.transformCallback
//   - event.listen(ev, fn)          -> invoke('plugin:event|listen', {event, target, handler:<id>})
//   - event unlisten                -> invoke('plugin:event|unlisten', {event, eventId})
//
// With those in place the *real* useDaemon reducer and *all* the real
// components render against canned data — no daemon, no real conversation. This
// module is imported only behind a `?demo` dev flag and is tree-shaken out of
// production builds.

type EventCallback = (rawEvent: { event: string; id: number; payload: unknown }) => void;

interface RegisteredCallback {
  fn: (payload: unknown) => void;
  once: boolean;
}

interface Listener {
  event: string;
  callbackId: number;
  listenerId: number;
}

export type CommandHandler = (
  cmd: string,
  args: Record<string, unknown>,
) => unknown | Promise<unknown>;

// Events whose most-recent payload is replayed to any listener that subscribes
// late. `connection-status` is the connection snapshot; without latching, a
// React StrictMode remount (which tears down and re-registers listeners) could
// miss the one-shot emit and the UI would sit on "not connected".
const LATCHED_EVENTS = new Set(["connection-status"]);

const callbacks = new Map<number, RegisteredCallback>();
const listeners: Listener[] = [];
const latched = new Map<string, unknown>();

let nextCallbackId = 1;
let nextListenerId = 1;
let nextEventId = 1;
let commandHandler: CommandHandler = () => undefined;

/** Register the handler that resolves app `invoke(cmd, args)` calls. */
export function setCommandHandler(handler: CommandHandler): void {
  commandHandler = handler;
}

/** Deliver an event to every matching listener, as the Tauri backend would. */
export function emit(event: string, payload: unknown): void {
  if (LATCHED_EVENTS.has(event)) latched.set(event, payload);
  for (const listener of [...listeners]) {
    if (listener.event !== event) continue;
    deliver(listener.callbackId, event, payload);
  }
}

function deliver(callbackId: number, event: string, payload: unknown): void {
  const cb = callbacks.get(callbackId);
  if (!cb) return;
  (cb.fn as EventCallback)({ event, id: nextEventId++, payload });
  if (cb.once) callbacks.delete(callbackId);
}

export function installTauriShim(): void {
  const internals = {
    transformCallback(fn: (payload: unknown) => void, once = false): number {
      const id = nextCallbackId++;
      callbacks.set(id, { fn, once });
      return id;
    },
    unregisterCallback(id: number): void {
      callbacks.delete(id);
    },
    convertFileSrc(filePath: string): string {
      return filePath;
    },
    invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
      return handleInvoke(cmd, args ?? {});
    },
  };

  // The API reads/writes these globals; provide both so isTauri() and friends
  // behave and any stray plugin lookups find an object rather than crashing.
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = internals;
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ ??= {};
  (window as unknown as { isTauri?: boolean }).isTauri = true;
}

function handleInvoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "plugin:event|listen": {
      const listenerId = nextListenerId++;
      const event = String(args.event);
      const callbackId = Number(args.handler);
      listeners.push({ event, callbackId, listenerId });
      // Replay the latched payload to this fresh subscriber on the next tick
      // (after listen()'s own promise resolves), mirroring a live snapshot.
      if (LATCHED_EVENTS.has(event) && latched.has(event)) {
        const payload = latched.get(event);
        setTimeout(() => deliver(callbackId, event, payload), 0);
      }
      return Promise.resolve(listenerId);
    }
    case "plugin:event|unlisten": {
      const idx = listeners.findIndex((l) => l.listenerId === Number(args.eventId));
      if (idx >= 0) listeners.splice(idx, 1);
      return Promise.resolve();
    }
    case "plugin:event|emit":
    case "plugin:event|emit_to":
      return Promise.resolve();
    case "plugin:notification|is_permission_granted":
      return Promise.resolve(false);
    case "plugin:notification|request_permission":
      return Promise.resolve("denied");
  }

  // Other plugin calls (global-shortcut register/unregister, dialogs, etc.) are
  // best-effort no-ops in the browser demo.
  if (cmd.startsWith("plugin:")) return Promise.resolve(null);

  return Promise.resolve(commandHandler(cmd, args));
}
