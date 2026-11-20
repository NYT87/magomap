import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/gowun-batang/latin-700.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { followTheme } from "./theme";

followTheme();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
