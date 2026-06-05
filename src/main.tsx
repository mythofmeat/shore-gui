import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Screenshot/demo harness (dev-only). When the app is opened with a `?demo`
// query param under `bun dev`, install a fake Tauri layer that feeds canned
// fixture conversations to the real reducer + components — no daemon, no real
// data. The dynamic import keeps it out of production bundles.
async function bootstrap() {
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    if (params.has("demo")) {
      const { installDemo } = await import("./demo/index.ts");
      installDemo(params.get("demo") || "all");
    }
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
