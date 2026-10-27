import { createRoot } from "react-dom/client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { App } from "./App.tsx";
import "./style.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Error details deliberately excluded from private UI/logs. */
  }
  render() {
    return this.state.failed ? (
      <main className="boot">
        <h1>Pamja nuk u hap.</h1>
        <p>Rifreskoni aplikacionin për të provuar përsëri.</p>
        <button className="primary" onClick={() => location.reload()}>
          Riprovo
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    /* Shell offline support is optional; private data remains network-only. */
  });
}
