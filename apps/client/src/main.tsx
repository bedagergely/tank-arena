import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// Dev-only tooling behind a query flag; tree-shaken out of production builds.
const MapEditor =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("editor")
    ? lazy(() => import("./dev/MapEditor.tsx").then((m) => ({ default: m.MapEditor })))
    : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {MapEditor ? (
      <Suspense fallback={null}>
        <MapEditor />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
