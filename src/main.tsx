import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import Root from "./App";
import { BUILD_ID } from "./buildInfo";
import { ErrorBoundary } from "./ErrorBoundary";
import { setApplyUpdate, SW_UPDATE_EVENT } from "./swUpdate";
import { UpdateBanner } from "./UpdateBanner";

console.info(`SQUORA Schiedsrichter Note · build ${BUILD_ID}`);
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { window.dispatchEvent(new Event(SW_UPDATE_EVENT)); },
});
setApplyUpdate(() => updateSW(true));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <UpdateBanner />
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
