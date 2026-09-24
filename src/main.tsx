import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts";
import "./index.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";

const container = document.getElementById("root");
if (!container) throw new Error("#root element is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// Fade out the static boot loader from index.html once React has painted.
requestAnimationFrame(() => {
  const loader = document.getElementById("boot-loader");
  if (!loader) return;
  loader.classList.add("hidden");
  window.setTimeout(() => loader.remove(), 450);
});
