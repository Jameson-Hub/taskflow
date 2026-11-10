import { useState, type FormEvent } from "react";
import { api, ROLE_LABEL, type Role, type User } from "./api";
import { ErrorText, useAction } from "./ui";

const DEMOS: { role: Role; blurb: string }[] = [
  { role: "admin", blurb: "Everything, plus team and roles" },
  { role: "manager", blurb: "Runs the board, sees activity" },
  { role: "member", blurb: "Works on their own tasks" },
];

export function Login({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const { error, run } = useAction();
  const [busy, setBusy] = useState(false);

  async function signIn(attempt: () => Promise<User>) {
    setBusy(true);
    await run(async () => onSignedIn(await attempt()));
    setBusy(false);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    signIn(() => api.login(String(form.get("email")), String(form.get("password"))));
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1>
          <img src="/favicon.svg" alt="" width={32} height={32} /> TaskFlow
        </h1>
        <p className="muted">A team task board with role-based access. Pick a role to look around.</p>

        <div className="demo-grid">
          {DEMOS.map((d) => (
            <button key={d.role} className="demo" disabled={busy} onClick={() => signIn(() => api.demoLogin(d.role))}>
              <span className={`role role-${d.role}`}>{ROLE_LABEL[d.role]}</span>
              <span className="muted small">{d.blurb}</span>
            </button>
          ))}
        </div>

        <details className="password-login">
          <summary>Sign in with email</summary>
          <form onSubmit={submit}>
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="primary" disabled={busy}>
              Sign in
            </button>
          </form>
        </details>

        <ErrorText error={error} />
      </div>
    </div>
  );
}
