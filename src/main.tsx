import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { initSentry } from "./app/config/sentry";
import { isStaging } from "../utils/supabase/info";

initSentry();

// Тестовая версия видна сразу — чтобы не перепутать с живым сайтом.
if (isStaging && import.meta.env.PROD) {
  const badge = document.createElement("div");
  badge.textContent = "ТЕСТОВАЯ ВЕРСИЯ · тестовая база";
  badge.style.cssText = "position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:2147483647;padding:3px 10px;border-radius:999px;background:#f59e0b;color:#111;font:600 11px system-ui,sans-serif;pointer-events:none;opacity:.9";
  document.body.appendChild(badge);
}

createRoot(document.getElementById("root")!).render(<App />);
