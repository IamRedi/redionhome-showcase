import {useState} from "react";
import {Home as HomeIcon, ArrowRight, LockKeyhole} from "lucide-react";
import type {Role} from "../shared/model.ts";
import {api,errorText} from "./api.ts";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <HomeIcon size={21} strokeWidth={1.6} />
      </span>
      <span>
        RediOn<span className="brand-light">Home</span>
        <small>YOUR SPACE. CONNECTED.</small>
      </span>
    </div>
  );
}
export function Login({ onLogin }: { onLogin: (role: Role) => void }) {
  const [password, setPassword] = useState(""),
    [username, setUsername] = useState("owner"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="login">
      <div className="login-orbit orbit-one" />
      <div className="login-orbit orbit-two" />
      <Brand />
      <div className="login-content">
        <p className="eyebrow">NJË MËNYRË E RE PËR TË QENË NË SHTËPI</p>
        <h1>
          Hapësira juaj.
          <br />
          <em>Më afër se kurrë.</em>
        </h1>
        <p className="login-intro">
          Hyni, eksploroni dhe ndërveproni me hapësirën rreth jush. Gjithçka
          fillon në shtëpi.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void api<{ role: Role }>("/login", "POST", { username, password })
              .then((result) => onLogin(result.role))
              .catch((e) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Përdoruesi
            <select
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            >
              <option value="owner">Pronar</option>
              <option value="viewer">Vizitor</option>
            </select>
          </label>
          <label>
            Fjalëkalimi
            <input
              aria-label="Fjalëkalimi"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              placeholder="Fjalëkalimi juaj lokal"
            />
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Duke hyrë…" : "Hyni në hapësirën tuaj"}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="login-security">
          <LockKeyhole size={14} />
          Instalim lokal · Media private · Sesione private
        </p>
        <details className="login-help">
          <summary>Hyrja e parë?</summary>
          <p>
            Fjalëkalimi fillestar gjendet në skedarin privat{" "}
            <code>.data/owner-password.txt</code> në kompjuterin ku ekzekutohet
            serveri. Llogaria Vizitor krijohet me komandën lokale{" "}
            <code>user:create</code>.
          </p>
        </details>
      </div>
      <footer className="login-bottom">
        <span>REDIONHOME · LOCAL FIRST</span>
        <span>V0.1 / FOUNDATION</span>
      </footer>
    </main>
  );
}
