// Demo harness entry point. Gated behind a `?demo` dev flag in main.tsx and
// tree-shaken out of production. Installs the Tauri IPC shim, answers the app's
// invoke() commands with canned data, drives the chosen scenario, and drops a
// tiny scenario switcher into the corner so you can flip scenes while
// screenshotting.

import { emit, installTauriShim, setCommandHandler } from "./tauriShim.ts";
import { buildScenario, SCENARIO_NAMES, type DemoFrame } from "./fixtures.ts";

export function installDemo(scenarioName: string): void {
  installTauriShim();

  const scenario = buildScenario(scenarioName);

  // The scenario's scripted frames are a one-shot timeline, but useDaemon calls
  // connect() more than once (React StrictMode mounts effects twice in dev), so
  // gate the playback to the first connect — otherwise stream chunks and notices
  // replay and pile up. Emitting the connection snapshot itself is idempotent
  // (the reducer replaces history), so that runs on every connect.
  let framesStarted = false;

  setCommandHandler((cmd, args) => {
    switch (cmd) {
      case "connect":
        // useDaemon registers its listeners then calls connect(); reply with the
        // connection snapshot on the next tick so the listeners are in place.
        setTimeout(() => {
          emit("connection-status", scenario.connection);
          if (scenario.frames && !framesStarted) {
            framesStarted = true;
            playFrames(scenario.frames);
          }
        }, 0);
        return null;
      case "disconnect":
        emit("connection-status", { kind: "disconnected", reason: "demo disconnect" });
        return null;
      case "send_command":
        return String(args.rid ?? "demo-rid");
      case "regen":
        return "demo-regen-rid";
      case "send_message":
      case "cancel":
      case "quit":
      case "set_tray_status":
      case "read_image_file":
      case "save_image_bytes":
        return null;
      default:
        return null;
    }
  });

  installSwitcher(scenarioName, scenario.label);
}

function playFrames(frames: DemoFrame[]): void {
  let elapsed = 0;
  for (const { delay, frame } of frames) {
    elapsed += delay;
    setTimeout(() => emit("server-message", frame), elapsed);
  }
}

// A minimal fixed-corner picker; deliberately plain so it never competes with
// the app chrome in a screenshot (and it sits at low opacity until hovered).
function installSwitcher(current: string, label: string): void {
  const mount = () => {
    if (document.getElementById("demo-switcher")) return;
    const bar = document.createElement("div");
    bar.id = "demo-switcher";
    bar.setAttribute(
      "style",
      "position:fixed;left:8px;bottom:8px;z-index:99999;display:flex;gap:4px;" +
        "align-items:center;font:11px/1.4 ui-monospace,monospace;opacity:0.35;" +
        "transition:opacity .15s;background:rgba(20,16,12,.85);color:#e7d9c5;" +
        "padding:4px 6px;border:1px solid rgba(231,217,197,.18);border-radius:6px;",
    );
    bar.addEventListener("mouseenter", () => (bar.style.opacity = "1"));
    bar.addEventListener("mouseleave", () => (bar.style.opacity = "0.35"));

    const tag = document.createElement("span");
    tag.textContent = `demo: ${label}`;
    tag.style.opacity = "0.7";
    bar.appendChild(tag);

    const select = document.createElement("select");
    select.setAttribute(
      "style",
      "font:inherit;background:#1a1410;color:#e7d9c5;border:1px solid rgba(231,217,197,.25);border-radius:4px;padding:1px 3px;",
    );
    for (const name of SCENARIO_NAMES) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === current) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("demo", select.value);
      window.location.href = url.toString();
    });
    bar.appendChild(select);
    document.body.appendChild(bar);
  };

  if (document.body) mount();
  else window.addEventListener("DOMContentLoaded", mount);
}
