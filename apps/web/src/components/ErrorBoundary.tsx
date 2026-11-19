import { Component, type ReactNode } from "react";
import i18n from "../i18n";

/** A render error shows a calm way back instead of a blank screen. Data in IndexedDB is untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mm-welcome">
        <div className="mm-welcome__inner" role="alert">
          <h1 className="mm-welcome__title">{i18n.t("crash.title")}</h1>
          <p className="mm-welcome__lead">{i18n.t("crash.body")}</p>
          <button
            type="button"
            className="mm-button mm-button--primary mm-button--wide"
            onClick={() => window.location.reload()}
          >
            {i18n.t("crash.reload")}
          </button>
        </div>
      </main>
    );
  }
}
