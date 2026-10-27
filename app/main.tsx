import { createRoot } from "react-dom/client";
import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import "./style.css";
import {UpdateNotice} from './UpdateNotice.tsx';
const App=lazy(()=>import('./App.tsx').then(module=>({default:module.App})));
const AIPage=lazy(()=>import('./AIPage.tsx').then(module=>({default:module.AIPage})));
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
    <Suspense fallback={<main className="boot"><span className="loader-ring"/></main>}>
      {location.pathname.replace(/\/$/,'')==='/ai'?<AIPage/>:<App/>}
    </Suspense>
    <UpdateNotice />
    {import.meta.env.VITE_SHOWCASE === "1" && <div className="showcase-badge">DEMO · CC0 spaces · Virtual devices · Offline script</div>}
  </ErrorBoundary>,
);
