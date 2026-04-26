import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import { App } from "./App";
import { traceHotkeyEvent } from "@/lib/tauri";
import "./styles.css";

traceHotkeyEvent("frontend_main_module_loaded").catch(() => {});
traceHotkeyEvent("frontend_render_requested").catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
