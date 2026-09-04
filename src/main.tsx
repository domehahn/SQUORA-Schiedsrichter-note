import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import Root from "./App";
import { BUILD_ID } from "./buildInfo";
import { ErrorBoundary } from "./ErrorBoundary";

console.info(`SQUORA Schiedsrichter Note · build ${BUILD_ID}`);
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
