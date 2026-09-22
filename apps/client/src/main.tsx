import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// `?split` in dev: two clients side by side on one page (see dev/SplitScreen.tsx).
// Guarded by the compile-time constant so the harness is not part of the production bundle.
const SplitScreen =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("split")
    ? lazy(() => import("./dev/SplitScreen.tsx").then((m) => ({ default: m.SplitScreen })))
    : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {SplitScreen ? (
      <Suspense>
        <SplitScreen />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
